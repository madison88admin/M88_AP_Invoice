import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  exception: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  invoice: {
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

const validateInvoiceMock = vi.hoisted(() => vi.fn());

vi.mock('../config/database', () => ({ default: prismaMock }));
vi.mock('./validationService', () => ({ validateInvoice: validateInvoiceMock }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { resolveException, waiveException } from './exceptionService';

const flaggedInvoice = {
  id: 'invoice-smoke-1',
  status: 'EXCEPTION_FLAGGED',
};

const pendingException = {
  id: 'exception-smoke-1',
  invoice_id: flaggedInvoice.id,
  reason: 'AMOUNT_MISMATCH',
  status: 'PENDING',
  invoice: flaggedInvoice,
};

describe('exception workflow smoke test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.exception.update.mockResolvedValue({
      ...pendingException,
      status: 'RESOLVED',
    });
    prismaMock.auditLog.create.mockResolvedValue({});
    validateInvoiceMock.mockResolvedValue({
      invoice_id: flaggedInvoice.id,
      passed: true,
      results: [],
      exceptions: [],
    });
  });

  it('resolves the final exception, revalidates once, and advances to approval', async () => {
    prismaMock.exception.findUnique.mockResolvedValue(pendingException);
    prismaMock.exception.count.mockResolvedValueOnce(0);
    prismaMock.exception.findMany.mockResolvedValueOnce([]);
    prismaMock.invoice.findUnique.mockResolvedValue({
      status: 'PENDING_COORDINATOR',
    });

    const result = await resolveException(
      pendingException.id,
      'Corrected amount and saved invoice',
      'smoke-user'
    );

    expect(validateInvoiceMock).toHaveBeenCalledTimes(1);
    expect(validateInvoiceMock).toHaveBeenCalledWith(flaggedInvoice.id, { skipAutoAdvance: true });
    expect(result.revalidation).toMatchObject({
      triggered: true,
      passed: true,
      status: 'PENDING_COORDINATOR',
      exception_count: 0,
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'AUTO_REVALIDATION_COMPLETED' }),
      })
    );
  });

  it('returns the complete new exception outcome instead of reporting a match', async () => {
    prismaMock.exception.findUnique.mockResolvedValue(pendingException);
    prismaMock.exception.count.mockResolvedValueOnce(0);
    prismaMock.exception.findMany.mockResolvedValueOnce([
      { reason: 'AMOUNT_MISMATCH', detail: 'Amount differs' },
      { reason: 'MISSING_BANK_INFO', detail: 'Bank data missing' },
    ]);
    prismaMock.invoice.findUnique.mockResolvedValue({
      status: 'EXCEPTION_FLAGGED',
    });

    const result = await resolveException(
      pendingException.id,
      'Corrected first issue',
      'smoke-user'
    );

    expect(validateInvoiceMock).toHaveBeenCalledTimes(1);
    expect(result.revalidation).toMatchObject({
      triggered: true,
      passed: false,
      status: 'EXCEPTION_FLAGGED',
      exception_count: 2,
    });
    expect(result.revalidation?.message).toContain('2 consolidated exception');
  });

  it('waives the final exception and automatically revalidates into approval', async () => {
    prismaMock.exception.findUnique.mockResolvedValue(pendingException);
    prismaMock.exception.update.mockResolvedValue({
      ...pendingException,
      status: 'WAIVED',
    });
    prismaMock.exception.count.mockResolvedValueOnce(0);
    prismaMock.exception.findMany.mockResolvedValueOnce([]);
    prismaMock.invoice.findUnique.mockResolvedValue({
      status: 'PENDING_MANAGER',
    });

    const result = await waiveException(
      pendingException.id,
      'Approved business exception',
      'smoke-user'
    );

    expect(validateInvoiceMock).toHaveBeenCalledTimes(1);
    expect(result.revalidation).toMatchObject({
      triggered: true,
      passed: true,
      status: 'PENDING_MANAGER',
      exception_count: 0,
    });
  });
});
