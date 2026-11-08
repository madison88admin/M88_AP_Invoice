import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import XLSX from 'xlsx';
import fs from 'fs/promises';
import path from 'path';
import { importQuickBooksRows, listQuickBooksReconciliations, recordQuickBooksReconciliation, resolveQuickBooksReconciliation, validateQuickBooksRows } from '../services/quickBooksReconciliationService';
import { parseQuickBooksReport } from '../services/quickBooksReportParser';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await listQuickBooksReconciliations({
      result: req.query.result as string | undefined,
      resolution_status: req.query.resolution_status as string | undefined,
      invoice_id: req.query.invoice_id as string | undefined,
    }));
  } catch (error) { next(error); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await recordQuickBooksReconciliation({ ...req.body }, req.user!.id));
  } catch (error) { next(error); }
}

export async function resolve(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await resolveQuickBooksReconciliation(req.params.id, req.user!.id, req.body?.comments));
  } catch (error) { next(error); }
}

export async function importRows(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
    res.status(201).json(await importQuickBooksRows(rows, req.user!.id, { asOfDate: req.body?.asOfDate, sourceFilename: req.body?.sourceFilename }));
  } catch (error) { next(error); }
}

export async function importFile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const uploadedFile = (req as any).file;
    if (!uploadedFile?.buffer) return res.status(400).json({ message: 'A QuickBooks CSV or XLSX report is required' });
    const workbook = XLSX.read(uploadedFile.buffer, { type: 'buffer', cellDates: true });
    const normalizeHeader = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const sheetLooksLikeBills = (sheetName: string) => {
      const candidate = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(candidate, { header: 1, defval: '', raw: false, range: 0 }) as unknown[][];
      const text = matrix.slice(0, 12).flat().map(normalizeHeader).join('|');
      return /(vendor|supplier)/.test(text) && /(amount|balance|original|open)/.test(text);
    };
    const sheetName = workbook.SheetNames.find(sheetLooksLikeBills) || workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) return res.status(400).json({ message: 'The QuickBooks report does not contain a worksheet' });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, range: 0 }) as unknown[][];
    const headerRow = matrix.findIndex((row) => {
      const text = row.map(normalizeHeader).join('|');
      return /(vendor|supplier)/.test(text) && /(amount|balance|original|open)/.test(text);
    });
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', range: headerRow >= 0 ? headerRow : 0 });
    const key = (row: Record<string, unknown>, ...names: string[]) => {
      const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]));
      for (const name of names) { const value = normalized[name.toLowerCase().replace(/[^a-z0-9]/g, '')]; if (value !== undefined && value !== '') return value; }
      return undefined;
    };
    const num = (value: unknown) => {
      if (value === '' || value == null) return undefined;
      const text = String(value).trim().replace(/[$,\s]/g, '');
      const normalized = /^\(.*\)$/.test(text) ? `-${text.slice(1, -1)}` : text;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const rows = rawRows.map((row) => ({
      transaction_id: String(key(row, 'transaction_id', 'transactionid', 'qb_transaction_id') || '') || undefined,
      reference: String(key(row, 'reference', 'ref', 'document_number', 'documentno', 'ref_no', 'refno') || '') || undefined,
      ap_record_id: String(key(row, 'ap_record_id', 'aprecordid') || '') || undefined,
      invoice_number: String(key(row, 'invoice_number', 'invoice', 'invoiceno', 'bill_number', 'bill_no', 'billno', 'num', 'document_number', 'documentno') || '') || undefined,
      vendor_name: String(key(row, 'vendor_name', 'vendor', 'supplier') || '') || undefined,
      amount: num(key(row, 'amount', 'total', 'original_amount', 'original', 'orig_amount', 'amount_due')),
      open_balance: num(key(row, 'open_balance', 'openbalance', 'balance', 'remaining', 'open_amount', 'openamount')),
      currency: String(key(row, 'currency', 'currency_code') || 'USD'),
      comments: String(key(row, 'comments', 'memo', 'remarks') || '') || undefined,
      as_of_date: String(key(row, 'as_of_date', 'asofdate', 'report_date') || '') || undefined,
      invoice_date: String(key(row, 'invoice_date', 'invoicedate', 'bill_date', 'date') || '') || undefined,
      due_date: String(key(row, 'due_date', 'duedate', 'payment_due') || '') || undefined,
    }));
    // QuickBooks exports contain report headers, subtotal/grand-total rows and
    // blank separators. Keep only invoice-like rows; uncertain rows with a
    // vendor/amount but no reference remain and are flagged by reconciliation.
    const summaryRow = (row: (typeof rows)[number]) => /^(grand\s+)?(sub)?total|summary|unpaid\s+bills|balance\s+forward|vendor\s+total/i.test(`${row.vendor_name || ''} ${row.comments || ''}`.trim());
    const cleanedRows = rows.filter((row) => {
      if (summaryRow(row)) return false;
      const hasReference = Boolean(row.transaction_id || row.reference || row.ap_record_id || row.invoice_number);
      const hasVendorAmount = Boolean(row.vendor_name && (row.amount != null || row.open_balance != null));
      return hasReference || hasVendorAmount;
    });
    if (cleanedRows.length === 0) return res.status(400).json({ message: 'No invoice rows were found after QuickBooks report cleanup' });

    // Preserve the original upload for reconciliation/audit. The source file
    // is intentionally immutable and is separate from normalized invoice data.
    const uploadRoot = process.env.QB_REPORT_DIR || path.join(process.cwd(), 'data', 'quickbooks-reports');
    await fs.mkdir(uploadRoot, { recursive: true });
    const safeName = String(uploadedFile.originalname || 'quickbooks-report.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedName = `${Date.now()}_${safeName}`;
    const storedPath = path.join(uploadRoot, storedName);
    await fs.writeFile(storedPath, uploadedFile.buffer);
    const imported = await importQuickBooksRows(cleanedRows, req.user!.id, { asOfDate: req.body?.asOfDate, sourceFilename: uploadedFile.originalname });
    res.status(201).json({
      ...imported,
      cleanup: { received_rows: rawRows.length, imported_rows: cleanedRows.length, skipped_rows: rawRows.length - cleanedRows.length },
      original_report: { filename: uploadedFile.originalname, storage_path: path.relative(process.cwd(), storedPath).replace(/\\/g, '/') },
    });
  } catch (error) { next(error); }
}

/**
 * Parse and reconcile a QuickBooks report without persisting anything.
 * This endpoint is safe for read-only QA/reporting database connections.
 */
export async function validateFile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const uploadedFile = (req as any).file;
    if (!uploadedFile?.buffer) return res.status(400).json({ message: 'A QuickBooks CSV or XLSX report is required' });
    const parsed = parseQuickBooksReport(uploadedFile.buffer);
    const validated = await validateQuickBooksRows(parsed.rows, { asOfDate: req.body?.asOfDate, cutoffDate: req.body?.cutoffDate });
    res.json({
      ...validated,
      cleanup: parsed.cleanup,
      sheet_name: parsed.sheet_name,
      source_filename: uploadedFile.originalname,
    });
  } catch (error) { next(error); }
}

