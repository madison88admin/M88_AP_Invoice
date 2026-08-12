import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const { paymentFindMany, auditLogFindMany, paymentUpdateMany, auditLogCreate, paymentBatchFindUnique, paymentUpdate, paymentBatchUpdate, billStubUpsert, invoiceUpdate, paymentCount, paymentFindUnique, notificationCreate } = vi.hoisted(() => ({
  paymentFindMany: vi.fn(),
  auditLogFindMany: vi.fn(),
  paymentUpdateMany: vi.fn(),
  auditLogCreate: vi.fn(),
  paymentBatchFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  paymentBatchUpdate: vi.fn(),
  billStubUpsert: vi.fn(),
  invoiceUpdate: vi.fn(),
  paymentCount: vi.fn(),
  paymentFindUnique: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    payment: { findMany: paymentFindMany, updateMany: paymentUpdateMany, update: paymentUpdate, count: paymentCount, findUnique: paymentFindUnique },
    paymentBatch: { findUnique: paymentBatchFindUnique, update: paymentBatchUpdate },
    invoice: { update: invoiceUpdate },
    billStub: { upsert: billStubUpsert },
    auditLog: { findMany: auditLogFindMany, create: auditLogCreate },
    // Callback-form transaction: run the callback against the same mocked models.
    $transaction: (fn: any) => fn({
      payment: { findMany: paymentFindMany, updateMany: paymentUpdateMany, update: paymentUpdate },
      auditLog: { findMany: auditLogFindMany, create: auditLogCreate },
    }),
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: notificationCreate, notifyStageTransition: vi.fn() },
}));

import { getScheduledPaymentsForBatch, bulkApprovePaymentsForPayment, applyBankCharge, removeBankCharge, endorseBillStub, matchPaymentConfirmation, approveHeldPayment } from './paymentBatchService';

/** Midnight n days ago (avoids DST / time-of-day flakiness in aging math). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function makePayment(overrides: Record<string, any> = {}) {
  const invoice = overrides.invoice ?? {};
  return {
    id: overrides.id ?? 'pay-1',
    invoice_id: overrides.invoice_id ?? 'inv-1',
    amount: overrides.amount ?? 100,
    currency: overrides.currency ?? 'USD',
    payment_date: overrides.payment_date ?? new Date(),
    payment_date_source: overrides.payment_date_source ?? 'DUE_DATE',
    status: overrides.status ?? 'SCHEDULED',
    bank_charge_amount: overrides.bank_charge_amount ?? null,
    bank_charge_note: overrides.bank_charge_note ?? null,
    bill_stub: overrides.bill_stub ?? null,
    selected_for_batch: false,
    remarks: overrides.remarks ?? null,
    invoice: {
      id: invoice.id ?? 'inv-1',
      invoice_number: invoice.invoice_number ?? 'INV-001',
      invoice_date: invoice.invoice_date ?? null,
      due_date: invoice.due_date ?? null,
      brand: invoice.brand ?? null,
      category: invoice.category ?? null,
      qb_memo: invoice.qb_memo ?? null,
      vendor: invoice.vendor ?? { name: 'Test Vendor' },
      signatures: invoice.signatures ?? [],
    },
  };
}

function lastFindManyCall() {
  // findMany receives a single options object
  return paymentFindMany.mock.calls[paymentFindMany.mock.calls.length - 1][0];
}

function makeBatch(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'batch-1',
    batch_number: overrides.batch_number ?? 'PB202608110001',
    status: overrides.status ?? 'DRAFT',
    payments: overrides.payments ?? [makePayment({ id: 'pay-1', invoice_id: 'inv-1' })],
  };
}

beforeEach(() => {
  paymentFindMany.mockReset();
  auditLogFindMany.mockReset();
  paymentUpdateMany.mockReset();
  auditLogCreate.mockReset();
  paymentBatchFindUnique.mockReset();
  paymentUpdate.mockReset();
  paymentBatchUpdate.mockReset();
  billStubUpsert.mockReset();
  invoiceUpdate.mockReset();
  paymentCount.mockReset();
  paymentFindUnique.mockReset();
  notificationCreate.mockReset();
});

describe('getScheduledPaymentsForBatch', () => {
  it('builds the default query: batchable statuses only, no implicit payment-date bound (past-due invoices stay visible)', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({});

    const options = lastFindManyCall();
    expect(options.where.status).toEqual({ in: ['SCHEDULED', 'APPROVED_FOR_PAYMENT'] });
    expect(options.where.batch_id).toBeNull();
    expect(options.where.payment_date).toEqual({});
  });

  it('honors an explicit dateFrom bound on payment_date when provided', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ dateFrom: '2026-08-01' });

    const options = lastFindManyCall();
    expect(options.where.payment_date).toEqual({ gte: new Date('2026-08-01') });
  });

  it('passes an explicit status through (e.g. FOR_PAYMENT queue)', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ status: 'FOR_PAYMENT' });

    const options = lastFindManyCall();
    expect(options.where.status).toBe('FOR_PAYMENT');
    expect(options.where.payment_date).toEqual({});
  });

  it('filters due dates to the selected due-month cut-off (YYYY-MM)', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ dueMonth: '2026-03' });

    const options = lastFindManyCall();
    expect(options.where.invoice.due_date).toEqual({
      gte: new Date(Date.UTC(2026, 2, 1)),
      lte: new Date(Date.UTC(2026, 3, 0, 23, 59, 59, 999)),
    });
  });

  it('places the held-payments OR at the TOP level of where (regression: field-level status OR is invalid Prisma and 500s the cut-off view)', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ dueMonth: '2026-08' });

    const options = lastFindManyCall();
    // Prisma rejects `status: { OR: [...] }` containing nested `status` filters
    // (Unknown argument `OR`) — the OR must be a top-level where condition.
    expect(options.where.status).toBeUndefined();
    expect(options.where.OR).toEqual([
      { status: { in: ['SCHEDULED', 'APPROVED_FOR_PAYMENT'] } },
      { status: 'HELD_BELOW_100', invoice: { due_date: options.where.invoice.due_date } },
    ]);
  });

  it('applies explicit due-date ranges (dueFrom/dueTo)', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ dueFrom: '2026-05-01', dueTo: '2026-05-15' });

    const options = lastFindManyCall();
    expect(options.where.invoice.due_date).toEqual({
      gte: new Date('2026-05-01'),
      lte: new Date('2026-05-15T23:59:59.999Z'),
    });
  });

  it('lets the due-month cut-off take precedence when both are provided', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ dueFrom: '2026-05-01', dueTo: '2026-05-15', dueMonth: '2026-05' });

    const options = lastFindManyCall();
    expect(options.where.invoice.due_date).toEqual({
      gte: new Date(Date.UTC(2026, 4, 1)),
      lte: new Date(Date.UTC(2026, 5, 0, 23, 59, 59, 999)),
    });
  });

  it('filters by manager approval-date range via signatures', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ approvalFrom: '2026-01-01', approvalTo: '2026-01-31' });

    const options = lastFindManyCall();
    expect(options.where.invoice.signatures.some).toEqual({
      signatory_role: 'PURCHASING_MANAGER',
      signed_at: {
        gte: new Date('2026-01-01'),
        lte: new Date('2026-01-31T23:59:59.999Z'),
      },
    });
  });

  it('filters by brand and memo (qb_memo) case-insensitively', async () => {
    paymentFindMany.mockResolvedValue([]);
    auditLogFindMany.mockResolvedValue([]);

    await getScheduledPaymentsForBatch({ brand: 'SAMPLE', memo: 'trims' });

    const options = lastFindManyCall();
    expect(options.where.invoice.brand).toEqual({ contains: 'SAMPLE', mode: 'insensitive' });
    expect(options.where.invoice.qb_memo).toEqual({ contains: 'trims', mode: 'insensitive' });
  });

  it('applies the aging filter in memory (0–30 days overdue)', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'p10', invoice: { due_date: daysAgo(10) } }),
      makePayment({ id: 'p-future', invoice: { due_date: daysAgo(-5) } }),
      makePayment({ id: 'p-null' }),
      makePayment({ id: 'p40', invoice: { due_date: daysAgo(40) } }),
    ]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({ aging: '0-30' });

    expect(result.payments.map((p: any) => p.id)).toEqual(['p10']);
    expect(result.filtered_count).toBe(1);
  });

  it('applies the not-due aging filter (due date in the future)', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'p10', invoice: { due_date: daysAgo(10) } }),
      makePayment({ id: 'p-future', invoice: { due_date: daysAgo(-5) } }),
    ]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({ aging: 'not-due' });

    expect(result.payments.map((p: any) => p.id)).toEqual(['p-future']);
  });

  it('applies the overdue aging filter (any due date in the past)', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'p10', invoice: { due_date: daysAgo(10) } }),
      makePayment({ id: 'p40', invoice: { due_date: daysAgo(40) } }),
      makePayment({ id: 'p90', invoice: { due_date: daysAgo(90) } }),
      makePayment({ id: 'p-today', invoice: { due_date: daysAgo(0) } }),
      makePayment({ id: 'p-future', invoice: { due_date: daysAgo(-5) } }),
      makePayment({ id: 'p-null' }),
    ]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({ aging: 'overdue' });

    expect(result.payments.map((p: any) => p.id)).toEqual(['p10', 'p40', 'p90']);
    expect(result.filtered_count).toBe(3);
  });

  it('computes filtered totals per currency from only the filtered rows', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'p1', amount: 100, currency: 'USD' }),
      makePayment({ id: 'p2', amount: 250.5, currency: 'USD' }),
      makePayment({ id: 'p3', amount: 33.33, currency: 'USD' }),
      makePayment({ id: 'p4', amount: 80, currency: 'EUR' }),
    ]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({});

    expect(result.filtered_count).toBe(4);
    expect(result.totals).toHaveLength(2);
    const usd = result.totals.find((t) => t.currency === 'USD')!;
    const eur = result.totals.find((t) => t.currency === 'EUR')!;
    expect(usd.count).toBe(3);
    expect(usd.total).toBe(383.83);
    expect(eur.count).toBe(1);
    expect(eur.total).toBe(80);
  });

  it('respects the aging filter when computing totals (totals match the filtered set)', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'p1', amount: 100, currency: 'USD', invoice: { due_date: daysAgo(10) } }),
      makePayment({ id: 'p2', amount: 500, currency: 'USD', invoice: { due_date: daysAgo(90) } }),
    ]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({ aging: '0-30' });

    expect(result.payments.map((p: any) => p.id)).toEqual(['p1']);
    expect(result.totals).toEqual([{ currency: 'USD', count: 1, total: 100 }]);
  });

  it('enriches rows with derived fields and supervisor notes from the audit log', async () => {
    const signedAt = new Date('2026-01-15T03:00:00.000Z');
    paymentFindMany.mockResolvedValue([
      makePayment({
        id: 'pay-1',
        amount: 250.5,
        remarks: 'Lab testing to consolidate',
        invoice: {
          invoice_number: 'INV-100',
          invoice_date: new Date('2026-01-10'),
          due_date: daysAgo(3),
          brand: 'SAMPLE',
          category: 'TRIMS',
          qb_memo: 'Trims for Q2',
          signatures: [{ signed_at: signedAt }],
        },
      }),
    ]);
    auditLogFindMany.mockResolvedValue([
      { invoice_id: 'inv-1', action: 'FOR_PAYMENT_REJECTED', note: 'Missing lab report' },
    ]);

    const result = await getScheduledPaymentsForBatch({});

    expect(result.payments).toHaveLength(1);
    const p = result.payments[0] as any;
    expect(p.invoice.invoice_number).toBe('INV-100');
    expect(p.invoice_date).toEqual(new Date('2026-01-10'));
    expect(p.due_date).toEqual(daysAgo(3));
    expect(p.brand).toBe('SAMPLE');
    expect(p.category).toBe('TRIMS');
    expect(p.qb_memo).toBe('Trims for Q2');
    expect(p.approval_date).toEqual(signedAt);
    expect(p.aging_days).toBe(3);
    expect(p.open_balance).toBe(250.5);
    expect(p.remarks).toBe('Lab testing to consolidate');
    expect(p.supervisor_action).toBe('FOR_PAYMENT_REJECTED');
    expect(p.supervisor_note).toBe('Missing lab report');
    // signatures are not leaked into the flattened invoice object
    expect((p.invoice as any).signatures).toBeUndefined();
  });

  it('derives payment_date_from_due from the stored source — not date equality', async () => {
    // p-manual has the SAME date as the due date, but the stored source says
    // MANUAL — the flag must be false (previously date equality would have
    // mislabeled it as due-derived).
    const derivedDate = daysAgo(5);
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'p-derived', payment_date_source: 'DUE_DATE', payment_date: derivedDate, invoice: { due_date: derivedDate } }),
      makePayment({ id: 'p-manual', payment_date_source: 'MANUAL', payment_date: derivedDate, invoice: { due_date: derivedDate } }),
      makePayment({ id: 'p-default', payment_date_source: 'DEFAULT' }),
    ]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({});

    const byId = new Map(result.payments.map((p: any) => [p.id, p]));
    expect(byId.get('p-derived').payment_date_source).toBe('DUE_DATE');
    expect(byId.get('p-derived').payment_date_from_due).toBe(true);
    expect(byId.get('p-manual').payment_date_source).toBe('MANUAL');
    expect(byId.get('p-manual').payment_date_from_due).toBe(false);
    expect(byId.get('p-default').payment_date_source).toBe('DEFAULT');
    expect(byId.get('p-default').payment_date_from_due).toBe(false);
  });

  it('leaves supervisor notes null when the audit log has no matching entries', async () => {
    paymentFindMany.mockResolvedValue([makePayment({ id: 'pay-1' })]);
    auditLogFindMany.mockResolvedValue([]);

    const result = await getScheduledPaymentsForBatch({});

    expect(result.payments[0].supervisor_action).toBeNull();
    expect(result.payments[0].supervisor_note).toBeNull();
  });
});

describe('bulkApprovePaymentsForPayment', () => {
  it('approves all FOR_PAYMENT payments and audit-logs each invoice', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'pay-1', invoice_id: 'inv-1', status: 'FOR_PAYMENT' }),
      makePayment({ id: 'pay-2', invoice_id: 'inv-2', status: 'FOR_PAYMENT' }),
    ]);

    const result = await bulkApprovePaymentsForPayment(['pay-1', 'pay-2'], 'Batch 3', 'sup-1');

    expect(result).toEqual({ approved: 2 });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pay-1', 'pay-2'] } },
      data: { status: 'APPROVED_FOR_PAYMENT' },
    });
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { invoice_id: 'inv-1', action: 'FOR_PAYMENT_APPROVED', performed_by: 'sup-1', note: 'Batch 3' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { invoice_id: 'inv-2', action: 'FOR_PAYMENT_APPROVED', performed_by: 'sup-1', note: 'Batch 3' },
    });
  });

  it('records the default note when none is provided', async () => {
    paymentFindMany.mockResolvedValue([makePayment({ id: 'pay-1', invoice_id: 'inv-1', status: 'FOR_PAYMENT' })]);

    await bulkApprovePaymentsForPayment(['pay-1'], undefined, 'sup-1');

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { invoice_id: 'inv-1', action: 'FOR_PAYMENT_APPROVED', performed_by: 'sup-1', note: 'Payment approved for processing by supervisor (bulk)' },
    });
  });

  it('throws when none of the selected payments are awaiting review', async () => {
    paymentFindMany.mockResolvedValue([]);

    await expect(bulkApprovePaymentsForPayment(['pay-1'], undefined, 'sup-1'))
      .rejects.toThrow('No payments are awaiting review');
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('throws when some selected payments are no longer FOR_PAYMENT (stale queue)', async () => {
    paymentFindMany.mockResolvedValue([
      makePayment({ id: 'pay-1', status: 'FOR_PAYMENT' }),
      // pay-2 is missing from the found set (e.g. already approved by another session)
    ]);

    await expect(bulkApprovePaymentsForPayment(['pay-1', 'pay-2'], undefined, 'sup-1'))
      .rejects.toThrow('no longer awaiting review');
    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it('requires at least one payment id', async () => {
    await expect(bulkApprovePaymentsForPayment([], undefined, 'sup-1'))
      .rejects.toThrow('Select at least one payment to approve');
  });
});

describe('applyBankCharge', () => {
  it('applies the charge to one payment and recomputes the batch total', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      payments: [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100 }),
        makePayment({ id: 'pay-2', invoice_id: 'inv-2', amount: 50 }),
      ],
    }));

    const result = await applyBankCharge('batch-1', 'pay-1', 25.5, 'wire fee', 'assoc-1');

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { bank_charge_amount: 25.5, bank_charge_note: 'wire fee' },
    });
    // 100 + 50 + 25.5 charge = 175.5
    expect(paymentBatchUpdate).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { total_amount: '175.50' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        invoice_id: 'inv-1',
        action: 'BANK_CHARGE_APPLIED',
        performed_by: 'assoc-1',
        note: expect.stringContaining('25.50'),
      },
    });
    expect(result).toMatchObject({ payment_id: 'pay-1', bank_charge_amount: 25.5, total_amount: 175.5 });
  });

  it('blocks a second charge in the same batch (one per vendor per batch)', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      payments: [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, bank_charge_amount: 10 }),
        makePayment({ id: 'pay-2', invoice_id: 'inv-2', amount: 50 }),
      ],
    }));

    await expect(applyBankCharge('batch-1', 'pay-2', 15, undefined, 'assoc-1'))
      .rejects.toThrow('already has a bank charge');
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(paymentBatchUpdate).not.toHaveBeenCalled();
  });

  it('rejects a payment that is not part of the batch', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      payments: [makePayment({ id: 'pay-1', invoice_id: 'inv-1' })],
    }));

    await expect(applyBankCharge('batch-1', 'pay-99', 10, undefined, 'assoc-1'))
      .rejects.toThrow('Payment is not part of this batch');
  });

  it('only allows the charge while the batch is DRAFT or RETURNED_FOR_CORRECTION', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({ status: 'REVIEWED' }));

    await expect(applyBankCharge('batch-1', 'pay-1', 10, undefined, 'assoc-1'))
      .rejects.toThrow('draft or returned for correction');
  });

  it('requires a positive amount', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch());

    await expect(applyBankCharge('batch-1', 'pay-1', 0, undefined, 'assoc-1'))
      .rejects.toThrow('positive amount');
    await expect(applyBankCharge('batch-1', 'pay-1', -5, undefined, 'assoc-1'))
      .rejects.toThrow('positive amount');
  });
});

describe('removeBankCharge', () => {
  it('clears the charge and restores the batch total to payments-only', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      payments: [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, bank_charge_amount: 25.5, bank_charge_note: 'wire fee' }),
        makePayment({ id: 'pay-2', invoice_id: 'inv-2', amount: 50 }),
      ],
    }));

    const result = await removeBankCharge('batch-1', 'pay-1', 'assoc-1');

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { bank_charge_amount: null, bank_charge_note: null },
    });
    // 100 + 50, charge removed
    expect(paymentBatchUpdate).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { total_amount: '150.00' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { invoice_id: 'inv-1', action: 'BANK_CHARGE_REMOVED', performed_by: 'assoc-1', note: expect.stringContaining('pay-1') },
    });
    expect(result).toMatchObject({ payment_id: 'pay-1', bank_charge_amount: null, total_amount: 150 });
  });

  it('rejects removal when the payment has no charge', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      payments: [makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100 })],
    }));

    await expect(removeBankCharge('batch-1', 'pay-1', 'assoc-1'))
      .rejects.toThrow('has no bank charge to remove');
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('only allows removal while the batch is DRAFT or RETURNED_FOR_CORRECTION', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      status: 'EXPORTED_TO_BANK',
      payments: [makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, bank_charge_amount: 10 })],
    }));

    await expect(removeBankCharge('batch-1', 'pay-1', 'assoc-1'))
      .rejects.toThrow('draft or returned for correction');
  });
});

describe('endorseBillStub', () => {
  it('endorses a bill stub, tags the payment ENDORSED, and audits it', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      status: 'EXPORTED_TO_BANK',
      payments: [makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, status: 'APPROVED_FOR_PAYMENT' })],
    }));
    billStubUpsert.mockResolvedValue({ id: 'stub-1', payment_id: 'pay-1' });

    const result = await endorseBillStub('batch-1', 'pay-1', {
      stubDate: '2026-08-10',
      type: 'Bank Transfer',
      reference: 'REF-123',
      originalAmount: 100,
      balance: 0,
      discount: 0,
      paidAmount: 100,
    }, 'assoc-1');

    expect(billStubUpsert).toHaveBeenCalledWith({
      where: { payment_id: 'pay-1' },
      create: expect.objectContaining({ payment_id: 'pay-1', batch_id: 'batch-1', reference: 'REF-123', paid_amount: 100 }),
      update: expect.objectContaining({ reference: 'REF-123' }),
    });
    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'ENDORSED' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoice_id: 'inv-1', action: 'BILL_STUB_ENDORSED', note: expect.stringContaining('REF-123') }),
    });
    expect(result).toMatchObject({ payment_status: 'ENDORSED' });
  });

  it('only allows endorsement for reviewed/exported batches', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({ status: 'DRAFT' }));

    await expect(endorseBillStub('batch-1', 'pay-1', { paidAmount: 100 }, 'assoc-1'))
      .rejects.toThrow('reviewed and exported to the bank');
    expect(billStubUpsert).not.toHaveBeenCalled();
  });

  it('rejects payments not in the batch or already paid', async () => {
    paymentBatchFindUnique.mockResolvedValue(makeBatch({
      status: 'REVIEWED',
      payments: [makePayment({ id: 'pay-1', invoice_id: 'inv-1', status: 'PAID' })],
    }));

    await expect(endorseBillStub('batch-1', 'pay-99', { paidAmount: 100 }, 'assoc-1'))
      .rejects.toThrow('not part of this batch');
    await expect(endorseBillStub('batch-1', 'pay-1', { paidAmount: 100 }, 'assoc-1'))
      .rejects.toThrow('scheduled or supervisor-approved');
    expect(billStubUpsert).not.toHaveBeenCalled();
  });
});

describe('matchPaymentConfirmation', () => {
  function endorsedBatch(overrides: Record<string, any> = {}) {
    return makeBatch({
      status: 'EXPORTED_TO_BANK',
      payments: overrides.payments ?? [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, status: 'ENDORSED', bill_stub: { reference: 'REF-123' } }),
      ],
    });
  }

  it('matches a single ENDORSED payment by reference and tags it PAID', async () => {
    paymentBatchFindUnique.mockResolvedValue(endorsedBatch());
    paymentCount.mockResolvedValue(1);

    const result = await matchPaymentConfirmation('batch-1', { reference: 'REF-123', paidDate: '2026-08-11' }, 'assoc-1');

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: 'PAID', reference: 'REF-123' }),
    });
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'PAID' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PAYMENT_CONFIRMATION_MATCHED' }),
    });
    expect(result).toMatchObject({ matched: 1, batch_processed: false });
  });

  it('throws when the reference matches multiple payments and the amount cannot disambiguate', async () => {
    paymentBatchFindUnique.mockResolvedValue(endorsedBatch({
      payments: [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, status: 'ENDORSED', bill_stub: { reference: 'REF-X' } }),
        makePayment({ id: 'pay-2', invoice_id: 'inv-2', amount: 100, status: 'ENDORSED', bill_stub: { reference: 'REF-X' } }),
      ],
    }));

    await expect(matchPaymentConfirmation('batch-1', { reference: 'REF-X' }, 'assoc-1'))
      .rejects.toThrow('select the matching payments explicitly');
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('uses the amount as the tiebreak when two vendors share the same reference', async () => {
    paymentBatchFindUnique.mockResolvedValue(endorsedBatch({
      payments: [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, status: 'ENDORSED', bill_stub: { reference: 'REF-X' } }),
        makePayment({ id: 'pay-2', invoice_id: 'inv-2', amount: 250, status: 'ENDORSED', bill_stub: { reference: 'REF-X' } }),
      ],
    }));
    paymentCount.mockResolvedValue(1);

    const result = await matchPaymentConfirmation('batch-1', { reference: 'REF-X', amount: 250 }, 'assoc-1');

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay-2' },
      data: expect.objectContaining({ status: 'PAID' }),
    });
    expect(result).toMatchObject({ matched: 1 });
  });

  it('matches explicit selections (e.g. from the exported Excel file)', async () => {
    paymentBatchFindUnique.mockResolvedValue(endorsedBatch({
      payments: [
        makePayment({ id: 'pay-1', invoice_id: 'inv-1', amount: 100, status: 'ENDORSED', bill_stub: { reference: 'REF-1' } }),
        makePayment({ id: 'pay-2', invoice_id: 'inv-2', amount: 200, status: 'ENDORSED', bill_stub: { reference: 'REF-2' } }),
      ],
    }));
    paymentCount.mockResolvedValue(1);

    const result = await matchPaymentConfirmation('batch-1', { paymentIds: ['pay-2'], paidDate: '2026-08-11' }, 'assoc-1');

    expect(paymentUpdate).toHaveBeenCalledTimes(1);
    expect(paymentUpdate.mock.calls[0][0].where.id).toBe('pay-2');
    expect(result).toMatchObject({ matched: 1 });
  });

  it('marks the batch PROCESSED when every payment is PAID', async () => {
    paymentBatchFindUnique.mockResolvedValue(endorsedBatch());
    paymentCount.mockResolvedValue(0);

    const result = await matchPaymentConfirmation('batch-1', { reference: 'REF-123' }, 'assoc-1');

    expect(paymentBatchUpdate).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: expect.objectContaining({ status: 'PROCESSED' }),
    });
    expect(result).toMatchObject({ batch_processed: true });
  });

  it('requires endorsed payments and a reference when not selecting explicitly', async () => {
    paymentBatchFindUnique.mockResolvedValue(endorsedBatch({ payments: [] }));

    await expect(matchPaymentConfirmation('batch-1', { reference: 'REF-X' }, 'assoc-1'))
      .rejects.toThrow('No endorsed payments');

    paymentBatchFindUnique.mockResolvedValue(endorsedBatch());
    await expect(matchPaymentConfirmation('batch-1', {}, 'assoc-1'))
      .rejects.toThrow('reference is required');
  });
});

describe('approveHeldPayment', () => {
  it('releases a HELD_BELOW_100 payment to SCHEDULED and notifies the Associate', async () => {
    paymentFindUnique.mockResolvedValue(makePayment({
      id: 'pay-held',
      invoice_id: 'inv-held',
      status: 'HELD_BELOW_100',
      amount: 59.67,
      invoice: {
        invoice_number: 'INV-HELD',
        vendor: { name: 'Hold Vendor' },
        signatures: [],
      },
    }));
    paymentUpdate.mockResolvedValue({ id: 'pay-held', status: 'SCHEDULED' });

    const result = await approveHeldPayment('pay-held', 'purch-1');

    expect(paymentUpdate).toHaveBeenCalledWith({
      where: { id: 'pay-held' },
      data: { status: 'SCHEDULED' },
    });
    expect(result.status).toBe('SCHEDULED');
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoice_id: 'inv-held',
        action: 'HELD_BELOW_100_APPROVED',
        performed_by: 'purch-1',
      }),
    }));
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      invoice_id: 'inv-held',
      type: 'success',
      category: 'payment',
      target_role: 'ACCOUNTING_ASSOCIATE',
    }));
  });

  it('rejects approval when the payment is not HELD_BELOW_100', async () => {
    paymentFindUnique.mockResolvedValue(makePayment({ id: 'pay-1', status: 'SCHEDULED' }));

    await expect(approveHeldPayment('pay-1', 'purch-1')).rejects.toThrow('Only a held payment');
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it('404s when the payment does not exist', async () => {
    paymentFindUnique.mockResolvedValue(null);

    await expect(approveHeldPayment('missing', 'purch-1')).rejects.toThrow('Payment not found');
    expect(paymentUpdate).not.toHaveBeenCalled();
  });
});
