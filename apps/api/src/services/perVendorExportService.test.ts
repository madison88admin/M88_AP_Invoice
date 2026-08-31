import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const { paymentBatchFindUnique, auditLogCreate } = vi.hoisted(() => ({
  paymentBatchFindUnique: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    paymentBatch: { findUnique: paymentBatchFindUnique },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { exportBatchPerVendor } from './perVendorExportService';

beforeEach(() => {
  paymentBatchFindUnique.mockReset();
  auditLogCreate.mockReset();
  auditLogCreate.mockResolvedValue({});
});

describe('payment batch bank export', () => {
  it('exports the immutable ABA snapshot for a domestic vendor without SWIFT', async () => {
    paymentBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      batch_number: 'PB202608310001',
      total_amount: 125,
      payment_count: 1,
      currency: 'USD',
      status: 'REVIEWED',
      created_at: new Date('2026-08-31T00:00:00Z'),
      payments: [{
        id: 'pay-1',
        amount: 125,
        bank_charge_amount: null,
        currency: 'USD',
        payment_date: new Date('2026-09-05T00:00:00Z'),
        beneficiary_name_snapshot: 'US VENDOR LLC',
        bank_name_snapshot: 'JPMORGAN CHASE BANK NA',
        bank_address_snapshot: 'New York, US',
        swift_code_snapshot: null,
        aba_routing_number_snapshot: '021000021',
        account_number_snapshot: '123456789',
        reference: null,
        invoice: {
          invoice_number: 'INV-US-1',
          mpo_number: 'MPO016019',
          customer_po_number: 'PO123',
          brand: 'TEST',
          bill_to_entity: 'MADISON_88_LTD',
          vendor_id: 'vendor-us',
          vendor: { id: 'vendor-us', name: 'US VENDOR LLC' },
        },
      }],
    });

    const result = await exportBatchPerVendor('batch-1', 'accounting-1');
    const workbook = XLSX.read(result.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Payments);

    expect(rows[0]['SWIFT Code']).toBe('');
    expect(rows[0]['ABA / Routing Number']).toBe('021000021');
    expect(rows[0]['Account Number']).toBe('123456789');
  });
});
