import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const { invoiceFindMany, exceptionFindMany, exceptionCreate, exceptionUpdateMany, auditLogCreate, notificationCreate } = vi.hoisted(() => ({
  invoiceFindMany: vi.fn(),
  exceptionFindMany: vi.fn(),
  exceptionCreate: vi.fn(),
  exceptionUpdateMany: vi.fn(),
  auditLogCreate: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findMany: invoiceFindMany },
    exception: { findMany: exceptionFindMany, create: exceptionCreate, updateMany: exceptionUpdateMany },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: notificationCreate },
}));

import { runOcrDateSanityCheck } from './ocrDateSanityService';

const makeInvoice = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'inv-1',
  invoice_number: 'INV-001',
  invoice_date: '2026-09-11T00:00:00.000Z',
  ...overrides,
});

describe('runOcrDateSanityCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceFindMany.mockResolvedValue([]);
    exceptionFindMany.mockResolvedValue([]);
  });

  it('flags an invoice whose invoice_date year is outside the sane range (year-2001 OCR corruption)', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice({ invoice_date: '2001-09-11T00:00:00.000Z' })]);
    exceptionFindMany.mockResolvedValue([]);

    const result = await runOcrDateSanityCheck('test');

    expect(exceptionCreate).toHaveBeenCalledTimes(1);
    expect(exceptionCreate.mock.calls[0][0].data.reason).toBe('OCR_DATE_OUT_OF_RANGE');
    expect(exceptionCreate.mock.calls[0][0].data.detail).toContain('2001-09-11');
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate.mock.calls[0][0].data.action).toBe('OCR_DATE_SANITY_FLAGGED');
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].target_role).toBe('ACCOUNTING_ASSOCIATE');
    expect(result.flagged).toBe(1);
    expect(result.flagged_invoices[0]).toMatchObject({ invoice_id: 'inv-1', invoice_date: '2001-09-11' });
  });

  it('does not flag invoices with sane dates', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice(), makeInvoice({ id: 'inv-2', invoice_number: 'INV-002', invoice_date: '2015-01-01T00:00:00.000Z' })]);

    const result = await runOcrDateSanityCheck('test');

    expect(exceptionCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
    expect(result.scanned).toBe(2);
  });

  it('excludes CANCELLED and REJECTED invoices from the scan query', async () => {
    invoiceFindMany.mockResolvedValue([]);
    await runOcrDateSanityCheck('test');
    expect(invoiceFindMany.mock.calls[0][0].where.status.notIn).toEqual(['CANCELLED', 'REJECTED']);
  });

  it('dedupes: does not create a second pending exception for an already-flagged invoice', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice({ invoice_date: '2001-09-11T00:00:00.000Z' })]);
    exceptionFindMany.mockResolvedValue([{ id: 'existing-exception' }]);

    const result = await runOcrDateSanityCheck('test');

    expect(exceptionCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
    expect(result.already_flagged).toBe(1);
    expect(result.scanned).toBe(1);
  });

  it('auto-resolves stale flags when a corrupted date is corrected back into range', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice()]);
    exceptionFindMany.mockResolvedValue([{ id: 'stale-1' }, { id: 'stale-2' }]);

    const result = await runOcrDateSanityCheck('test');

    expect(exceptionUpdateMany).toHaveBeenCalledTimes(1);
    expect(exceptionUpdateMany.mock.calls[0][0].where.id.in).toEqual(['stale-1', 'stale-2']);
    expect(exceptionUpdateMany.mock.calls[0][0].data.status).toBe('RESOLVED');
    expect(auditLogCreate.mock.calls[0][0].data.action).toBe('OCR_DATE_SANITY_RESOLVED');
    expect(exceptionCreate).not.toHaveBeenCalled();
    expect(result.auto_resolved).toBe(1);
  });

  it('ignores invoices with an unparseable invoice_date instead of flagging them', async () => {
    invoiceFindMany.mockResolvedValue([makeInvoice({ invoice_date: 'not-a-date' })]);

    const result = await runOcrDateSanityCheck('test');

    expect(exceptionCreate).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
  });
});
