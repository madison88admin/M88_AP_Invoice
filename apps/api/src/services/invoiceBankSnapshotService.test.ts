import { describe, expect, it, vi } from 'vitest';
import { ensureInvoiceBankSnapshot } from './invoiceBankSnapshotService';

describe('invoice bank snapshot persistence', () => {
  it('does not send vendor_id to the revision table', async () => {
    const revisionCreate = vi.fn().mockResolvedValue({});
    const client = {
      invoiceBankSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
      },
      invoiceBankSnapshotRevision: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: revisionCreate,
      },
      invoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invoice-1',
          vendor_id: 'vendor-1',
          beneficiary_name: 'Supplier',
          bank_name: 'Bank',
          account_number: '123',
          swift_code: 'SWIFT',
          vendor: {},
        }),
      },
      vendorBankVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await ensureInvoiceBankSnapshot('invoice-1', 'test', client);

    expect(revisionCreate).toHaveBeenCalledTimes(1);
    expect(revisionCreate.mock.calls[0][0].data).not.toHaveProperty('vendor_id');
  });
});
