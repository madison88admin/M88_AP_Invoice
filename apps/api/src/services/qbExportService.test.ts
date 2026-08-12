import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invoiceFindMany, auditLogCreate } = vi.hoisted(() => ({
  invoiceFindMany: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findMany: invoiceFindMany },
    auditLog: { create: auditLogCreate },
  },
}));

import * as XLSX from 'xlsx';
import { exportQBBills } from './qbExportService';
import { deriveGLAccount } from './postingService';

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'inv-1',
    invoice_number: overrides.invoice_number ?? 'INV-100',
    invoice_type: overrides.invoice_type ?? 'INVOICE',
    invoice_date: overrides.invoice_date ?? new Date('2026-08-01'),
    due_date: overrides.due_date ?? new Date('2026-08-15'),
    total_amount: overrides.total_amount ?? 100,
    currency: overrides.currency ?? 'USD',
    mpo_number: overrides.mpo_number ?? 'MPO-1',
    customer_po_number: overrides.customer_po_number ?? 'PO-1',
    brand: overrides.brand ?? 'SAMPLE',
    brand_code: overrides.brand_code ?? null,
    season: overrides.season ?? null,
    order_type: overrides.order_type ?? null,
    qb_memo: overrides.qb_memo ?? null,
    qb_posted_at: overrides.qb_posted_at ?? new Date('2026-08-02'),
    status: overrides.status ?? 'POSTED_TO_QB',
    bill_to_entity: overrides.bill_to_entity ?? 'MADISON_88_LTD',
    vendor: overrides.vendor ?? {
      name: 'Vendor A',
      beneficiary_name: 'Benef A',
      account_number: '12345',
      supplier_location: 'HK',
    },
    invoice_lines: overrides.invoice_lines ?? [],
  };
}

function rowsOf(buffer: Buffer, sheet: string): Record<string, any>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
}

beforeEach(() => {
  invoiceFindMany.mockReset();
  auditLogCreate.mockReset();
});

describe('exportQBBills', () => {
  it('queries posted invoices by default and derives memo, GL account and class', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice({ qb_memo: 'Trims Q2' })]);

    const result = await exportQBBills({}, 'user-1');

    const options = invoiceFindMany.mock.calls[0][0];
    expect(options.where.status).toEqual({ in: ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'] });

    expect(result.billCount).toBe(1);
    expect(result.filename).toMatch(/^qb-bills-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const rows = rowsOf(result.buffer, 'QB Bills');
    expect(rows).toHaveLength(1);
    expect(rows[0]['Invoice #']).toBe('INV-100');
    expect(rows[0]['Vendor']).toBe('Vendor A');
    expect(rows[0]['Memo / Description']).toBe('Trims Q2');
    expect(rows[0]['GL Account']).toBe(deriveGLAccount('INVOICE'));
    expect(rows[0]['GL Class']).toBe('HK');
    expect(rows[0]['Amount']).toBe(100);
    expect(rows[0]['Due Date']).toBe('2026-08-15');

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { action: 'QB_BILLS_EXPORT', performed_by: 'user-1', note: expect.stringContaining('1 bill') },
    });
  });

  it('falls back to the deterministic memo when qb_memo is missing', async () => {
    invoiceFindMany.mockResolvedValue([
      makeInvoice({ qb_memo: null, brand_code: 'SM', season: 'FALL', mpo_number: 'MPO-9' }),
    ]);

    const result = await exportQBBills({});

    const rows = rowsOf(result.buffer, 'QB Bills');
    const today = new Date().toISOString().split('T')[0];
    expect(rows[0]['Memo / Description']).toBe(`SM_FALL_MPO-9_${today}`);
  });

  it('groups invoice lines by MPO into the Bill Lines sheet', async () => {
    invoiceFindMany.mockResolvedValue([
      makeInvoice({
        invoice_number: 'INV-200',
        total_amount: 300,
        invoice_lines: [
          { mpo_base_number: 'MPO-1', line_amount: 100 },
          { mpo_base_number: 'MPO-1', line_amount: 50 },
          { mpo_base_number: 'MPO-2', line_amount: 150 },
        ],
      }),
    ]);

    const result = await exportQBBills({});

    const lines = rowsOf(result.buffer, 'Bill Lines');
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l['MPO Ref'] === 'MPO-1')?.['Amount']).toBe(150);
    expect(lines.find((l) => l['MPO Ref'] === 'MPO-2')?.['Amount']).toBe(150);
    expect(lines[0]['Description']).toContain('MPO-1');
  });

  it('emits a single line when the invoice has no line items', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice({ invoice_number: 'INV-300', total_amount: 75 })]);

    const result = await exportQBBills({});

    const lines = rowsOf(result.buffer, 'Bill Lines');
    expect(lines).toHaveLength(1);
    expect(lines[0]['Invoice #']).toBe('INV-300');
    expect(lines[0]['Amount']).toBe(75);
  });

  it('applies an explicit status filter and invoice-date range', async () => {
    invoiceFindMany.mockResolvedValue([]);

    await exportQBBills({ status: 'PAYMENT_SCHEDULED', dateFrom: '2026-08-01', dateTo: '2026-08-31' });

    const options = invoiceFindMany.mock.calls[0][0];
    expect(options.where.status).toEqual({ in: ['PAYMENT_SCHEDULED'] });
    expect(options.where.invoice_date).toEqual({
      gte: new Date('2026-08-01'),
      lte: new Date('2026-08-31T23:59:59.999Z'),
    });
  });
});
