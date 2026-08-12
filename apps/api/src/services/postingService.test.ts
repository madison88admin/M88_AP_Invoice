import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const { invoiceFindUnique, paymentCreate, stageTimestampFindFirst, stageTimestampCreate, invoiceUpdate, auditLogCreate, notificationCreate, notificationNotifyStageTransition } = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  paymentCreate: vi.fn(),
  stageTimestampFindFirst: vi.fn(),
  stageTimestampCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationNotifyStageTransition: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    payment: { create: paymentCreate },
    stageTimestamp: { findFirst: stageTimestampFindFirst, create: stageTimestampCreate },
    auditLog: { create: auditLogCreate },
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

import { schedulePayment, postInvoice } from './postingService';

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'inv-1',
    invoice_number: overrides.invoice_number ?? 'INV-001',
    total_amount: overrides.total_amount ?? 100,
    currency: overrides.currency ?? 'USD',
    due_date: overrides.due_date ?? new Date('2026-08-15'),
    status: 'POSTED_TO_QB',
    vendor_id: overrides.vendor_id ?? 'vendor-1',
    vendor: overrides.vendor ?? { name: 'Test Vendor' },
  };
}

beforeEach(() => {
  invoiceFindUnique.mockReset();
  paymentCreate.mockReset();
  stageTimestampFindFirst.mockReset();
  stageTimestampCreate.mockReset();
  invoiceUpdate.mockReset();
  auditLogCreate.mockReset();
  notificationCreate.mockReset();
  notificationNotifyStageTransition.mockReset();

  stageTimestampFindFirst.mockResolvedValue(null);
  paymentCreate.mockResolvedValue({ id: 'pay-1', status: 'SCHEDULED' });
});

describe('schedulePayment — sub-$100 hold (item 8)', () => {
  it('holds payments under the threshold as HELD_BELOW_100 and notifies Purchasing', async () => {
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

    // Purchasing Coordinator is notified of the hold with release guidance.
    const holdNotification = notificationCreate.mock.calls[0][0];
    expect(holdNotification.target_role).toBe('PURCHASING_COORDINATOR');
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
      vendor: { id: 'vendor-1', name: 'Low Vendor', supplier_location: 'HK' },
      // All approvals complete — posting must not require more sign-offs.
      signatures: [{ signed_at: new Date() }, { signed_at: new Date() }],
      exceptions: [],
      invoice_lines: [],
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
});
