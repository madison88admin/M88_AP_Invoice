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

import { resolveException, waiveException, autoResolveLowRiskExceptions } from './exceptionService';

const flaggedInvoice = {
  id: 'invoice-smoke-1',
  status: 'EXCEPTION_FLAGGED',
};

const pendingException = {
  id: 'exception-smoke-1',
  invoice_id: flaggedInvoice.id,
  reason: 'AMOUNT_MISMATCH',
  status: 'PENDING',
  detail: 'Amount: invoice $184.85 vs PO $200.00 (7.6% variance)',
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
    // The resolve audit note must include the flagged detail (what changed)
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EXCEPTION_RESOLVED',
          note: expect.stringContaining('flagged: Amount: invoice $184.85 vs PO $200.00'),
        }),
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
    // Waive audit note also carries the flagged detail
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EXCEPTION_WAIVED',
          note: expect.stringContaining('flagged: Amount: invoice $184.85 vs PO $200.00'),
        }),
      })
    );
  });

  it('audits auto-resolved exceptions with the flagged detail', async () => {
    prismaMock.exception.findMany.mockResolvedValue([
      {
        id: 'exc-late',
        reason: 'LATE_SUBMISSION',
        status: 'PENDING',
        detail: 'Invoice submitted 9 days after invoice date',
      },
    ]);
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...flaggedInvoice,
      total_amount: '150.00',
      invoice_date: new Date('2026-08-01'),
      vendor: { bank_verified_at: null },
      exceptions: [
        {
          id: 'exc-late',
          reason: 'LATE_SUBMISSION',
          status: 'PENDING',
          detail: 'Invoice submitted 9 days after invoice date',
        },
      ],
    });
    prismaMock.exception.update.mockResolvedValue({});
    prismaMock.exception.count.mockResolvedValueOnce(0);
    prismaMock.invoice.update.mockResolvedValue({});

    const result = await autoResolveLowRiskExceptions(flaggedInvoice.id);

    expect(result.resolved).toBe(1);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EXCEPTION_AUTO_RESOLVED',
          note: expect.stringContaining('flagged: Invoice submitted 9 days after invoice date'),
        }),
      })
    );
  });
});
