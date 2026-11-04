import crypto from 'crypto';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

const cents = (value: unknown) => Math.round(Number(value) * 100);
export function expectedPaymentAmount(payment: any): number | null {
  const invoice = payment.invoice;
  const qbBalance = Boolean(invoice?.qb_balance_as_of && invoice.qb_open_balance != null);
  const value = qbBalance ? invoice.qb_open_balance : invoice?.subtotal == null ? null : Number(invoice.subtotal) - Number(payment.bill_stub?.discount || 0);
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  return cents(value) / 100;
}

export function batchAmountPreview(batch: any) {
  const payments = (batch.payments || []).map((payment: any) => ({
    paymentId: payment.id, invoiceNumber: payment.invoice?.invoice_number,
    current: Number(payment.amount), expected: expectedPaymentAmount(payment),
    bankCharge: Number(payment.bank_charge_amount || 0),
    invoiceSubtotal: payment.invoice?.subtotal == null ? null : Number(payment.invoice.subtotal),
    source: payment.invoice?.qb_balance_as_of && payment.invoice?.qb_open_balance != null ? 'QuickBooks open balance' : 'Invoice subtotal',
    stub: payment.bill_stub || null, paid: Number(payment.paid_amount || 0), status: payment.status,
  }));
  const snapshot = JSON.stringify({ id: batch.id, status: batch.status, total: String(batch.total_amount), updated: batch.updated_at, payments });
  return {
    batchId: batch.id, batchNumber: batch.batch_number, status: batch.status,
    previewToken: crypto.createHash('sha256').update(snapshot).digest('hex'),
    payments,
    total: payments.every((payment: any) => payment.expected != null)
      ? payments.reduce((sum: number, payment: any) => sum + cents(payment.expected) + cents(payment.bankCharge), 0) / 100 : null,
    needsCorrection: payments.some((payment: any) => payment.expected != null && cents(payment.current) !== cents(payment.expected)),
  };
}

const include = { payments: { include: { invoice: true, bill_stub: true } } };
export async function previewBatchAmountReconciliation(batchId: string) {
  const batch = await prisma.paymentBatch.findUnique({ where: { id: batchId }, include });
  if (!batch) throw new AppError('Payment batch not found', 404);
  return batchAmountPreview(batch);
}

export async function reconcileBatchAmounts(batchId: string, userId: string, reason: string, previewToken: string) {
  if (!reason?.trim()) throw new AppError('A reconciliation reason is required', 400);
  return prisma.$transaction(async (tx) => {
    const batch = await tx.paymentBatch.findUnique({ where: { id: batchId }, include });
    if (!batch) throw new AppError('Payment batch not found', 404);
    if (!['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(batch.status) || batch.execution_reference || batch.exported_at) {
      throw new AppError('Return this batch for correction before reconciling amounts. Executed/exported batches cannot be rewritten.', 409);
    }
    const preview = batchAmountPreview(batch);
    if (!previewToken || preview.previewToken !== previewToken) throw new AppError('Batch changed since preview. Refresh and review the amounts again.', 409);
    if (!preview.needsCorrection) throw new AppError('No amount correction is needed', 400);
    if (!batch.payments.length || preview.total == null || batch.payments.some((payment) => Number(payment.paid_amount) > 0 || payment.status !== 'SCHEDULED')) {
      throw new AppError('Only unpaid scheduled payments with a verified amount source can be reconciled.', 409);
    }
    const confirmed = await tx.paymentConfirmation.count({ where: { batch_id: batchId } });
    if (confirmed) throw new AppError('This batch has confirmation history and cannot be rewritten.', 409);
    if (batch.payments.some((payment) => payment.invoice.qb_bank_charge_included && Number(payment.bank_charge_amount || 0) > 0)) {
      throw new AppError('QuickBooks already includes a bank charge. Remove the duplicate batch charge before reconciling.', 409);
    }
    for (const line of preview.payments) {
      if (cents(line.current) === cents(line.expected)) continue;
      await tx.payment.update({ where: { id: line.paymentId }, data: { amount: line.expected! } });
      if (line.stub) await tx.billStub.update({ where: { payment_id: line.paymentId }, data: {
        original_amount: line.invoiceSubtotal ?? line.expected, balance: line.expected, paid_amount: line.expected,
        proof_file_url: null, proof_file_name: null,
      } });
    }
    await tx.auditLog.create({ data: {
      action: 'PAYMENT_BATCH_AMOUNTS_RECONCILED', performed_by: userId,
      note: `Batch ${batch.batch_number}: ${reason.trim()}. Old stub evidence retained in audit; new files and Supervisor review required.`,
      metadata: JSON.parse(JSON.stringify({ before: preview, afterTotal: preview.total })),
    } });
    return tx.paymentBatch.update({ where: { id: batchId }, data: {
      total_amount: preview.total!, status: 'DRAFT', reviewed_by: null, reviewed_at: null, review_note: null,
      submitted_by: null, submitted_at: null,
    } });
  }, { isolationLevel: 'Serializable' });
}
