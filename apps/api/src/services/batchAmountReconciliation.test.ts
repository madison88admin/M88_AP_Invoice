import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ paymentBatch: { findUnique: vi.fn(), update: vi.fn() }, payment: { update: vi.fn() }, billStub: { update: vi.fn() }, paymentConfirmation: { count: vi.fn() }, auditLog: { create: vi.fn() } }));
vi.mock('../config/database', () => ({ default: { ...db, $transaction: (run: any) => run(db) } }));
import { batchAmountPreview, reconcileBatchAmounts } from './batchAmountReconciliation';

function legacyBatch() { return { id: 'b1', batch_number: 'PB202610239633', total_amount: 268, status: 'RETURNED_FOR_CORRECTION', payments: [{
  id: 'p1', amount: 258, bank_charge_amount: 10, paid_amount: 0, status: 'SCHEDULED',
  invoice: { invoice_number: 'A40430', subtotal: 228 }, bill_stub: { proof_file_url: '/old-evidence.pdf' },
}] }; }
beforeEach(() => { vi.clearAllMocks(); db.paymentConfirmation.count.mockResolvedValue(0); });
describe('legacy batch amount reconciliation', () => {
  it('previews 258 -> 228 principal plus 10 fee, preserves old proof in audit, and requires fresh stub/review', async () => {
    const batch = legacyBatch(); db.paymentBatch.findUnique.mockResolvedValue(batch);
    const preview = batchAmountPreview(batch);
    expect(preview).toMatchObject({ total: 238, needsCorrection: true });
    await reconcileBatchAmounts('b1', 'associate', 'Correct legacy gross-total principal', preview.previewToken);
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { amount: 228 } });
    expect(db.billStub.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ proof_file_url: null }) }));
    expect(db.auditLog.create.mock.calls[0][0].data.metadata.before.payments[0].stub.proof_file_url).toBe('/old-evidence.pdf');
    expect(db.paymentBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ total_amount: 238, status: 'DRAFT', reviewed_by: null }) }));
  });
  it('does not rewrite a pending-review batch or a stale preview', async () => {
    const batch = legacyBatch(); db.paymentBatch.findUnique.mockResolvedValue({ ...batch, status: 'PENDING_SUPERVISOR_REVIEW' });
    await expect(reconcileBatchAmounts('b1', 'a1', 'Correction', 'token')).rejects.toThrow('Return this batch');
    db.paymentBatch.findUnique.mockResolvedValue(batch);
    await expect(reconcileBatchAmounts('b1', 'a1', 'Correction', 'stale')).rejects.toThrow('changed since preview');
    expect(db.payment.update).not.toHaveBeenCalled();
  });
  it('uses a dated QB open balance and refuses confirmed payments', async () => {
    const batch: any = legacyBatch(); batch.payments[0].invoice.qb_open_balance = 190; batch.payments[0].invoice.qb_balance_as_of = new Date();
    const preview = batchAmountPreview(batch); expect(preview.total).toBe(200);
    db.paymentBatch.findUnique.mockResolvedValue(batch); db.paymentConfirmation.count.mockResolvedValue(1);
    await expect(reconcileBatchAmounts('b1', 'a1', 'Correction', preview.previewToken)).rejects.toThrow('confirmation history');
    expect(db.payment.update).not.toHaveBeenCalled();
  });
});
