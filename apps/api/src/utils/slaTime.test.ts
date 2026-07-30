import { describe, expect, it } from 'vitest';
import { getInvoiceSLAStart } from './slaTime';

describe('getInvoiceSLAStart', () => {
  it('uses the actual invoice received date before any system timestamp', () => {
    expect(getInvoiceSLAStart({
      invoice_received_date: '2026-07-01T00:00:00.000Z',
      created_at: '2026-07-10T00:00:00.000Z',
    }).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('falls back to created_at for legacy invoices without a received date', () => {
    expect(getInvoiceSLAStart({
      invoice_received_date: null,
      created_at: '2026-07-10T00:00:00.000Z',
    }, '2026-07-12T00:00:00.000Z').toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });
});
