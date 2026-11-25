import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  invoiceFindFirst,
  invoiceFindMany,
  invoiceCreate,
  transaction,
  executeRaw,
  auditLogCreate,
  notifyStageTransition,
} = vi.hoisted(() => ({
  invoiceFindFirst: vi.fn(),
  invoiceFindMany: vi.fn(),
  invoiceCreate: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  auditLogCreate: vi.fn(),
  notifyStageTransition: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findFirst: invoiceFindFirst, findMany: invoiceFindMany, create: invoiceCreate },
    $transaction: transaction,
    $executeRaw: executeRaw,
    vendor: { create: vi.fn() },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock('./auditLogService', () => ({ logAudit: vi.fn(), resolveAuditActorNames: vi.fn() }));
vi.mock('./vendorMatchingService', () => ({ matchVendor: vi.fn() }));
vi.mock('./fieldDecisionEngine', () => ({ fieldDecisionEngine: {} }));
vi.mock('./validationService', () => ({ validateInvoice: vi.fn() }));
vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { notifyStageTransition },
}));

import { createInvoice } from './invoiceService';

beforeEach(() => {
  vi.clearAllMocks();
  invoiceFindFirst.mockResolvedValue(null);
  invoiceFindMany.mockResolvedValue([]);
  executeRaw.mockResolvedValue([]);
  transaction.mockImplementation(async (callback: any) => callback({
    invoice: { findMany: invoiceFindMany, create: invoiceCreate },
    $executeRaw: executeRaw,
  }));
  auditLogCreate.mockResolvedValue({});
  notifyStageTransition.mockResolvedValue({});
  invoiceCreate.mockImplementation(async ({ data }: any) => ({
    id: 'invoice-pt-sml',
    ...data,
    vendor: { id: 'sml-private', name: 'PT SML INDONESIA PRIVATE' },
    signatures: [],
    exceptions: [],
    stage_timestamps: [],
    invoice_lines: [],
    payments: [],
  }));
});

describe('createInvoice OCR input sanitation', () => {
  it('creates a PT SML invoice when optional OCR fields contain empty or invalid values', async () => {
    await createInvoice({
      invoice_number: 'PT-SML-UPLOAD-TEST',
      invoice_date: '2026-09-03',
      due_date: '2026-09-04',
      vendor_id: 'sml-private',
      vendor_name_raw: 'PT. SML INDONESIA PRIVATE',
      total_amount: '1,250.50',
      invoice_type: 'INVOICE',
      category: 'TRIMS',
      order_type: '',
      payment_terms: 'undefined',
      exchange_rate_to_usd: 'N/A',
        subtotal: '1,250.50',
      qty_shipped: 'N/A',
      ocr_confidence_score: 'N/A',
      bill_to_entity: 'MADISON 88 LTD',
      line_items: [{
        description: 'Labels',
        quantity: 'N/A',
        unit_price: '',
        line_amount: '1,250.50',
      }],
    }, 'joy-user', 'PURCHASING_COORDINATOR');

    expect(invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vendor_id: 'sml-private',
        total_amount: 1250.5,
        payment_terms: null,
        order_type: null,
        exchange_rate_to_usd: null,
        subtotal: 1250.5,
        qty_shipped: null,
        ocr_confidence_score: null,
        bill_to_entity: 'MADISON_88_LTD',
        invoice_lines: {
          create: [expect.objectContaining({
            quantity: null,
            unit_price: null,
            line_amount: 1250.5,
          })],
        },
      }),
    }));
  });

  it('persists Others combined shipment selections', async () => {
    await createInvoice({
      invoice_number: 'SF-COURIER-TEST',
      vendor_id: 'sml-private',
      vendor_name_raw: 'S.F. Express',
      total_amount: 273,
      subtotal: 273,
      invoice_type: 'COMMERCIAL',
      category: 'SHIPPING_FREIGHT',
      order_type: 'OTHER',
      order_type_detail: 'COMBINED_BULK_SAMPLE',
    }, 'joy-user', 'PURCHASING_COORDINATOR');

    expect(invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        order_type: 'OTHER',
        order_type_detail: 'COMBINED_BULK_SAMPLE',
      }),
    }));
  });

  it('rejects an invoice when the subtotal is blank', async () => {
    await expect(createInvoice({
      invoice_number: 'MISSING-SUBTOTAL-TEST',
      vendor_id: 'sml-private',
      vendor_name_raw: 'PT. SML INDONESIA PRIVATE',
      total_amount: 1250.5,
      subtotal: null,
      invoice_type: 'INVOICE',
    }, 'joy-user', 'PURCHASING_COORDINATOR')).rejects.toMatchObject({ statusCode: 400 });
    expect(invoiceCreate).not.toHaveBeenCalled();
  });

  it('blocks a normalized duplicate while allowing a different MPO as a separate invoice', async () => {
    invoiceFindMany.mockResolvedValueOnce([{
      id: 'existing-invoice',
      invoice_number: 'IA-00123',
      status: 'PENDING_MANAGER',
      vendor_id: 'sml-private',
      vendor_name_raw: 'PT. SML INDONESIA PRIVATE',
      normalized_invoice_number: 'IA00123',
      mpo_number: 'MPO001234',
      mpo_base_number: 'MPO001234',
      mpo_order_sequence: null,
      material_code: null,
      customer_po_number: null,
      invoice_hash: null,
    }]);

    await expect(createInvoice({
      invoice_number: 'IA/00123',
      vendor_id: 'sml-private',
      vendor_name_raw: 'PT. SML INDONESIA PRIVATE',
      total_amount: 100,
      subtotal: 100,
      invoice_type: 'INVOICE',
      mpo_number: 'MPO001234',
    }, 'joy-user', 'PURCHASING_COORDINATOR')).rejects.toMatchObject({ statusCode: 409 });
    expect(invoiceCreate).not.toHaveBeenCalled();

    invoiceFindMany.mockResolvedValueOnce([{
      id: 'existing-invoice',
      invoice_number: 'IA-00123',
      status: 'PENDING_MANAGER',
      vendor_id: 'sml-private',
      vendor_name_raw: 'PT. SML INDONESIA PRIVATE',
      normalized_invoice_number: 'IA00123',
      mpo_number: 'MPO001234',
      mpo_base_number: 'MPO001234',
      mpo_order_sequence: null,
      material_code: null,
      customer_po_number: null,
      invoice_hash: null,
    }]);

    await createInvoice({
      invoice_number: 'IA/00123',
      vendor_id: 'sml-private',
      vendor_name_raw: 'PT. SML INDONESIA PRIVATE',
      total_amount: 100,
      subtotal: 100,
      invoice_type: 'INVOICE',
      mpo_number: 'MPO009999',
    }, 'joy-user', 'PURCHASING_COORDINATOR');
    expect(invoiceCreate).toHaveBeenCalledTimes(1);
  });
});
