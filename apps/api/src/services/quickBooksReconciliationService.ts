import prisma from '../config/database';

export const QUICKBOOKS_RECONCILIATION_RESULTS = [
  'MATCHED',
  'AP_ONLY',
  'QUICKBOOKS_ONLY',
  'AMOUNT_DIFFERENCE',
  'VENDOR_DIFFERENCE',
  'POSSIBLE_DUPLICATE_POSTING',
  'AMBIGUOUS_MATCH',
  'MISSING_INVALID_REFERENCE',
  'OTHER_RECONCILIATION_EXCEPTION',
] as const;

export async function listQuickBooksReconciliations(filters: { result?: string; resolution_status?: string; invoice_id?: string } = {}) {
  return prisma.quickBooksReconciliation.findMany({
    where: {
      ...(filters.result ? { result: filters.result } : {}),
      ...(filters.resolution_status ? { resolution_status: filters.resolution_status } : {}),
      ...(filters.invoice_id ? { invoice_id: filters.invoice_id } : {}),
    },
    include: { invoice: { select: { id: true, ap_record_id: true, invoice_number: true, vendor_name_raw: true, total_amount: true, currency: true, status: true } } },
    orderBy: { reconciled_at: 'desc' },
    take: 500,
  });
}

export async function recordQuickBooksReconciliation(input: {
  invoice_id?: string;
  result: string;
  qb_transaction_id?: string;
  qb_reference?: string;
  qb_vendor_name?: string;
  qb_invoice_number?: string;
  qb_amount?: number;
  qb_open_balance?: number;
  difference_amount?: number;
  exception_code?: string;
  review_owner?: string;
  comments?: string;
  source?: string;
}, actorId?: string) {
  if (!QUICKBOOKS_RECONCILIATION_RESULTS.includes(input.result as any)) {
    throw new Error(`Unsupported QuickBooks reconciliation result: ${input.result}`);
  }
  if (input.result !== 'QUICKBOOKS_ONLY' && !input.invoice_id) {
    throw new Error('invoice_id is required unless the result is QUICKBOOKS_ONLY');
  }
  if (input.invoice_id) {
    const invoice = await prisma.invoice.findUnique({ where: { id: input.invoice_id }, select: { id: true } });
    if (!invoice) throw new Error('Invoice not found');
  }
  return prisma.quickBooksReconciliation.create({
    data: {
      invoice_id: input.invoice_id,
      result: input.result,
      qb_transaction_id: input.qb_transaction_id || null,
      qb_reference: input.qb_reference || null,
      qb_vendor_name: input.qb_vendor_name || null,
      qb_invoice_number: input.qb_invoice_number || null,
      qb_amount: input.qb_amount ?? null,
      qb_open_balance: input.qb_open_balance ?? null,
      difference_amount: input.difference_amount ?? null,
      exception_code: input.exception_code || null,
      review_owner: input.review_owner || null,
      comments: input.comments || null,
      source: input.source || 'MANUAL',
      resolution_status: input.result === 'MATCHED' ? 'RESOLVED' : 'OPEN',
      resolved_by: input.result === 'MATCHED' ? actorId || null : null,
      resolved_at: input.result === 'MATCHED' ? new Date() : null,
    },
  });
}

export async function resolveQuickBooksReconciliation(id: string, actorId: string, comments?: string) {
  return prisma.quickBooksReconciliation.update({
    where: { id },
    data: {
      resolution_status: 'RESOLVED',
      resolved_by: actorId,
      resolved_at: new Date(),
      comments: comments || undefined,
    },
  });
}

export type QuickBooksImportRow = {
  transaction_id?: string;
  reference?: string;
  ap_record_id?: string;
  invoice_number?: string;
  vendor_name?: string;
  amount?: number;
  open_balance?: number;
  currency?: string;
  comments?: string;
};

/**
 * Reconcile an exported QuickBooks bill/payables report in one request. This
 * keeps the existing manual record endpoint, but gives Accounting a repeatable
 * import path with deterministic result categories and no invoice-number-only
 * matching.
 */
export async function importQuickBooksRows(rows: QuickBooksImportRow[], actorId: string) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('At least one QuickBooks row is required');
  const invoices = await prisma.invoice.findMany({
    where: { status: { notIn: ['CANCELLED'] as any } },
    select: { id: true, ap_record_id: true, invoice_number: true, vendor_name_raw: true, total_amount: true, currency: true },
    take: 10000,
  });
  const normalize = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const results = [];
  for (const row of rows) {
    const reference = row.ap_record_id || row.reference || row.invoice_number;
    const candidates = invoices.filter((invoice) => {
      const refMatch = reference && (invoice.ap_record_id === reference || invoice.invoice_number === reference || normalize(invoice.invoice_number) === normalize(row.invoice_number));
      const vendorMatch = row.vendor_name && normalize(invoice.vendor_name_raw) === normalize(row.vendor_name);
      return Boolean(refMatch || (vendorMatch && row.invoice_number && normalize(invoice.invoice_number) === normalize(row.invoice_number)));
    });
    let result: typeof QUICKBOOKS_RECONCILIATION_RESULTS[number];
    let invoice = candidates.length === 1 ? candidates[0] : undefined;
    if (!reference && !row.transaction_id) result = 'MISSING_INVALID_REFERENCE';
    else if (candidates.length === 0) result = 'QUICKBOOKS_ONLY';
    else if (candidates.length > 1) result = 'AMBIGUOUS_MATCH';
    else {
      const existingPosting = await prisma.quickBooksReconciliation.findFirst({ where: { invoice_id: invoice!.id, ...(row.transaction_id ? { qb_transaction_id: row.transaction_id } : {}) } });
      if (existingPosting) result = 'POSSIBLE_DUPLICATE_POSTING';
      else if (row.vendor_name && normalize(row.vendor_name) !== normalize(invoice!.vendor_name_raw)) result = 'VENDOR_DIFFERENCE';
      else if (row.amount != null && Math.abs(Number(row.amount) - Number(invoice!.total_amount)) > 0.01) result = 'AMOUNT_DIFFERENCE';
      else result = 'MATCHED';
    }
    results.push(await recordQuickBooksReconciliation({
      invoice_id: invoice?.id,
      result,
      qb_transaction_id: row.transaction_id,
      qb_reference: row.reference || row.ap_record_id || undefined,
      qb_vendor_name: row.vendor_name,
      qb_invoice_number: row.invoice_number,
      qb_amount: row.amount,
      qb_open_balance: row.open_balance,
      difference_amount: invoice && row.amount != null ? Number(row.amount) - Number(invoice.total_amount) : undefined,
      comments: row.comments,
      source: 'QUICKBOOKS_IMPORT',
    }, actorId));
  }
  return { imported: results.length, results };
}

