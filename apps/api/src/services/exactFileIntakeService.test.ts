import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/database', () => ({ default: {} }));
import { createInvoiceOnceByFileHash, findActiveBusinessMatch, findExactFileMatch } from './exactFileIntakeService';
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
  it('blocks a changed PDF with the same vendor and invoice number', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      invoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{
          id: 'existing', invoice_number: 'SIN911251', status: 'EXCEPTION_FLAGGED',
          vendor_id: 'brand-id', vendor_name_raw: 'BRAND ID LLC',
          normalized_invoice_number: 'SIN911251', mpo_number: 'MPO016282',
          mpo_base_number: 'MPO016282', mpo_order_sequence: null,
          material_code: null, customer_po_number: 'P003099', invoice_hash: 'old-hash',
        }]),
      },
    };
    const client = { $transaction: (fn: any) => fn(tx) };
    const result = await createInvoiceOnceByFileHash({
      invoice_hash: 'c'.repeat(64), invoice_number: 'SIN911251',
      normalized_invoice_number: 'SIN911251', vendor_id: 'brand-id',
      vendor_name_raw: 'BRAND ID LLC', mpo_number: 'MPO016282', customer_po_number: 'P003099',
    }, undefined, client);
    expect(result).toMatchObject({ created: false, duplicateType: 'BUSINESS_KEY', invoice: { id: 'existing' } });
  });
  it('allows the same invoice number when the MPO is different', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'new' });
    const tx = {
      $executeRaw: vi.fn(),
      invoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{
          id: 'existing', invoice_number: 'SIN911251', status: 'RECEIVED',
          vendor_id: 'brand-id', vendor_name_raw: 'BRAND ID LLC',
          normalized_invoice_number: 'SIN911251', mpo_number: 'MPO-OLD',
          mpo_base_number: 'MPO-OLD', mpo_order_sequence: null,
          material_code: null, customer_po_number: null, invoice_hash: 'old-hash',
        }]),
        create,
      },
    };
    const client = { $transaction: (fn: any) => fn(tx) };
    const result = await createInvoiceOnceByFileHash({
      invoice_hash: 'd'.repeat(64), invoice_number: 'SIN911251',
      normalized_invoice_number: 'SIN911251', vendor_id: 'brand-id',
      vendor_name_raw: 'BRAND ID LLC', mpo_number: 'MPO-NEW',
    }, undefined, client);
    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('blocks the same MPO even when a forwarded copy has a different customer PO label', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      invoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{
          id: 'existing', invoice_number: 'IA00514009', status: 'PENDING_MANAGER',
          vendor_id: 'checkpoint-id', vendor_name_raw: 'CHECKPOINT SYSTEMS LIMITED',
          normalized_invoice_number: 'IA514009', mpo_number: 'MPO016339',
          mpo_base_number: 'MPO016339', mpo_order_sequence: null,
          material_code: null, customer_po_number: 'PO003110', invoice_hash: 'old-hash',
          total_amount: 1351.62, invoice_date: new Date('2026-11-23T00:00:00.000Z'), currency: 'USD',
        }]),
      },
    };
    const client = { $transaction: (fn: any) => fn(tx) };
    const result = await createInvoiceOnceByFileHash({
      invoice_hash: 'e'.repeat(64), invoice_number: 'IA00514009',
      normalized_invoice_number: 'IA514009', vendor_id: 'checkpoint-id',
      vendor_name_raw: 'CHECKPOINT SYSTEMS LIMITED', mpo_number: 'MPO016339',
      customer_po_number: 'TNF F27 OCT BUY_MPO016339_ML_INDONESIA',
      total_amount: 1351.62, invoice_date: new Date('2026-11-23T00:00:00.000Z'), currency: 'USD',
    }, undefined, client);
    expect(result).toMatchObject({ created: false, duplicateType: 'BUSINESS_KEY', invoice: { id: 'existing' } });
  });
  it('does not cross-match unrelated suppliers that share the UNKNOWN VENDOR placeholder', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'new' });
    const tx = {
      $executeRaw: vi.fn(),
      invoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{
          id: 'existing', invoice_number: 'INV-1', status: 'RECEIVED',
          vendor_id: '00000000-0000-0000-0000-000000000000', vendor_name_raw: 'SUPPLIER A',
          normalized_invoice_number: 'INV1', mpo_number: 'MPO000001',
          mpo_base_number: 'MPO000001', mpo_order_sequence: null,
          material_code: null, customer_po_number: null, invoice_hash: 'old-hash',
        }]),
        create,
      },
    };
    const client = { $transaction: (fn: any) => fn(tx) };
    const result = await createInvoiceOnceByFileHash({
      invoice_hash: 'f'.repeat(64), invoice_number: 'INV-1', normalized_invoice_number: 'INV1',
      vendor_id: '00000000-0000-0000-0000-000000000000', vendor_name_raw: 'SUPPLIER B',
      mpo_number: 'MPO000001',
    }, undefined, client);
    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('does not block an unknown supplier when OCR has no vendor evidence', async () => {
    const tx = {
      invoice: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'existing', invoice_number: 'INV-2', status: 'RECEIVED',
          vendor_id: '00000000-0000-0000-0000-000000000000', vendor_name_raw: 'SUPPLIER A',
          normalized_invoice_number: 'INV2', mpo_number: null, mpo_base_number: null,
          mpo_order_sequence: null, material_code: null, customer_po_number: null,
          invoice_hash: 'old-hash', total_amount: 50, invoice_date: new Date('2026-11-20'), currency: 'USD',
        }]),
      },
    };
    await expect(findActiveBusinessMatch({
      invoice_number: 'INV-2', normalized_invoice_number: 'INV2',
      vendor_id: '00000000-0000-0000-0000-000000000000',
    }, tx)).resolves.toBeNull();
  });
  it('fails closed without a content hash or when the lock/database fails', async () => {
    const tx = { $executeRaw: vi.fn().mockRejectedValue(new Error('database unavailable')), invoice: { create: vi.fn() } };
    const client = { $transaction: (fn: any) => fn(tx) };
    await expect(createInvoiceOnceByFileHash({}, undefined, client)).rejects.toThrow('content hash');
    await expect(createInvoiceOnceByFileHash({ invoice_hash: hash }, undefined, client)).rejects.toThrow('database unavailable');
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});
