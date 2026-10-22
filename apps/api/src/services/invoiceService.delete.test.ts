import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const {
  invoiceFindUnique,
  paymentBatchFindFirst,
  invoiceDelete,
  invoiceUpdate,
  paymentUpdateMany,
  paymentAggregate,
  paymentBatchUpdate,
  workflowActionCreate,
  transaction,
  auditLogCreate,
  retentionDispositionDeleteMany,
} = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  paymentBatchFindFirst: vi.fn(),
  invoiceDelete: vi.fn(),
  invoiceUpdate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  paymentAggregate: vi.fn(),
  paymentBatchUpdate: vi.fn(),
  workflowActionCreate: vi.fn(),
  transaction: vi.fn(),
  auditLogCreate: vi.fn(),
  retentionDispositionDeleteMany: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: {
      findUnique: invoiceFindUnique,
      delete: invoiceDelete,
      update: invoiceUpdate,
    },
    payment: { updateMany: paymentUpdateMany, aggregate: paymentAggregate },
    paymentBatch: { findFirst: paymentBatchFindFirst, update: paymentBatchUpdate },
    invoiceWorkflowAction: { create: workflowActionCreate },
    retentionDisposition: { deleteMany: retentionDispositionDeleteMany },
    $transaction: transaction,
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// invoiceService pulls in many transitive deps; mock the heavy ones it imports.
vi.mock('./auditLogService', () => ({ logAudit: vi.fn(), resolveAuditActorNames: vi.fn() }));
vi.mock('./vendorMatchingService', () => ({ matchVendor: vi.fn() }));
vi.mock('./fieldDecisionEngine', () => ({ fieldDecisionEngine: { decide: vi.fn() } }));
vi.mock('./inAppNotificationService', () => ({ inAppNotificationService: { create: vi.fn(), notifyStageTransition: vi.fn() } }));
vi.mock('../utils/mpoReference', () => ({ parseMPOReference: vi.fn() }));

import { cancelInvoice, deleteInvoice, deleteInvoicesBulk, requestInvoiceCancellation } from './invoiceService';
import { logAudit } from './auditLogService';

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'inv-1',
    invoice_number: overrides.invoice_number ?? 'INV-1',
    revision: overrides.revision ?? 1,
    status: overrides.status ?? 'RECEIVED',
    pdf_path: overrides.pdf_path ?? null,
    raw_file_url: overrides.raw_file_url ?? null,
    retention_until: overrides.retention_until ?? null,
    legal_hold: overrides.legal_hold ?? false,
    is_duplicate: overrides.is_duplicate ?? false,
    duplicate_review_status: overrides.duplicate_review_status ?? 'NOT_REVIEWED',
    payments: overrides.payments ?? [],
  };
}

describe('deleteInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retentionDispositionDeleteMany.mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (callback: any) => callback({
      invoice: { update: invoiceUpdate },
      payment: { updateMany: paymentUpdateMany, aggregate: paymentAggregate },
      paymentBatch: { update: paymentBatchUpdate },
    }));
  });

  it('rejects deletion of an invoice in a locked status', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ status: 'POSTED_TO_QB' }));

    await expect(deleteInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Alice'))
      .rejects.toThrow('Cannot delete invoice in POSTED_TO_QB status. Submit a cancellation request instead.');

    expect(invoiceDelete).not.toHaveBeenCalled();
  });

  it('rejects deletion when the payment is inside a live (non-CANCELLED) batch', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({
      payments: [{ id: 'pay-1', batch_id: 'batch-1' }],
    }));
    paymentBatchFindFirst.mockResolvedValue({ id: 'batch-1', batch_number: 'PB202608001' });

    await expect(deleteInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Alice'))
      .rejects.toThrow('Cannot delete invoice: it is inside batch PB202608001');

    expect(invoiceDelete).not.toHaveBeenCalled();
  });

  it('allows deletion when the only batch is CANCELLED', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({
      payments: [{ id: 'pay-1', batch_id: 'batch-1' }],
    }));
    paymentBatchFindFirst.mockResolvedValue(null);
    invoiceDelete.mockResolvedValue({ id: 'inv-1' });

    const result = await deleteInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Alice');

    expect(result.deleted).toBe(true);
    expect(retentionDispositionDeleteMany).toHaveBeenCalledWith({ where: { invoice_id: 'inv-1' } });
    expect(invoiceDelete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
  });

  it('deletes a clean early-stage invoice and audits it before deletion', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ payments: [] }));
    invoiceDelete.mockResolvedValue({ id: 'inv-1' });

    const result = await deleteInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Alice');

    expect(result).toEqual({ id: 'inv-1', deleted: true, invoice_number: 'INV-1' });
    // Audit entry carries no invoice_id (it would be cascade-deleted with the
    // invoice) but embeds the number + id so the deletion stays traceable.
    const entry = (logAudit as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.action).toBe('INVOICE_DELETED');
    expect(entry.invoice_id).toBeUndefined();
    expect(entry.note).toContain('INV-1');
    expect(entry.note).toContain('inv-1');
  });

  it('allows cleanup of a retention-dated intake draft', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({
      status: 'EXCEPTION_FLAGGED',
      retention_until: new Date('2033-10-14'),
      legal_hold: false,
      payments: [],
    }));
    invoiceDelete.mockResolvedValue({ id: 'inv-1' });

    const result = await deleteInvoice('inv-1', 'admin-1', 'IT_ADMIN', 'IT Admin');

    expect(result.deleted).toBe(true);
    expect(retentionDispositionDeleteMany).toHaveBeenCalledWith({ where: { invoice_id: 'inv-1' } });
    expect(invoiceDelete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
  });

  it('closes duplicates for audit and reports protected records independently', async () => {
    invoiceFindUnique
      .mockResolvedValueOnce(makeInvoice({ id: 'duplicate-1', invoice_number: 'INV-DUP', is_duplicate: true, status: 'APPROVED' }))
      .mockResolvedValueOnce(makeInvoice({ id: 'protected-1', invoice_number: 'INV-LOCKED', status: 'APPROVED', retention_until: new Date('2033-10-14') }));
    invoiceUpdate.mockResolvedValue({ id: 'duplicate-1', status: 'CANCELLED' });

    const result = await deleteInvoicesBulk(
      ['duplicate-1', 'duplicate-1', 'protected-1'],
      'coord-1',
      'PURCHASING_COORDINATOR',
      'Alice',
    );

    expect(result).toMatchObject({ requested: 2, deleted: 0, closed: 1, failed: 1 });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'duplicate-1', deleted: false, closed: true, invoice_number: 'INV-DUP' }),
      expect.objectContaining({ id: 'protected-1', deleted: false, error: expect.stringContaining('retention-protected') }),
    ]));
    expect(invoiceDelete).not.toHaveBeenCalled();
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'duplicate-1' } }));
  });

  it('still blocks retention-protected invoices that entered workflow', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({
      status: 'APPROVED',
      retention_until: new Date('2033-10-14'),
      legal_hold: false,
      payments: [],
    }));

    await expect(deleteInvoice('inv-1', 'admin-1', 'IT_ADMIN', 'IT Admin'))
      .rejects.toThrow('retention-protected');
    expect(invoiceDelete).not.toHaveBeenCalled();
  });

  it('rejects deletion once an invoice has entered the approval workflow', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ status: 'PENDING_COORDINATOR' }));

    await expect(deleteInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Alice'))
      .rejects.toThrow('Submit a cancellation request instead');
    expect(invoiceDelete).not.toHaveBeenCalled();
  });

  it('records a cancellation request without changing invoice status', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ status: 'POSTED_TO_QB', revision: 3 }));
    invoiceUpdate.mockResolvedValue({ id: 'inv-1', status: 'POSTED_TO_QB' });

    await requestInvoiceCancellation('inv-1', 'coord-1', 'PURCHASING_COORDINATOR', 'Alice', 'Supplier cancelled the order');

    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cancellation_requested_by: 'coord-1' }),
    }));
    expect(workflowActionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CANCELLATION_REQUESTED', from_stage: 'POSTED_TO_QB', to_stage: 'POSTED_TO_QB' }),
    }));
  });

  it('allows only a finalizer to cancel a requested invoice and preserves the record', async () => {
    invoiceFindUnique.mockResolvedValue({
      ...makeInvoice({ status: 'POSTED_TO_QB', revision: 3 }),
      cancellation_requested_at: new Date('2026-09-11T00:00:00.000Z'),
      cancellation_requested_by: 'coord-1',
    });
    invoiceUpdate.mockResolvedValue({ id: 'inv-1', status: 'CANCELLED' });
    paymentUpdateMany.mockResolvedValue({ count: 0 });

    await cancelInvoice('inv-1', 'sup-1', 'ACCOUNTING_SUPERVISOR', 'Supervisor', 'Supplier cancellation verified');

    expect(invoiceDelete).not.toHaveBeenCalled();
    expect(paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', batch_id: null }),
    }));
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', cancelled_by: 'sup-1' }),
    }));
  });
});
