import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findFirst: mocks.findFirst, update: mocks.update },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('./supabaseStorageService', () => ({
  uploadToStorage: mocks.upload,
}));

import { generateFileHash } from './emailDuplicateService';
import { findLatestInvoiceByNumber, replaceInvoicePdfByNumber } from './invoicePdfReplacementService';

const existing = {
  id: 'invoice-1',
  invoice_number: 'INV-100',
  revision: 1,
  status: 'PENDING_COORDINATOR',
  pdf_path: 'invoices/old.pdf',
  raw_file_url: 'invoices/old.pdf',
  invoice_hash: 'old-hash',
};

describe('invoice PDF replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      invoice: { update: mocks.update },
      auditLog: { create: mocks.auditCreate },
    }));
  });

  it('selects the newest revision for a matching invoice number', async () => {
    mocks.findFirst.mockResolvedValue(existing);
    await expect(findLatestInvoiceByNumber(' INV-100 ')).resolves.toEqual(existing);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { invoice_number: 'INV-100' },
      orderBy: [{ revision: 'desc' }, { created_at: 'desc' }],
    }));
  });

  it('replaces only the attachment and writes an audit trail', async () => {
    const buffer = Buffer.from('corrected-pdf');
    mocks.findFirst.mockResolvedValue(existing);
    mocks.upload.mockResolvedValue('invoices/2026/10/new.pdf');

    const result = await replaceInvoicePdfByNumber({
      invoiceNumber: 'INV-100',
      buffer,
      fileName: 'INV-100-corrected.pdf',
      source: 'email_poller',
    });

    expect(result).toMatchObject({ action: 'REPLACED', storagePath: 'invoices/2026/10/new.pdf' });
    expect(mocks.upload).toHaveBeenCalledWith(buffer, 'INV-100-corrected.pdf', 'application/pdf');
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: {
        pdf_path: 'invoices/2026/10/new.pdf',
        raw_file_url: 'invoices/2026/10/new.pdf',
        invoice_hash: generateFileHash(buffer),
      },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoice_id: 'invoice-1',
        action: 'PDF_ATTACHMENT_REPLACED',
        performed_by: 'email_poller',
      }),
    }));
  });

  it('does not upload or update when the incoming PDF is identical', async () => {
    const buffer = Buffer.from('same-pdf');
    mocks.findFirst.mockResolvedValue({ ...existing, invoice_hash: generateFileHash(buffer) });

    await expect(replaceInvoicePdfByNumber({
      invoiceNumber: 'INV-100',
      buffer,
      fileName: 'INV-100.pdf',
      source: 'file_watcher',
    })).resolves.toMatchObject({ action: 'NOOP_DUPLICATE' });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns not found without touching storage', async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(replaceInvoicePdfByNumber({
      invoiceNumber: 'MISSING',
      buffer: Buffer.from('pdf'),
      fileName: 'missing.pdf',
      source: 'powerautomate',
    })).resolves.toEqual({ action: 'NOT_FOUND' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
