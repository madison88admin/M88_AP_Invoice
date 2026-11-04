import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  invoiceFindMany, invoiceFindUnique, invoiceFindFirst, invoiceCreate, invoiceUpdate,
  paymentUpdateMany,
  vendorFindMany, vendorFindFirst, vendorCreate,
  reconciliationFindFirst, reconciliationCreate,
} = vi.hoisted(() => ({
  invoiceFindMany: vi.fn(), invoiceFindUnique: vi.fn(), invoiceFindFirst: vi.fn(), invoiceCreate: vi.fn(), invoiceUpdate: vi.fn(),
  vendorFindMany: vi.fn(), vendorFindFirst: vi.fn(), vendorCreate: vi.fn(),
  reconciliationFindFirst: vi.fn(), reconciliationCreate: vi.fn(),
  paymentUpdateMany: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findMany: invoiceFindMany, findUnique: invoiceFindUnique, findFirst: invoiceFindFirst, create: invoiceCreate, update: invoiceUpdate },
    payment: { updateMany: paymentUpdateMany },
    vendor: { findMany: vendorFindMany, findFirst: vendorFindFirst, create: vendorCreate },
    quickBooksReconciliation: { findFirst: reconciliationFindFirst, create: reconciliationCreate },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));

import { importQuickBooksRows } from './quickBooksReconciliationService';

beforeEach(() => {
  [invoiceFindMany, invoiceFindUnique, invoiceFindFirst, invoiceCreate, invoiceUpdate, paymentUpdateMany, vendorFindMany, vendorFindFirst, vendorCreate, reconciliationFindFirst, reconciliationCreate]
    .forEach((mock) => mock.mockReset());
  invoiceUpdate.mockResolvedValue({});
  paymentUpdateMany.mockResolvedValue({ count: 0 });
  reconciliationFindFirst.mockResolvedValue(null);
  reconciliationCreate.mockImplementation(async ({ data }: any) => ({ id: 'recon-1', ...data }));
});

describe('QuickBooks reconciliation controls', () => {
  it('uses currency as a matching key and records an explicit currency difference', async () => {
    invoiceFindMany.mockResolvedValue([{
      id: 'invoice-1', ap_record_id: 'AP-1', invoice_number: 'INV-1',
      vendor_name_raw: 'Acme Co', total_amount: 100, currency: 'USD',
    }]);
    vendorFindMany.mockResolvedValue([{ id: 'vendor-1', name: 'Acme Co' }]);
    invoiceFindUnique.mockResolvedValue({ id: 'invoice-1' });

    const result = await importQuickBooksRows([{
      transaction_id: 'qb-1', invoice_number: 'INV-1', vendor_name: 'Acme Co',
      amount: 100, currency: 'EUR',
    }], 'accounting-1');

    expect(result.results[0]).toMatchObject({ result: 'CURRENCY_DIFFERENCE', qb_currency: 'EUR' });
    expect(reconciliationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ result: 'CURRENCY_DIFFERENCE', qb_currency: 'EUR' }),
    }));
  });

  it('reuses UNKNOWN VENDOR for an unknown QB-only vendor without creating a Vendor row', async () => {
    invoiceFindMany.mockResolvedValue([]);
    vendorFindMany.mockResolvedValue([]);
    vendorFindFirst.mockResolvedValue({ id: 'unknown-vendor', name: 'UNKNOWN VENDOR' });
    invoiceFindFirst.mockResolvedValue(null);
    invoiceCreate.mockResolvedValue({
      id: 'qb-invoice-1', ap_record_id: 'AP-QB-1', invoice_number: 'QB-INV-1',
      vendor_name_raw: 'New Vendor', total_amount: 75, currency: 'USD',
    });
    invoiceFindUnique.mockResolvedValue({ id: 'qb-invoice-1' });

    const result = await importQuickBooksRows([{
      transaction_id: 'qb-only-1', invoice_number: 'QB-INV-1', vendor_name: 'New Vendor',
      amount: 75, currency: 'USD',
    }], 'accounting-1');

    expect(invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source_document_type: 'QUICKBOOKS_ONLY',
        status: 'EXCEPTION_FLAGGED',
        workflow_status: 'ACCOUNTING_REVIEW',
        vendor_id: 'unknown-vendor',
      }),
    }));
    expect(vendorCreate).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ result: 'QUICKBOOKS_ONLY', invoice_id: 'qb-invoice-1' });
  });

  it('does not create a vendor or AP invoice when the UNKNOWN VENDOR placeholder is unavailable', async () => {
    invoiceFindMany.mockResolvedValue([]);
    vendorFindMany.mockResolvedValue([]);
    vendorFindFirst.mockResolvedValue(null);

    const result = await importQuickBooksRows([{
      transaction_id: 'qb-only-2', invoice_number: 'QB-INV-2', vendor_name: 'New Vendor',
      amount: 75, currency: 'USD',
    }], 'accounting-1');

    expect(vendorCreate).not.toHaveBeenCalled();
    expect(invoiceCreate).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ result: 'QUICKBOOKS_ONLY' });
    expect(result.results[0].comments).toContain('no active UNKNOWN VENDOR placeholder');
  });
});
