import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/database', () => ({ default: {} }));
import { createInvoiceOnceByFileHash, findExactFileMatch } from './exactFileIntakeService';
const hash = 'a'.repeat(64);

describe('exact-file intake commit boundary', () => {
  it('selects an active record before looking at cancelled history', async () => {
    const first = vi.fn().mockResolvedValue({ id: 'active' });
    expect(await findExactFileMatch(hash, { invoice: { findFirst: first } })).toEqual({ id: 'active' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0][0].where.status.notIn).toEqual(['CANCELLED', 'REJECTED']);
  });
  it('retains historical matches as idempotency evidence when no active copy exists', async () => {
    const first = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'cancelled' });
    expect(await findExactFileMatch(hash, { invoice: { findFirst: first } })).toEqual({ id: 'cancelled' });
  });
  it('serializes simultaneous workers so only one invoice is inserted', async () => {
    let stored: any = null;
    let queue: Promise<unknown> = Promise.resolve();
    const create = vi.fn(async ({ data }) => stored = { ...data, id: 'one-invoice' });
    const tx = { $executeRaw: vi.fn(), invoice: { findFirst: vi.fn(async () => stored), create } };
    const client = { $transaction: (fn: any) => {
      // Emulate the database hash lock, including waiters seeing the committed row.
      const result = queue.then(() => fn(tx)); queue = result.catch(() => {}); return result;
    } };
    const results = await Promise.all(Array.from({ length: 6 }, () => createInvoiceOnceByFileHash({ invoice_hash: hash }, undefined, client)));
    expect(create).toHaveBeenCalledTimes(1);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results.every(result => result.invoice.id === 'one-invoice')).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(6);
  });
  it('allows different PDF contents through as a separate revision candidate', async () => {
    const tx = { $executeRaw: vi.fn(), invoice: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'changed-pdf' }) } };
    const client = { $transaction: (fn: any) => fn(tx) };
    expect((await createInvoiceOnceByFileHash({ invoice_hash: 'b'.repeat(64) }, undefined, client)).created).toBe(true);
  });
  it('fails closed without a content hash or when the lock/database fails', async () => {
    const tx = { $executeRaw: vi.fn().mockRejectedValue(new Error('database unavailable')), invoice: { create: vi.fn() } };
    const client = { $transaction: (fn: any) => fn(tx) };
    await expect(createInvoiceOnceByFileHash({}, undefined, client)).rejects.toThrow('content hash');
    await expect(createInvoiceOnceByFileHash({ invoice_hash: hash }, undefined, client)).rejects.toThrow('database unavailable');
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});
