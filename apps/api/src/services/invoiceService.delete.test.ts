import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const {
  invoiceFindUnique,
  paymentBatchFindFirst,
  invoiceDelete,
  auditLogCreate,
} = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  paymentBatchFindFirst: vi.fn(),
  invoiceDelete: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: {
      findUnique: invoiceFindUnique,
      delete: invoiceDelete,
    },
    paymentBatch: { findFirst: paymentBatchFindFirst },
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

import { deleteInvoice } from './invoiceService';
import { logAudit } from './auditLogService';

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'inv-1',
    invoice_number: overrides.invoice_number ?? 'INV-1',
    status: overrides.status ?? 'PENDING_COORDINATOR',
    pdf_path: overrides.pdf_path ?? null,
    raw_file_url: overrides.raw_file_url ?? null,
    payments: overrides.payments ?? [],
  };
}

describe('deleteInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deletion of an invoice in a locked status', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice({ status: 'POSTED_TO_QB' }));

    await expect(deleteInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Alice'))
      .rejects.toThrow('Cannot delete invoice in POSTED_TO_QB status');

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
});
