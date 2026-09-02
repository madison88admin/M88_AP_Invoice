import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  invoiceFindFirst,
  invoiceCreate,
  auditLogCreate,
  notifyStageTransition,
} = vi.hoisted(() => ({
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  auditLogCreate: vi.fn(),
  notifyStageTransition: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findFirst: invoiceFindFirst, create: invoiceCreate },
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
      subtotal: 'N/A',
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
        subtotal: null,
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
});
