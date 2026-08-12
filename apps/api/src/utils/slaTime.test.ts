import { describe, expect, it } from 'vitest';
import { getInvoiceSLAStart, getStageSLAStart } from './slaTime';

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

  it('falls back to the legacy fallback when the invoice has no dates', () => {
    expect(getInvoiceSLAStart(null, new Date('2026-08-10T08:00:00Z'))).toEqual(new Date('2026-08-10T08:00:00Z'));
  });
});

describe('getStageSLAStart', () => {
  const invoice = {
    invoice_received_date: new Date('2026-08-01T08:00:00Z'),
    created_at: new Date('2026-08-01T08:00:00Z'),
  };

  it('anchors the Purchasing Coordinator stage to invoice arrival (received date)', () => {
    expect(getStageSLAStart(invoice, 'PENDING_COORDINATOR', new Date('2026-08-10T08:00:00Z')))
      .toEqual(new Date('2026-08-01T08:00:00Z'));
  });

  it('falls back to created_at when the coordinator invoice has no received date', () => {
    const noReceived = { created_at: new Date('2026-08-02T09:00:00Z') };
    expect(getStageSLAStart(noReceived, 'PENDING_COORDINATOR', new Date('2026-08-10T08:00:00Z')))
      .toEqual(new Date('2026-08-02T09:00:00Z'));
  });

  it('falls back to the stage entered_at when the coordinator invoice has no dates', () => {
    const stageStart = new Date('2026-08-10T08:00:00Z');
    expect(getStageSLAStart(null, 'PENDING_COORDINATOR', stageStart)).toEqual(stageStart);
  });

  it('keeps non-coordinator stages at their own stage start', () => {
    const stageStart = new Date('2026-08-10T08:00:00Z');
    expect(getStageSLAStart(invoice, 'PENDING_MANAGER', stageStart)).toEqual(stageStart);
    expect(getStageSLAStart(invoice, 'PENDING_ACCOUNTING', stageStart)).toEqual(stageStart);
    expect(getStageSLAStart(invoice, undefined, stageStart)).toEqual(stageStart);
  });
});
