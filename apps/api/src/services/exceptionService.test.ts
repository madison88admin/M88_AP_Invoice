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
    update: vi.fn(),
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
    prismaMock.invoice.update.mockResolvedValue({ status: 'VALIDATION_PENDING' });
    validateInvoiceMock.mockResolvedValue({
      invoice_id: flaggedInvoice.id,
      passed: true,
      results: [],
      exceptions: [],
    });
  });

  it('resolves the final exception and makes the invoice ready for approval', async () => {
    prismaMock.exception.findUnique.mockResolvedValue(pendingException);
    prismaMock.exception.count.mockResolvedValueOnce(0);
    prismaMock.exception.findMany.mockResolvedValueOnce([]);
    const result = await resolveException(
      pendingException.id,
      'Corrected amount and saved invoice',
      'smoke-user'
    );

    expect(validateInvoiceMock).not.toHaveBeenCalled();
    expect(prismaMock.invoice.update).toHaveBeenCalledWith({
      where: { id: flaggedInvoice.id },
      data: { status: 'VALIDATION_PENDING' },
    });
    expect(result.revalidation).toMatchObject({
      triggered: false,
      passed: true,
      status: 'VALIDATION_PENDING',
      exception_count: 0,
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'EXCEPTIONS_ALL_RESOLVED' }),
      })
    );
  });

  it('keeps the invoice flagged while another exception remains', async () => {
    prismaMock.exception.findUnique.mockResolvedValue(pendingException);
    prismaMock.exception.count.mockResolvedValueOnce(1);

    const result = await resolveException(
      pendingException.id,
      'Corrected first issue',
      'smoke-user'
    );

    expect(validateInvoiceMock).not.toHaveBeenCalled();
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
    expect(result.revalidation).toBeUndefined();
  });

  it('waives the final exception and makes the invoice ready for approval', async () => {
    prismaMock.exception.findUnique.mockResolvedValue(pendingException);
    prismaMock.exception.update.mockResolvedValue({
      ...pendingException,
      status: 'WAIVED',
    });
    prismaMock.exception.count.mockResolvedValueOnce(0);
    prismaMock.exception.findMany.mockResolvedValueOnce([]);
    const result = await waiveException(
      pendingException.id,
      'Approved business exception',
      'smoke-user'
    );

    expect(validateInvoiceMock).not.toHaveBeenCalled();
    expect(result.revalidation).toMatchObject({
      triggered: false,
      passed: true,
      status: 'VALIDATION_PENDING',
      exception_count: 0,
    });
  });
});
