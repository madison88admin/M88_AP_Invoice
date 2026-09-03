import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const { invoiceFindUnique, paymentFindFirst, paymentCreate, stageTimestampFindFirst, stageTimestampCreate, invoiceUpdate, auditLogCreate, notificationCreate, notificationNotifyStageTransition, exceptionFindFirst, exceptionCreate, nextGenGetFullPOByMPO } = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentCreate: vi.fn(),
  stageTimestampFindFirst: vi.fn(),
  stageTimestampCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationNotifyStageTransition: vi.fn(),
  exceptionFindFirst: vi.fn(),
  exceptionCreate: vi.fn(),
  nextGenGetFullPOByMPO: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    payment: { findFirst: paymentFindFirst, create: paymentCreate },
    stageTimestamp: { findFirst: stageTimestampFindFirst, create: stageTimestampCreate },
    auditLog: { create: auditLogCreate },
    exception: { findFirst: exceptionFindFirst, create: exceptionCreate },
  },
}));

vi.mock('./nextGenService', () => ({
  nextGenService: {
    getFullPOByMPO: nextGenGetFullPOByMPO,
    getFullPO: vi.fn(),
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: notificationCreate, notifyStageTransition: notificationNotifyStageTransition },
}));

vi.mock('./notificationService', () => ({
  sendPaymentConfirmationToSupplier: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { deriveGLAccount, schedulePayment, postInvoice } from './postingService';

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'inv-1',
    invoice_number: overrides.invoice_number ?? 'INV-001',
    total_amount: overrides.total_amount ?? 100,
    currency: overrides.currency ?? 'USD',
    due_date: overrides.due_date ?? new Date('2026-08-15'),
    status: 'POSTED_TO_QB',
    vendor_id: overrides.vendor_id ?? 'vendor-1',
    revision: overrides.revision ?? 1,
    vendor: overrides.vendor ?? {
      name: 'Test Vendor', beneficiary_name: 'Test Vendor', bank_name: 'Test Bank',
      bank_address: 'Test Address', swift_code: 'TESTUS00', aba_routing_number: null, account_number: '123456', bank_verified_at: new Date('2026-08-01'),
    },
  };
}

beforeEach(() => {
  invoiceFindUnique.mockReset();
  paymentCreate.mockReset();
  paymentFindFirst.mockReset();
  stageTimestampFindFirst.mockReset();
  stageTimestampCreate.mockReset();
  invoiceUpdate.mockReset();
  auditLogCreate.mockReset();
  notificationCreate.mockReset();
  notificationNotifyStageTransition.mockReset();
  exceptionFindFirst.mockReset();
  exceptionCreate.mockReset();
  nextGenGetFullPOByMPO.mockReset();
  vi.unstubAllEnvs();

  stageTimestampFindFirst.mockResolvedValue(null);
  paymentCreate.mockResolvedValue({ id: 'pay-1', status: 'SCHEDULED' });
  paymentFindFirst.mockResolvedValue(null);
  exceptionFindFirst.mockResolvedValue(null);
  exceptionCreate.mockResolvedValue({});
});

describe('posting document mappings', () => {
  it('maps a Debit Note to the operational-expense GL instead of manual-review hold', () => {
    expect(deriveGLAccount('DEBIT_NOTE')).toBe('6000-Operational Expenses');
  });
});

describe('schedulePayment — sub-$100 hold (item 8)', () => {
  it('holds payments under the threshold as HELD_BELOW_100 and notifies Accounting Supervisor', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ total_amount: 59.67 }));
    paymentCreate.mockResolvedValue({ id: 'pay-held', status: 'HELD_BELOW_100' });

    const payment = await schedulePayment('inv-1', undefined, 'assoc-1');

    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'HELD_BELOW_100',
        payment_date_source: 'DUE_DATE',
      }),
    }));
    expect(payment.status).toBe('HELD_BELOW_100');

    // Accounting Supervisor owns payment holds and release approval.
    const holdNotification = notificationCreate.mock.calls[0][0];
    expect(holdNotification.target_role).toBe('ACCOUNTING_SUPERVISOR');
    expect(holdNotification.type).toBe('warning');
    expect(holdNotification.category).toBe('payment');
    expect(holdNotification.title).toContain('held');

    // Audit note documents the hold + Purchasing notification.
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PAYMENT_SCHEDULED',
        note: expect.stringContaining('HELD_BELOW_100'),
      }),
    }));
  });

  it('schedules payments at or above the threshold as SCHEDULED with no Purchasing hold notification', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ total_amount: 150 }));

    const payment = await schedulePayment('inv-1', undefined, 'assoc-1');

    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'SCHEDULED',
        payment_date_source: 'DUE_DATE',
      }),
    }));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('uses the manual payment date and records MANUAL source even when held', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ total_amount: 59.67 }));
    paymentCreate.mockResolvedValue({ id: 'pay-held', status: 'HELD_BELOW_100' });

    await schedulePayment('inv-1', new Date('2026-09-01'), 'assoc-1');

    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'HELD_BELOW_100',
        payment_date_source: 'MANUAL',
      }),
    }));
  });

  it('accepts a verified ABA routing number when a domestic vendor has no SWIFT code', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({
      vendor: {
        name: 'US Vendor', beneficiary_name: 'US Vendor', bank_name: 'US Bank',
        bank_address: 'New York, US', swift_code: null, aba_routing_number: '021000021',
        account_number: '123456', bank_verified_at: new Date('2026-08-01'),
      },
    }));

    await schedulePayment('inv-1', undefined, 'assoc-1');

    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        swift_code_snapshot: null,
        aba_routing_number_snapshot: '021000021',
      }),
    }));
  });
});

describe('postInvoice — the sub-$100 hold lives at scheduling, not posting', () => {
  function makePostableInvoice(overrides: Record<string, any> = {}) {
    return {
      id: 'inv-post',
      invoice_number: 'INV-LOW',
      invoice_type: 'INVOICE',
      invoice_date: new Date('2026-08-01'),
      due_date: new Date('2026-08-15'),
      total_amount: 59.67,
      currency: 'USD',
      mpo_number: null,
      po_number: null,
      brand: 'SAMPLE',
      brand_code: 'SMP',
      season: 'FW26',
      order_type: 'BULK',
      qb_memo: null,
      vendor_id: 'vendor-1',
      vendor: {
        id: 'vendor-1', name: 'Low Vendor', beneficiary_name: 'Low Vendor', supplier_location: 'HK',
        bank_name: 'Test Bank', bank_address: 'Test Address', swift_code: 'TESTHK00',
        account_number: '123456', bank_verified_at: new Date('2026-08-01'),
      },
      // All approvals complete — posting must not require more sign-offs.
      signatures: [
        { signed_at: new Date(), ocr_detected: false, invalidated_at: null, invoice_revision: 1, approval_status: 'APPROVED' },
        { signed_at: new Date(), ocr_detected: false, invalidated_at: null, invoice_revision: 1, approval_status: 'APPROVED' },
      ],
      exceptions: [],
      invoice_lines: [],
      revision: 1,
      status: 'PENDING_ACCOUNTING',
      ...overrides,
    };
  }

  it('posts a sub-$100 invoice and holds its payment at scheduling (HELD_BELOW_100) instead of blocking on vendor cumulative', async () => {
    invoiceFindUnique
      .mockResolvedValueOnce(makePostableInvoice())
      .mockResolvedValueOnce(makePostableInvoice({ status: 'POSTED_TO_QB' }));
    invoiceUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});
    stageTimestampCreate.mockResolvedValue({});
    paymentCreate.mockResolvedValue({ id: 'pay-held', status: 'HELD_BELOW_100' });

    // postInvoice returns a union (ON_HOLD branch vs posted branch) — the posted
    // branch is what we expect here, so narrow it for the assertions.
    const result = (await postInvoice('inv-post', 'assoc-1')) as { success: boolean; payment_scheduled: boolean };

    expect(result.success).toBe(true);
    expect(result.payment_scheduled).toBe(true);
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'POSTED_TO_QB' }),
    }));
    // The payment reached scheduling and was held the correct way.
    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'HELD_BELOW_100' }),
    }));
    // No vendor-cumulative auto-hold audit entry.
    expect(auditLogCreate.mock.calls.some((c: any) => c[0]?.data?.action === 'ACCOUNTING_AUTO_HOLD')).toBe(false);
  });

  it('posts a legacy invoice that only has OCR-detected signatures (no workflow signatures)', async () => {
    const ocrOnly = makePostableInvoice({
      signatures: [
        { signed_at: new Date(), ocr_detected: true, invalidated_at: null, invoice_revision: 1, approval_status: 'APPROVED' },
        { signed_at: new Date(), ocr_detected: true, invalidated_at: null, invoice_revision: 1, approval_status: 'APPROVED' },
      ],
    });
    invoiceFindUnique
      .mockResolvedValueOnce(ocrOnly)
      .mockResolvedValueOnce(ocrOnly);
    invoiceUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});
    stageTimestampCreate.mockResolvedValue({});
    paymentCreate.mockResolvedValue({ id: 'pay-1', status: 'SCHEDULED' });

    const result = (await postInvoice('inv-post', 'assoc-1')) as { success: boolean };
    expect(result.success).toBe(true);
  });

  it('rejects a legacy OCR-only invoice whose OCR signatures are not all signed', async () => {
    const ocrOnly = makePostableInvoice({
      signatures: [
        { signed_at: new Date(), ocr_detected: true, invalidated_at: null, invoice_revision: 1, approval_status: 'APPROVED' },
        { signed_at: null, ocr_detected: true, invalidated_at: null, invoice_revision: 1, approval_status: 'APPROVED' },
      ],
    });
    invoiceFindUnique.mockResolvedValueOnce(ocrOnly);

    await expect(postInvoice('inv-post', 'assoc-1')).rejects.toThrow('All approvals must be completed before posting');
  });

  it('keeps a missing NextGen PO advisory and continues posting in advisory mode', async () => {
    vi.stubEnv('FINANCE_ENFORCEMENT_MODE', 'advisory');
    const poBacked = makePostableInvoice({ mpo_number: 'MPO016019', total_amount: 150 });
    invoiceFindUnique
      .mockResolvedValueOnce(poBacked)
      .mockResolvedValueOnce({ ...poBacked, status: 'POSTED_TO_QB' });
    nextGenGetFullPOByMPO.mockResolvedValue(null);
    invoiceUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});
    stageTimestampCreate.mockResolvedValue({});

    const result = (await postInvoice('inv-post', 'assoc-1')) as { success: boolean; payment_scheduled: boolean };

    expect(result.success).toBe(true);
    expect(result.payment_scheduled).toBe(true);
    expect(exceptionCreate).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PRE_POST_WARNINGS' }),
    }));
  });

  it('does not let an existing pending NextGen advisory block an approved invoice', async () => {
    vi.stubEnv('FINANCE_ENFORCEMENT_MODE', 'advisory');
    const invoice = makePostableInvoice({
      invoice_number: 'IA00501606',
      mpo_number: 'MPO016019',
      total_amount: 371.06,
      exceptions: [{
        id: 'nextgen-advisory-1',
        reason: 'PO_NOT_FOUND',
        status: 'PENDING',
        detail: 'NextGen critical data changed: amount from 350.76 to 371.06',
      }],
    });
    invoiceFindUnique
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce({ ...invoice, status: 'POSTED_TO_QB' });
    nextGenGetFullPOByMPO.mockResolvedValue(null);
    invoiceUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});
    stageTimestampCreate.mockResolvedValue({});

    const result = (await postInvoice('inv-post', 'assoc-1')) as { success: boolean; payment_scheduled: boolean };

    expect(result.success).toBe(true);
    expect(result.payment_scheduled).toBe(true);
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'POSTED_TO_QB' }),
    }));
  });

  it('moves a missing NextGen PO to ON_HOLD only when Finance strict mode is enabled', async () => {
    vi.stubEnv('FINANCE_ENFORCEMENT_MODE', 'strict');
    const poBacked = makePostableInvoice({ mpo_number: 'MPO016019', total_amount: 150 });
    invoiceFindUnique.mockResolvedValueOnce(poBacked);
    nextGenGetFullPOByMPO.mockResolvedValue(null);
    invoiceUpdate.mockResolvedValue({});
    auditLogCreate.mockResolvedValue({});

    const result = (await postInvoice('inv-post', 'assoc-1')) as { posted: boolean; status: string };

    expect(result).toMatchObject({ posted: false, status: 'ON_HOLD' });
    expect(exceptionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ detail: expect.stringContaining('[PRE-POST BLOCK]') }),
    }));
    expect(paymentCreate).not.toHaveBeenCalled();
  });
});
