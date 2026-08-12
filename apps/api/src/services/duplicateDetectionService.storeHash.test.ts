import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma + the storage download before importing the service.
const { invoiceUpdate, downloadFromStorage } = vi.hoisted(() => ({
  invoiceUpdate: vi.fn(),
  downloadFromStorage: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: { invoice: { update: invoiceUpdate } },
}));

vi.mock('../services/supabaseStorageService', () => ({
  downloadFromStorage,
}));

// generateFileHash is deterministic for the tests: hash = 'sha256:' + length.
vi.mock('./emailDuplicateService', () => ({
  generateFileHash: (buffer: Buffer) => `sha256:${buffer?.length ?? 0}`,
}));

import { storeInvoiceHashFromStorage } from './duplicateDetectionService';

describe('storeInvoiceHashFromStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads the file, hashes it, and stores invoice_hash on the invoice', async () => {
    downloadFromStorage.mockResolvedValue(Buffer.from('fake-pdf-bytes'));

    await storeInvoiceHashFromStorage('inv-1', 'invoices/2026/08/x.pdf');

    expect(downloadFromStorage).toHaveBeenCalledWith('invoices/2026/08/x.pdf');
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { invoice_hash: 'sha256:14' },
    });
  });

  it('does nothing when storage returns no buffer', async () => {
    downloadFromStorage.mockResolvedValue(null);

    await storeInvoiceHashFromStorage('inv-1', 'invoices/2026/08/missing.pdf');

    expect(invoiceUpdate).not.toHaveBeenCalled();
  });
});
