import { describe, it, expect, vi, beforeEach } from 'vitest';

const validateInvoiceMock = vi.hoisted(() => vi.fn());
const logAuditMock = vi.hoisted(() => vi.fn());
const createJobMock = vi.hoisted(() => vi.fn());
const completeJobMock = vi.hoisted(() => vi.fn());
const failJobMock = vi.hoisted(() => vi.fn());
const getJobMock = vi.hoisted(() => vi.fn());
const cleanupOldJobsMock = vi.hoisted(() => vi.fn());

vi.mock('../services/validationService', () => ({ validateInvoice: validateInvoiceMock, checkNextGenChanges: vi.fn() }));
vi.mock('../services/auditLogService', () => ({ logAudit: logAuditMock }));
vi.mock('../services/jobStore', () => ({
  createJob: createJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  getJob: getJobMock,
  cleanupOldJobs: cleanupOldJobsMock,
}));

import { validateInvoiceController } from './validation';

function makeReqRes() {
  const req: any = { params: { id: 'inv-1' }, user: { id: 'user-1' } };
  const res: any = { json: vi.fn() };
  const next = vi.fn();
  return { req, res, next };
}

describe('validateInvoiceController — audit note includes failing rule details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the amount-mismatch detail (what changed) in the audit note', async () => {
    validateInvoiceMock.mockResolvedValue({
      passed: false,
      results: [
        { passed: true, message: 'Bill-to valid' },
        { passed: false, message: 'Invoice does not match MPO MPO016018 in NextGen', detail: 'Amount: invoice $184.85 vs PO $200.00 (7.6% variance); Vendor: invoice "LONGQING" vs PO "Dragon Times"' },
        { passed: true, message: 'Bank details complete' },
      ],
    });
    const { req, res, next } = makeReqRes();

    await validateInvoiceController(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const auditCall = logAuditMock.mock.calls[0][0];
    expect(auditCall.action).toBe('INVOICE_VALIDATED');
    expect(auditCall.note).toContain('Passed: false');
    expect(auditCall.note).toContain('Rules checked: 3');
    expect(auditCall.note).toContain('Amount: invoice $184.85 vs PO $200.00');
    expect(auditCall.note).toContain('Vendor: invoice "LONGQING" vs PO "Dragon Times"');
  });

  it('keeps a clean note when everything passes', async () => {
    validateInvoiceMock.mockResolvedValue({
      passed: true,
      results: [{ passed: true, message: 'All good' }],
    });
    const { req, res, next } = makeReqRes();

    await validateInvoiceController(req, res, next);

    const auditCall = logAuditMock.mock.calls[0][0];
    expect(auditCall.note).toContain('Passed: true');
    expect(auditCall.note).not.toContain('Failing:');
  });
});
