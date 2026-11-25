import prisma from '../config/database';

const ACTIVE_INVOICE_STATUSES = ['CANCELLED', 'REJECTED'];
const REVISION_ALLOWED_STATUSES = new Set([
  'RECEIVED', 'OCR_PROCESSING', 'VALIDATION_PENDING', 'EXCEPTION_FLAGGED', 'PENDING_COORDINATOR',
]);

function normalizeBusinessReference(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/(?:REV(?:ISION)?|CORR(?:ECTED)?|REPLACEMENT)$/i, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/^([A-Z]+)0+(?=\d)/, '$1');
}

function sameReference(left: unknown, right: unknown): boolean {
  const a = normalizeBusinessReference(left);
  const b = normalizeBusinessReference(right);
  return Boolean(a && b && a === b);
}

function normalizeVendorIdentity(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/(?:LIMITED|LTD|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO)$/i, '');
}

/**
 * Find one active invoice with the same business identity. Exact file hashes
 * are not enough because the same PDF is often re-exported with a different
 * filename or a slightly different OCR amount. This guard runs inside the
 * intake transaction after an advisory lock so concurrent workers cannot
 * create two active rows for one supplier invoice.
 */
export async function findActiveBusinessMatch(data: any, client: any = prisma): Promise<any | null> {
  const invoiceNumber = String(data?.invoice_number || '').trim();
  const vendorId = String(data?.vendor_id || '').trim();
  if (!invoiceNumber || !vendorId) return null;
  const vendorName = String(data?.vendor_name_raw || data?.vendor_name || '').trim();
  const unknownVendor = vendorId === '00000000-0000-0000-0000-000000000000';

  const normalized = normalizeBusinessReference(data.normalized_invoice_number || invoiceNumber);
  const candidates = await client.invoice.findMany({
    where: {
      vendor_id: vendorId,
      status: { notIn: ACTIVE_INVOICE_STATUSES as any },
      OR: [
        { invoice_number: invoiceNumber },
        ...(normalized ? [{ normalized_invoice_number: normalized }] : []),
      ],
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      invoice_number: true,
      status: true,
      vendor_id: true,
      vendor_name_raw: true,
      normalized_invoice_number: true,
      mpo_number: true,
      mpo_base_number: true,
      mpo_order_sequence: true,
      material_code: true,
      customer_po_number: true,
      invoice_hash: true,
      total_amount: true,
      invoice_date: true,
      currency: true,
    },
    take: 20,
  });

  for (const candidate of candidates) {
    // The UNKNOWN VENDOR placeholder is shared by unrelated suppliers. Never
    // let it turn a same-number invoice from another supplier into a duplicate;
    // require the OCR supplier name to corroborate the match.
    if (unknownVendor) {
      // The placeholder is shared by unrelated suppliers. If OCR did not
      // produce a supplier name (or the existing row has none), there is not
      // enough identity evidence to call this a duplicate. Never block an
      // unknown supplier solely on invoice number in that case.
      if (!vendorName || !candidate.vendor_name_raw
        || normalizeVendorIdentity(vendorName) !== normalizeVendorIdentity(candidate.vendor_name_raw)) continue;
    }
    // A different MPO/PO is a legitimate separate payable item even when a
    // supplier reuses the same invoice number. Keep that existing behavior.
    const incomingMpo = data.mpo_base_number || data.mpo_number || data.mpo_order_sequence;
    const existingMpo = candidate.mpo_base_number || candidate.mpo_number || candidate.mpo_order_sequence;
    if (incomingMpo && existingMpo && !sameReference(incomingMpo, existingMpo)) continue;
    // The same supplier invoice and same MPO is the same payable identity even
    // when a forwarded/re-exported PDF carries a different customer-PO label.
    // Customer-PO text is often populated from a different document section and
    // must not allow a second AP row through in that case.
    if (incomingMpo && existingMpo && sameReference(incomingMpo, existingMpo)) return candidate;
    if (data.customer_po_number && candidate.customer_po_number
      && !sameReference(data.customer_po_number, candidate.customer_po_number)) continue;
    if (data.material_code && candidate.material_code
      && !sameReference(data.material_code, candidate.material_code)) continue;
    // If the MPO was not extracted consistently, the combination of normalized
    // invoice reference, vendor, amount, currency and invoice date is still a
    // strong duplicate identity. Only apply this fallback when all corroborating
    // fields exist; a same-number/different-MPO invoice remains eligible.
    const sameAmount = data.total_amount != null && candidate.total_amount != null
      && Math.abs(Number(data.total_amount) - Number(candidate.total_amount)) < 0.01;
    const sameCurrency = data.currency && candidate.currency
      && String(data.currency).toUpperCase() === String(candidate.currency).toUpperCase();
    const incomingDate = data.invoice_date ? new Date(data.invoice_date) : null;
    const existingDate = candidate.invoice_date ? new Date(candidate.invoice_date) : null;
    const sameDate = Boolean(incomingDate && existingDate
      && !Number.isNaN(incomingDate.getTime()) && !Number.isNaN(existingDate.getTime())
      && incomingDate.toISOString().slice(0, 10) === existingDate.toISOString().slice(0, 10));
    if (sameAmount && sameCurrency && sameDate) return candidate;
    return candidate;
  }
  return null;
}

/** Prefer a current invoice to superseded history; never pick an arbitrary
 * cancelled parent when active children already hold the identical content.
 */
export async function findExactFileMatch(hash: string, client: any = prisma): Promise<any | null> {
  hash = hash.toLowerCase();
  const select = { id: true, invoice_number: true, status: true };
  return await client.invoice.findFirst({
    where: { invoice_hash: hash, status: { notIn: ['CANCELLED', 'REJECTED'] } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }], select,
  }) || await client.invoice.findFirst({
    where: { invoice_hash: hash }, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], select,
  });
}

/** Shared commit boundary for watcher and review intake. Email intake uses
 * the same hash lock inside its larger invoice+event transaction. Do not
 * deduplicate on message ID alone: one email can contain several invoices.
 */
export async function createInvoiceOnceByFileHash(data: any, include?: any, client: any = prisma): Promise<{ invoice: any; created: boolean; duplicateType?: 'FILE_HASH' | 'BUSINESS_KEY' }> {
  const hash = String(data.invoice_hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('A valid PDF content hash is required before creating an intake invoice');
  return client.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hash}))`;
    const existing = await findExactFileMatch(hash, tx);
    if (existing) return { invoice: existing, created: false, duplicateType: 'FILE_HASH' };
    const businessLockKey = `${String(data.vendor_id || '').trim()}:${normalizeBusinessReference(data.normalized_invoice_number || data.invoice_number)}`;
    if (data.invoice_number && data.vendor_id) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessLockKey}))`;
      const businessMatch = await findActiveBusinessMatch(data, tx);
      const isChangedCoordinatorRevision = Boolean(
        businessMatch
        && data.parent_invoice_id === businessMatch.id
        && businessMatch.invoice_hash
        && businessMatch.invoice_hash !== hash
        && REVISION_ALLOWED_STATUSES.has(String(businessMatch.status || '').toUpperCase()),
      );
      if (businessMatch && !isChangedCoordinatorRevision) {
        return { invoice: businessMatch, created: false, duplicateType: 'BUSINESS_KEY' };
      }
    }
    const invoice = await tx.invoice.create({ data: { ...data, invoice_hash: hash }, ...(include ? { include } : {}) });
    return { invoice, created: true };
  }, { timeout: 15000 });
}
