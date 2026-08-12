import { describe, it, expect } from 'vitest';
import { getInvoiceSLAStart, getStageSLAStart } from './slaTime';

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

  it('getInvoiceSLAStart prefers received date, then created_at, then fallback', () => {
    expect(getInvoiceSLAStart(invoice, null)).toEqual(new Date('2026-08-01T08:00:00Z'));
    expect(getInvoiceSLAStart({ created_at: new Date('2026-08-02T09:00:00Z') }, new Date('2026-08-10T08:00:00Z')))
      .toEqual(new Date('2026-08-02T09:00:00Z'));
    expect(getInvoiceSLAStart(null, new Date('2026-08-10T08:00:00Z'))).toEqual(new Date('2026-08-10T08:00:00Z'));
  });
});
