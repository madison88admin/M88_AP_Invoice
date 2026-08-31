import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoiceFindUnique, invoiceUpdate, signatureUpdateMany, workflowActionCreate, logAuditMock, saveCorrection } = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  signatureUpdateMany: vi.fn(),
  workflowActionCreate: vi.fn(),
  logAuditMock: vi.fn(),
  saveCorrection: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate, findFirst: vi.fn() },
    signature: { updateMany: signatureUpdateMany },
    invoiceWorkflowAction: { create: workflowActionCreate },
    vendor: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('./auditLogService', () => ({
  logAudit: logAuditMock,
  resolveAuditActorNames: vi.fn(),
}));

vi.mock('./fieldDecisionEngine', () => ({
  fieldDecisionEngine: { saveCorrection },
}));

vi.mock('./vendorMatchingService', () => ({ matchVendor: vi.fn() }));
vi.mock('./inAppNotificationService', () => ({ inAppNotificationService: {} }));

import { updateInvoice } from './invoiceService';

function existingInvoice(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-edit',
    invoice_number: 'PCI-26031623',
    invoice_type: 'INVOICE',
    invoice_date: new Date('2026-08-01'),
    due_date: new Date('2026-08-31'),
    total_amount: 100,
    currency: 'USD',
    category: 'TRIMS',
    bill_to_entity: 'MADISON_88_LTD',
    vendor_id: 'vendor-1',
    vendor_name_raw: 'Test Vendor',
    status: 'REJECTED',
    revision: 2,
    ocr_raw_data: null,
    mpo_number: null,
    mpo_base_number: null,
    beneficiary_name: null,
    bank_name: null,
    swift_code: null,
    account_number: null,
    ...overrides,
  };
}

beforeEach(() => {
  invoiceFindUnique.mockReset();
  invoiceUpdate.mockReset();
  signatureUpdateMany.mockReset();
  workflowActionCreate.mockReset();
  logAuditMock.mockReset();
  saveCorrection.mockReset();
  signatureUpdateMany.mockResolvedValue({ count: 1 });
  workflowActionCreate.mockResolvedValue({});
  logAuditMock.mockResolvedValue({});
  saveCorrection.mockResolvedValue({});
});

describe('updateInvoice persistence and re-approval controls', () => {
  it('persists a rejected-invoice correction, increments revision, and restarts validation', async () => {
    const existing = existingInvoice();
    invoiceFindUnique.mockResolvedValue(existing);
    invoiceUpdate.mockImplementation(async ({ data }: any) => ({
      ...existing,
      ...data,
      vendor: null,
      signatures: [],
      exceptions: [],
      stage_timestamps: [],
      // Avoid launching the asynchronous validator inside this focused unit test.
      status: 'REJECTED',
    }));

    const result = await updateInvoice(
      'inv-edit',
      { total_amount: 125, edit_reason: 'Corrected amount from supplier invoice' },
      'coordinator-1',
      'PURCHASING_COORDINATOR',
      'April Joy Diasanta'
    );

    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv-edit' },
      data: expect.objectContaining({
        total_amount: 125,
        revision: 3,
        status: 'VALIDATION_PENDING',
        current_approver_role: null,
      }),
    }));
    expect(signatureUpdateMany).toHaveBeenCalled();
    expect(workflowActionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoice_revision: 3,
        action: 'MATERIAL_EDIT_REVALIDATION_REQUIRED',
      }),
    }));
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      performed_by: 'April Joy Diasanta',
      action: 'INVOICE_UPDATED',
      note: expect.stringContaining('total_amount: "100" → "125"'),
    }));
    expect(result._persisted_values.total_amount).toBe(125);
  });

  it('accepts Debit Note as an editable document type', async () => {
    const existing = existingInvoice({ status: 'RECEIVED' });
    invoiceFindUnique.mockResolvedValue(existing);
    invoiceUpdate.mockImplementation(async ({ data }: any) => ({
      ...existing,
      ...data,
      vendor: null,
      signatures: [],
      exceptions: [],
      stage_timestamps: [],
      status: 'PENDING_COORDINATOR',
    }));

    await expect(updateInvoice(
      'inv-edit',
      { invoice_type: 'DEBIT_NOTE', edit_reason: 'Correct document classification' },
      'coordinator-1',
      'PURCHASING_COORDINATOR',
      'April Joy Diasanta'
    )).resolves.toMatchObject({ invoice_type: 'DEBIT_NOTE' });
  });
});
