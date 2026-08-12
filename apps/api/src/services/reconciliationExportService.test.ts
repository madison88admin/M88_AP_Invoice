import { describe, it, expect, vi, beforeEach } from 'vitest';

const { batchFindMany, auditLogCreate } = vi.hoisted(() => ({
  batchFindMany: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    paymentBatch: { findMany: batchFindMany },
    auditLog: { create: auditLogCreate },
  },
}));

import * as XLSX from 'xlsx';
import { exportPaymentReconciliation } from './reconciliationExportService';

function makePayment(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'pay-1',
    invoice_id: overrides.invoice_id ?? 'inv-1',
    amount: overrides.amount ?? 100,
    currency: overrides.currency ?? 'USD',
    payment_date: overrides.payment_date ?? new Date('2026-08-01'),
    payment_date_source: overrides.payment_date_source ?? 'DUE_DATE',
    status: overrides.status ?? 'APPROVED_FOR_PAYMENT',
    paid_at: overrides.paid_at ?? null,
    reference: overrides.reference ?? null,
    bank_charge_amount: overrides.bank_charge_amount ?? null,
    bank_charge_note: overrides.bank_charge_note ?? null,
    bill_stub: overrides.bill_stub ?? null,
    invoice: overrides.invoice ?? { invoice_number: 'INV-1', vendor: { name: 'Vendor A' } },
  };
}

function makeBatch(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'batch-1',
    batch_number: overrides.batch_number ?? 'PB1',
    created_at: overrides.created_at ?? new Date('2026-08-05'),
    payment_count: overrides.payment_count ?? (overrides.payments?.length ?? 0),
    status: overrides.status ?? 'EXPORTED_TO_BANK',
    processed_at: overrides.processed_at ?? null,
    payments: overrides.payments ?? [],
  };
}

function rowsOf(buffer: Buffer, sheet: string): Record<string, any>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
}

beforeEach(() => {
  batchFindMany.mockReset();
  auditLogCreate.mockReset();
});

describe('exportPaymentReconciliation', () => {
  it('includes bank charges in payment rows, totals, and the Bank Charges sheet', async () => {
    batchFindMany.mockResolvedValue([
      makeBatch({
        batch_number: 'PB1001',
        status: 'EXPORTED_TO_BANK',
        payments: [
          makePayment({ id: 'p1', invoice_id: 'inv-1', amount: 100, bank_charge_amount: 25.5, bank_charge_note: 'wire fee', invoice: { invoice_number: 'INV-1', vendor: { name: 'Vendor A' } } }),
          makePayment({ id: 'p2', invoice_id: 'inv-2', amount: 50, invoice: { invoice_number: 'INV-2', vendor: { name: 'Vendor A' } } }),
        ],
      }),
      makeBatch({
        id: 'batch-2',
        batch_number: 'PB1002',
        status: 'PROCESSED',
        processed_at: new Date('2026-08-06'),
        payments: [
          makePayment({
            id: 'p3', invoice_id: 'inv-3', amount: 200, status: 'PAID', paid_at: new Date('2026-08-06'),
            reference: 'REF-B',
            bill_stub: { reference: 'REF-B' },
            invoice: { invoice_number: 'INV-3', vendor: { name: 'Vendor B' } },
          }),
        ],
      }),
    ]);

    const result = await exportPaymentReconciliation({}, 'user-1');

    expect(result.batchCount).toBe(2);
    expect(result.paymentCount).toBe(3);
    expect(result.bankChargeTotal).toBe(25.5);

    const payments = rowsOf(result.buffer, 'Payments');
    expect(payments).toHaveLength(4); // 3 payments + 1 TOTAL row

    const chargedRow = payments.find((r) => r['Invoice #'] === 'INV-1')!;
    expect(chargedRow['Bank Charge']).toBe(25.5);
    expect(chargedRow['Total (incl. Charge)']).toBe(125.5);

    const totalRow = payments.find((r) => (r['Invoice #'] as string).startsWith('TOTAL'))!;
    expect(totalRow['Amount']).toBe(350);
    expect(totalRow['Bank Charge']).toBe(25.5);
    expect(totalRow['Total (incl. Charge)']).toBe(375.5);

    const charges = rowsOf(result.buffer, 'Bank Charges');
    expect(charges).toHaveLength(1);
    expect(charges[0]['Batch #']).toBe('PB1001');
    expect(charges[0]['Bank Charge']).toBe(25.5);
    expect(charges[0]['Note']).toBe('wire fee');

    const batches = rowsOf(result.buffer, 'Batches');
    const batchA = batches.find((r) => r['Batch #'] === 'PB1001')!;
    const batchB = batches.find((r) => r['Batch #'] === 'PB1002')!;
    expect(batchA['Payments Total']).toBe(150);
    expect(batchA['Bank Charge']).toBe(25.5);
    expect(batchA['Grand Total (incl. Charge)']).toBe(175.5);
    expect(batchB['Grand Total (incl. Charge)']).toBe(200);
    expect(batchB['Status']).toBe('PROCESSED');

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { action: 'RECONCILIATION_EXPORT', performed_by: 'user-1', note: expect.stringContaining('bank charges 25.50') },
    });
  });

  it('emits per-currency TOTAL rows when payments span multiple currencies', async () => {
    batchFindMany.mockResolvedValue([
      makeBatch({
        payments: [
          makePayment({ id: 'p1', amount: 100, currency: 'USD' }),
          makePayment({ id: 'p2', amount: 80, currency: 'EUR' }),
        ],
      }),
    ]);

    const result = await exportPaymentReconciliation({});

    const payments = rowsOf(result.buffer, 'Payments');
    const totals = payments.filter((r) => (r['Invoice #'] as string).startsWith('TOTAL'));
    expect(totals).toHaveLength(2);
    const usd = totals.find((r) => r['Currency'] === 'USD')!;
    const eur = totals.find((r) => r['Currency'] === 'EUR')!;
    expect(usd['Amount']).toBe(100);
    expect(eur['Amount']).toBe(80);
    // paymentCount excludes the TOTAL rows
    expect(result.paymentCount).toBe(2);
  });

  it('applies batch created-at date range and status filters', async () => {
    batchFindMany.mockResolvedValue([]);

    await exportPaymentReconciliation({ status: 'PROCESSED', dateFrom: '2026-08-01', dateTo: '2026-08-31' });

    const options = batchFindMany.mock.calls[0][0];
    expect(options.where.status).toBe('PROCESSED');
    expect(options.where.created_at).toEqual({
      gte: new Date('2026-08-01'),
      lte: new Date('2026-08-31T23:59:59.999Z'),
    });
  });
});
