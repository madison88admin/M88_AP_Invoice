import XLSX from 'xlsx';

import type { QuickBooksImportRow } from './quickBooksReconciliationService';

export function parseQuickBooksReport(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const normalizeHeader = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sheetLooksLikeBills = (sheetName: string) => {
    const candidate = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(candidate, { header: 1, defval: '', raw: false, range: 0 }) as unknown[][];
    const text = matrix.slice(0, 12).flat().map(normalizeHeader).join('|');
    return /(vendor|supplier)/.test(text) && /(amount|balance|original|open)/.test(text);
  };
  const sheetName = workbook.SheetNames.find(sheetLooksLikeBills) || workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error('The QuickBooks report does not contain a worksheet');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, range: 0 }) as unknown[][];
  const headerRow = matrix.findIndex((row) => {
    const text = row.map(normalizeHeader).join('|');
    return /(vendor|supplier)/.test(text) && /(amount|balance|original|open)/.test(text);
  });
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', range: headerRow >= 0 ? headerRow : 0 });
  const key = (row: Record<string, unknown>, ...names: string[]) => {
    const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]));
    for (const name of names) {
      const value = normalized[name.toLowerCase().replace(/[^a-z0-9]/g, '')];
      if (value !== undefined && value !== '') return value;
    }
    return undefined;
  };
  const num = (value: unknown) => {
    if (value === '' || value == null) return undefined;
    const text = String(value).trim().replace(/[$,\s]/g, '');
    const normalized = /^\(.*\)$/.test(text) ? `-${text.slice(1, -1)}` : text;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const rows = rawRows.map((row): QuickBooksImportRow => ({
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
  const summaryRow = (row: QuickBooksImportRow) => /^(grand\s+)?(sub)?total|summary|unpaid\s+bills|balance\s+forward|vendor\s+total/i.test(`${row.vendor_name || ''} ${row.comments || ''}`.trim());
  const cleanedRows = rows.filter((row) => {
    if (summaryRow(row)) return false;
    const hasReference = Boolean(row.transaction_id || row.reference || row.ap_record_id || row.invoice_number);
    const hasVendorAmount = Boolean(row.vendor_name && (row.amount != null || row.open_balance != null));
    return hasReference || hasVendorAmount;
  });
  if (cleanedRows.length === 0) throw new Error('No invoice rows were found after QuickBooks report cleanup');
  return {
    rows: cleanedRows,
    cleanup: { received_rows: rawRows.length, parsed_rows: cleanedRows.length, skipped_rows: rawRows.length - cleanedRows.length },
    sheet_name: sheetName,
  };
}
