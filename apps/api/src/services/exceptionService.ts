import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { ExceptionStatus, ExceptionReason, InvoiceStatus } from '@ap-invoice/shared';
import { logger } from '../utils/logger';
import { validateInvoice } from './validationService';

export interface ExceptionRevalidation {
  triggered: boolean;
  passed: boolean;
  status: string;
  exception_count: number;
  message: string;
}

const revalidationInFlight = new Map<string, Promise<ExceptionRevalidation>>();

async function revalidateAfterExceptionsHandled(
  invoiceId: string,
  userId: string,
  options?: { autoAdvance?: boolean }
): Promise<ExceptionRevalidation> {
  const existing = revalidationInFlight.get(invoiceId);
  if (existing) return existing;

  const autoAdvance = options?.autoAdvance !== false; // default true (waive behavior)

  const task = (async () => {
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'AUTO_REVALIDATION_STARTED',
        performed_by: userId,
        note: `All active exceptions handled. Running one consolidated validation pass. Auto-advance: ${autoAdvance}.`,
      },
    });

    await validateInvoice(invoiceId, { skipAutoAdvance: !autoAdvance });
    const [invoice, pendingExceptions] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } }),
      prisma.exception.findMany({
        where: { invoice_id: invoiceId, status: ExceptionStatus.PENDING as any },
        select: { reason: true, detail: true },
      }),
    ]);
    const pendingCount = pendingExceptions.length;
    const status = String(invoice?.status || InvoiceStatus.VALIDATION_PENDING);
    const passed =
      pendingCount === 0 &&
      status !== InvoiceStatus.EXCEPTION_FLAGGED &&
      status !== InvoiceStatus.VALIDATION_PENDING;
    const message = passed
      ? 'Revalidation passed. The invoice advanced to the approval workflow.'
      : pendingCount === 0 && status === InvoiceStatus.VALIDATION_PENDING && !autoAdvance
        ? 'Revalidation passed. The invoice is ready for coordinator approval.'
        : pendingExceptions.some(exception => exception.reason === ExceptionReason.MISSING_BRAND_TIER)
          ? `Validation passed, but approval routing needs attention: ${
              pendingExceptions.find(exception => exception.reason === ExceptionReason.MISSING_BRAND_TIER)?.detail
            }`
        : pendingCount > 0
          ? `Revalidation found ${pendingCount} consolidated exception(s). Review the complete updated list.`
          : 'Validation passed, but approval routing could not advance. Review the invoice routing details.';

    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'AUTO_REVALIDATION_COMPLETED',
        performed_by: userId,
        note: `${message} Status: ${status}.`,
      },
    });
    return { triggered: true, passed, status, exception_count: pendingCount, message };
  })().finally(() => revalidationInFlight.delete(invoiceId));

  revalidationInFlight.set(invoiceId, task);
  return task;
}

export async function resolveException(
  exceptionId: string,
  resolution: string,
  userId: string
): Promise<{ exception: any; approvalWarning?: string; revalidation?: ExceptionRevalidation }> {
  const exception = await prisma.exception.findUnique({
    where: { id: exceptionId },
    include: { invoice: true },
  });

  if (!exception) {
    throw new AppError('Exception not found', 404);
  }

  if (exception.status === ExceptionStatus.RESOLVED) {
    throw new AppError('Exception is already resolved', 400);
  }

  // Update exception status to RESOLVED — preserve original detail, put resolution in resolution_notes
  const updatedException = await prisma.exception.update({
    where: { id: exceptionId },
    data: {
      status: ExceptionStatus.RESOLVED as any,
      resolution_notes: resolution,
      resolved_at: new Date(),
      resolved_by: userId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: exception.invoice_id,
      action: 'EXCEPTION_RESOLVED',
      performed_by: userId,
      note: `Exception "${exception.reason}" resolved: ${resolution}`,
    },
  });

  // Check if all exceptions for this invoice are resolved
  const remainingExceptions = await prisma.exception.count({
    where: {
      invoice_id: exception.invoice_id,
      status: ExceptionStatus.PENDING as any,
    },
  });

  if (
    remainingExceptions === 0 &&
    exception.invoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any)
  ) {
    try {
      // Resolve = coordinator fixed the issue. Re-validate but DON'T auto-advance.
      // The invoice stays in VALIDATION_PENDING until the coordinator explicitly approves.
      const revalidation = await revalidateAfterExceptionsHandled(exception.invoice_id, userId, { autoAdvance: false });
      return { exception: updatedException, revalidation };
    } catch (err: any) {
      logger.error(`Automatic revalidation failed for invoice ${exception.invoice_id}:`, err);
      return {
        exception: updatedException,
        approvalWarning: `Exception resolved, but automatic revalidation failed: ${err.message}. Please retry validation.`,
      };
    }
  }

  return { exception: updatedException };
}

/**
 * Auto-resolve low-risk exceptions based on severity rules.
 * Called after validation creates exceptions — resolves ones that don't need human review.
 *
 * Auto-resolve rules:
 * - OCR_LOW_CONFIDENCE: auto-resolve if amount < $500 AND vendor bank verified
 * - LATE_SUBMISSION: auto-resolve if within 21 days (not 90+)
 * - MISSING_PO_REFERENCE: auto-resolve if invoice type is STATEMENT (no PO required)
 * - BANK_DETAIL_MISMATCH: auto-resolve as WARNING only if amount < $100
 */
export async function autoResolveLowRiskExceptions(invoiceId: string): Promise<{
  resolved: number;
  remaining: number;
  details: Array<{ reason: string; action: string }>;
}> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true, exceptions: { where: { status: ExceptionStatus.PENDING as any } } },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  const amount = Number(invoice.total_amount);
  const results: Array<{ reason: string; action: string }> = [];
  let resolvedCount = 0;

  for (const exception of invoice.exceptions) {
    const reason = exception.reason as string;
    let shouldAutoResolve = false;
    let resolutionNote = '';

    switch (reason) {
      case ExceptionReason.OCR_LOW_CONFIDENCE:
        // Auto-resolve if low amount and vendor is verified
        if (amount < 500 && invoice.vendor?.bank_verified_at) {
          shouldAutoResolve = true;
          resolutionNote = `Auto-resolved: Low amount ($${amount.toFixed(2)} < $500) with verified vendor bank`;
        }
        break;

      case ExceptionReason.LATE_SUBMISSION:
        // Auto-resolve if within 21 days (warning-level lateness)
        if (invoice.invoice_date) {
          const daysSinceInvoice = Math.floor(
            (new Date().getTime() - new Date(invoice.invoice_date).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceInvoice <= 21) {
            shouldAutoResolve = true;
            resolutionNote = `Auto-resolved: Submitted within 21 days (${daysSinceInvoice} days)`;
          }
        }
        break;

      case ExceptionReason.MISSING_PO_REFERENCE:
        // Auto-resolve for STATEMENT type invoices (no PO required)
        if (invoice.invoice_type === 'STATEMENT') {
          shouldAutoResolve = true;
          resolutionNote = `Auto-resolved: STATEMENT type does not require PO reference`;
        }
        break;

      case ExceptionReason.BANK_DETAIL_MISMATCH:
        // Auto-resolve as warning only for very low amounts
        if (amount < 100) {
          shouldAutoResolve = true;
          resolutionNote = `Auto-resolved: Low amount ($${amount.toFixed(2)} < $100), bank mismatch accepted as warning`;
        }
        break;

      default:
        // All other exceptions require manual review
        break;
    }

    if (shouldAutoResolve) {
      await prisma.exception.update({
        where: { id: exception.id },
        data: {
          status: ExceptionStatus.RESOLVED as any,
          resolved_at: new Date(),
          resolved_by: 'system',
          resolution_notes: resolutionNote,
        },
      });

      results.push({ reason, action: resolutionNote });
      resolvedCount++;
    } else {
      results.push({ reason, action: 'Requires manual review' });
    }
  }

  // Check remaining pending exceptions
  const remainingCount = await prisma.exception.count({
    where: { invoice_id: invoiceId, status: ExceptionStatus.PENDING as any },
  });

  if (remainingCount === 0 && invoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any)) {
    try {
      await revalidateAfterExceptionsHandled(invoiceId, 'system');
    } catch (err: any) {
      logger.error(`Automatic revalidation failed for invoice ${invoiceId} after auto-resolve:`, err);
    }
  }

  return { resolved: resolvedCount, remaining: remainingCount, details: results };
}

export async function getPendingExceptions() {
  const pendingExceptions = await prisma.exception.findMany({
    where: {
      status: ExceptionStatus.PENDING as any,
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: {
      created_at: 'asc',
    },
  });

  return pendingExceptions;
}

export async function getExceptionsByInvoice(invoiceId: string) {
  const exceptions = await prisma.exception.findMany({
    where: {
      invoice_id: invoiceId,
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  return exceptions;
}

export async function waiveException(
  exceptionId: string,
  waiverReason: string,
  userId: string
): Promise<{ exception: any; approvalWarning?: string; revalidation?: ExceptionRevalidation }> {
  const exception = await prisma.exception.findUnique({
    where: { id: exceptionId },
    include: { invoice: true },
  });

  if (!exception) {
    throw new AppError('Exception not found', 404);
  }

  if (exception.status === (ExceptionStatus.RESOLVED as any)) {
    throw new AppError('Exception is already resolved', 400);
  }
  if (exception.status === (ExceptionStatus.WAIVED as any)) {
    throw new AppError('Exception is already waived', 400);
  }

  // Update exception status to WAIVED — preserve original detail, put waiver reason in resolution_notes
  const updatedException = await prisma.exception.update({
    where: { id: exceptionId },
    data: {
      status: ExceptionStatus.WAIVED as any,
      resolution_notes: `Waived: ${waiverReason}`,
      resolved_at: new Date(),
      resolved_by: userId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: exception.invoice_id,
      action: 'EXCEPTION_WAIVED',
      performed_by: userId,
      note: `Exception "${exception.reason}" waived: ${waiverReason}`,
    },
  });

  // Check if all exceptions for this invoice are resolved or waived
  const pendingExceptions = await prisma.exception.count({
    where: {
      invoice_id: exception.invoice_id,
      status: ExceptionStatus.PENDING as any,
    },
  });

  if (
    pendingExceptions === 0 &&
    exception.invoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any)
  ) {
    try {
      const revalidation = await revalidateAfterExceptionsHandled(exception.invoice_id, userId);
      return { exception: updatedException, revalidation };
    } catch (err: any) {
      logger.error(`Automatic revalidation failed for invoice ${exception.invoice_id} after waiver:`, err);
      return {
        exception: updatedException,
        approvalWarning: `Exception waived, but automatic revalidation failed: ${err.message}. Please retry validation.`,
      };
    }
  }

  return { exception: updatedException };
}
