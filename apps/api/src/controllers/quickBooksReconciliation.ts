import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import XLSX from 'xlsx';
import { importQuickBooksRows, listQuickBooksReconciliations, recordQuickBooksReconciliation, resolveQuickBooksReconciliation } from '../services/quickBooksReconciliationService';

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
    if (!(req as any).file?.buffer) return res.status(400).json({ message: 'A QuickBooks CSV or XLSX report is required' });
    const workbook = XLSX.read((req as any).file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const key = (row: Record<string, unknown>, ...names: string[]) => {
      const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]));
      for (const name of names) { const value = normalized[name.toLowerCase().replace(/[^a-z0-9]/g, '')]; if (value !== undefined && value !== '') return value; }
      return undefined;
    };
    const num = (value: unknown) => value === '' || value == null ? undefined : Number(String(value).replace(/[$,]/g, ''));
    const rows = rawRows.map((row) => ({
      transaction_id: String(key(row, 'transaction_id', 'transactionid', 'qb_transaction_id') || '') || undefined,
      reference: String(key(row, 'reference', 'ref', 'document_number', 'documentno') || '') || undefined,
      ap_record_id: String(key(row, 'ap_record_id', 'aprecordid') || '') || undefined,
      invoice_number: String(key(row, 'invoice_number', 'invoice', 'invoiceno', 'bill_number') || '') || undefined,
      vendor_name: String(key(row, 'vendor_name', 'vendor', 'supplier') || '') || undefined,
      amount: num(key(row, 'amount', 'total', 'original_amount')),
      open_balance: num(key(row, 'open_balance', 'openbalance', 'balance', 'remaining')),
      currency: String(key(row, 'currency', 'currency_code') || 'USD'),
      comments: String(key(row, 'comments', 'memo', 'remarks') || '') || undefined,
      as_of_date: String(key(row, 'as_of_date', 'asofdate', 'report_date') || '') || undefined,
      invoice_date: String(key(row, 'invoice_date', 'invoicedate', 'bill_date') || '') || undefined,
      due_date: String(key(row, 'due_date', 'duedate', 'payment_due') || '') || undefined,
    }));
    res.status(201).json(await importQuickBooksRows(rows, req.user!.id, { asOfDate: req.body?.asOfDate, sourceFilename: (req as any).file.originalname }));
  } catch (error) { next(error); }
}

