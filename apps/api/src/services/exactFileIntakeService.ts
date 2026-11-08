import prisma from '../config/database';

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
export async function createInvoiceOnceByFileHash(data: any, include?: any, client: any = prisma): Promise<{ invoice: any; created: boolean }> {
  const hash = String(data.invoice_hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('A valid PDF content hash is required before creating an intake invoice');
  return client.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hash}))`;
    const existing = await findExactFileMatch(hash, tx);
    if (existing) return { invoice: existing, created: false };
    const invoice = await tx.invoice.create({ data: { ...data, invoice_hash: hash }, ...(include ? { include } : {}) });
    return { invoice, created: true };
  }, { timeout: 15000 });
}
