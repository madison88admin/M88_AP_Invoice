import prisma from '../config/database';
import { InvoiceStatus, ExceptionReason, ExceptionStatus } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { validateInvoice } from './validationService';
import { createApprovalRequest } from './approvalService';
import { logger } from '../utils/logger';

/**
 * Reprocess an invoice: cancel its current payment, reset status, re-validate,
 * and regenerate approval request.
 *
 * Allowed from: PAYMENT_SCHEDULED, POSTED_TO_QB, PAID (if payment needs to be voided)
 * Not allowed from: PAYMENT_CONFIRMATION_SENT (final state — too late to reprocess)
 */
export async function reprocessInvoice(
  invoiceId: string,
  userId: string,
  reason: string
): Promise<{ invoice_id: string; old_status: string; new_status: string; message: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: true,
      signatures: true,
      exceptions: true,
      vendor: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Check allowed statuses for reprocessing
  const allowedStatuses = [
    InvoiceStatus.POSTED_TO_QB,
    InvoiceStatus.PAYMENT_SCHEDULED,
    InvoiceStatus.PAID,
    InvoiceStatus.ON_HOLD,
    InvoiceStatus.PENDING_ACCOUNTING,
  ];

  if (!allowedStatuses.includes(invoice.status as InvoiceStatus)) {
    throw new AppError(
      `Invoice in status ${invoice.status} cannot be reprocessed. Allowed statuses: ${allowedStatuses.join(', ')}`,
      400
    );
  }

  const oldStatus = invoice.status;

  // 1. Cancel/void any linked payments
  if (invoice.payments.length > 0) {
    for (const payment of invoice.payments as any[]) {
      if (payment.status === 'SCHEDULED' || payment.status === 'PAID') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'CANCELLED',
            reference: payment.reference ? `${payment.reference} (VOIDED - reprocess)` : 'VOIDED - reprocess',
          },
        });
      }
    }
  }

  // 2. Delete existing signatures (will be recreated during approval)
  await prisma.signature.deleteMany({
    where: { invoice_id: invoiceId },
  });

  // 3. Delete PENDING exceptions (keep RESOLVED/WAIVED for history)
  await prisma.exception.deleteMany({
    where: {
      invoice_id: invoiceId,
      status: 'PENDING' as any,
    },
  });

  // 4. Close any open stage timestamps
  const openStages = await prisma.stageTimestamp.findMany({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  for (const stage of openStages) {
    await prisma.stageTimestamp.update({
      where: { id: stage.id },
      data: {
        exited_at: new Date(),
        is_breached: false,
      },
    });
  }

  // 5. Reset invoice to VALIDATION_PENDING
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.VALIDATION_PENDING as any,
      qb_posted_at: null,
    },
  });

  // 6. Audit log the reprocessing action
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'INVOICE_REPROCESSED',
      performed_by: userId,
      note: `Invoice reprocessed by user. Previous status: ${oldStatus}. Reason: ${reason}. Payments voided: ${invoice.payments.length}. Signatures reset.`,
    },
  });

  logger.info(`Invoice ${invoice.invoice_number} reprocessed by ${userId}. Old status: ${oldStatus}`);

  // 7. Re-run validation (which will auto-create approval request if it passes)
  try {
    const validationResult = await validateInvoice(invoiceId);

    if (validationResult.passed) {
      // Check batch threshold before creating approval
      const { checkBatchThreshold } = require('./validationService');
      const batchResult = await checkBatchThreshold(invoiceId);

      if (!batchResult.held) {
        // Approval request is auto-created inside validateInvoice when validation passes
        // But if it was from an exception resolution path, we need to create it explicitly
        const existingSignatures = await prisma.signature.findMany({
          where: { invoice_id: invoiceId },
        });
        if (existingSignatures.length === 0) {
          await createApprovalRequest(invoiceId, userId, { fromExceptionResolution: true });
        }
      }

      return {
        invoice_id: invoiceId,
        old_status: oldStatus as string,
        new_status: 'VALIDATION_PENDING (validation passed, approval request created)',
        message: `Invoice reprocessed successfully. Validation passed. ${batchResult.held ? 'Held for batch threshold.' : 'Approval request created.'}`,
      };
    } else {
      return {
        invoice_id: invoiceId,
        old_status: oldStatus as string,
        new_status: 'EXCEPTION_FLAGGED',
        message: `Invoice reprocessed. Validation flagged ${validationResult.exceptions.length} exception(s).`,
      };
    }
  } catch (error) {
    logger.error(`Reprocessing validation failed for invoice ${invoiceId}:`, error);
    return {
      invoice_id: invoiceId,
      old_status: oldStatus as string,
      new_status: 'VALIDATION_PENDING (validation error — manual review needed)',
      message: `Invoice reset to VALIDATION_PENDING but validation encountered an error: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
}

/**
 * Bulk reprocess multiple invoices.
 */
export async function reprocessInvoices(
  invoiceIds: string[],
  userId: string,
  reason: string
): Promise<{
  summary: { total: number; success: number; failed: number };
  results: Array<{ invoice_id: string; status: 'success' | 'error'; message?: string }>;
}> {
  const results: Array<{ invoice_id: string; status: 'success' | 'error'; message?: string }> = [];

  for (const invoiceId of invoiceIds) {
    try {
      const result = await reprocessInvoice(invoiceId, userId, reason);
      results.push({ invoice_id: invoiceId, status: 'success', message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ invoice_id: invoiceId, status: 'error', message });
    }
  }

  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;

  return {
    summary: { total: invoiceIds.length, success, failed },
    results,
  };
}
