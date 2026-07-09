import prisma from '../config/database';
import { InvoiceStatus, ExceptionReason, SLA_LIMITS, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { nextGenService } from './nextGenService';
import { inAppNotificationService } from './inAppNotificationService';

// QuickBooks Online API configuration
const QB_CLIENT_ID = process.env.QB_CLIENT_ID || '';
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET || '';
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || '';
const QB_ENVIRONMENT = process.env.QB_ENVIRONMENT || 'sandbox';

// ─── PRE-POST CHECK ─────────────────────────────────────────────────────────
// Deterministic sanity check before QB posting. No AI calls.

interface PrePostFlag {
  type: 'AMOUNT_VARIANCE' | 'GL_MAPPING_UNKNOWN' | 'PO_NOT_FOUND';
  severity: 'block' | 'warn';
  detail: string;
}

interface PrePostResult {
  ready: boolean;
  gl_account: string;
  qb_memo: string;
  flags: PrePostFlag[];
}

const GL_ACCOUNTS: Record<string, string> = {
  INVOICE: '6000-Operational Expenses',
  PROFORMA: '6000-Operational Expenses',
  COMMERCIAL: '6000-Operational Expenses',
  SALES: '6200-Service Expenses',
  STATEMENT: '6900-Miscellaneous Expenses',
  PREPAID: '1000-Capital Assets',
  PROTO_SAMPLE: '6100-Maintenance Expenses',
};

const VARIANCE_WARN_PCT = 0.02;  // 2%
const VARIANCE_BLOCK_PCT = 0.05; // 5%

async function prePostCheck(invoice: any): Promise<PrePostResult> {
  const flags: PrePostFlag[] = [];

  // 1. GL account — deterministic lookup
  const gl_account = GL_ACCOUNTS[invoice.invoice_type] || '6900-Miscellaneous Expenses';
  if (!GL_ACCOUNTS[invoice.invoice_type]) {
    flags.push({
      type: 'GL_MAPPING_UNKNOWN',
      severity: 'block',
      detail: `invoice_type "${invoice.invoice_type}" has no GL mapping. Route to manual review.`,
    });
  }

  // 2. QB memo — existing string concat logic
  const memoParts = [
    invoice.brand_code || invoice.brand || '',
    invoice.season || '',
    invoice.order_type || '',
    invoice.mpo_number || '',
    new Date().toISOString().split('T')[0],
  ].filter(Boolean);
  const qb_memo = invoice.qb_memo || memoParts.join('_');

  // 3. Amount vs PO variance via NextGen (new check)
  // Skip for STATEMENT documents — monthly aggregates won't match a single PO
  const poRef = invoice.mpo_number || invoice.po_number;
  if (poRef && invoice.invoice_type !== 'STATEMENT') {
    try {
      const po = invoice.mpo_number
        ? await nextGenService.getFullPOByMPO(invoice.mpo_number)
        : await nextGenService.getFullPO(invoice.po_number);

      if (!po) {
        flags.push({
          type: 'PO_NOT_FOUND',
          severity: 'warn',
          detail: `PO ${poRef} referenced but not found in NextGen.`,
        });
      } else {
        const poAmount = Number(po.amount);
        const invoiceAmount = Number(invoice.total_amount);
        if (poAmount > 0) {
          const variance = Math.abs(invoiceAmount - poAmount) / poAmount;
          if (variance > VARIANCE_BLOCK_PCT) {
            flags.push({
              type: 'AMOUNT_VARIANCE',
              severity: 'block',
              detail: `Invoice $${invoiceAmount.toFixed(2)} vs PO $${poAmount.toFixed(2)} — ${(variance * 100).toFixed(1)}% variance exceeds ${VARIANCE_BLOCK_PCT * 100}% threshold.`,
            });
          } else if (variance > VARIANCE_WARN_PCT) {
            flags.push({
              type: 'AMOUNT_VARIANCE',
              severity: 'warn',
              detail: `Invoice $${invoiceAmount.toFixed(2)} vs PO $${poAmount.toFixed(2)} — ${(variance * 100).toFixed(1)}% variance.`,
            });
          }
        }
      }
    } catch (error) {
      // NextGen unavailable — warn but don't block
      flags.push({
        type: 'PO_NOT_FOUND',
        severity: 'warn',
        detail: `NextGen lookup failed for PO ${poRef}: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    }
  }

  const ready = !flags.some((f) => f.severity === 'block');
  return { ready, gl_account, qb_memo, flags };
}

// ─── POST INVOICE ───────────────────────────────────────────────────────────

export async function postInvoice(invoiceId: string, userId: string, bypassVarianceCheck: boolean = false) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== InvoiceStatus.APPROVED as any && invoice.status !== InvoiceStatus.PENDING_ACCOUNTING as any && invoice.status !== InvoiceStatus.ON_HOLD as any) {
    throw new AppError('Invoice must be approved before posting', 400);
  }

  // Check if all signatures are signed
  const allSigned = invoice.signatures.every((sig: any) => sig.signed_at !== null);
  if (!allSigned) {
    throw new AppError('All approvals must be completed before posting', 400);
  }

  // Check for any unresolved exceptions
  const unresolvedExceptions = invoice.exceptions.filter(
    (exc: any) => exc.status === 'PENDING'
  );
  
  // Auto-resolve batch threshold exceptions when posting
  // The invoice amount itself pushes the vendor over the threshold
  const batchThresholdExceptions = unresolvedExceptions.filter(
    (exc: any) => exc.reason === ExceptionReason.BATCH_THRESHOLD_NOT_MET as any
  );
  if (batchThresholdExceptions.length > 0) {
    await prisma.exception.updateMany({
      where: {
        id: { in: batchThresholdExceptions.map((e: any) => e.id) },
      },
      data: {
        status: 'RESOLVED' as any,
        resolved_at: new Date(),
        resolved_by: userId,
        resolution_notes: 'Auto-resolved: invoice posted to accounting. Vendor cumulative threshold met by this invoice.',
      },
    });
    // Remove from unresolved list
    unresolvedExceptions.splice(0, unresolvedExceptions.length, ...unresolvedExceptions.filter(
      (exc: any) => exc.reason !== ExceptionReason.BATCH_THRESHOLD_NOT_MET as any
    ));
  }
  
  if (unresolvedExceptions.length > 0) {
    throw new AppError('Invoice has unresolved exceptions and cannot be posted', 400);
  }

  // Pre-post sanity check (deterministic, no AI)
  const check = await prePostCheck(invoice);

  // Filter out variance blocks if bypass is enabled
  if (bypassVarianceCheck) {
    check.flags = check.flags.filter(f => f.type !== 'AMOUNT_VARIANCE');
    // Recalculate ready after filtering
    check.ready = !check.flags.some((f) => f.severity === 'block');
  }

  if (!check.ready) {
    // Create exceptions for blocking flags and route to accounting review
    for (const flag of check.flags) {
      const flagReason = flag.type === 'AMOUNT_VARIANCE'
        ? ExceptionReason.AMOUNT_MISMATCH
        : flag.type === 'PO_NOT_FOUND'
        ? ExceptionReason.PO_NOT_FOUND
        : ExceptionReason.AMOUNT_MISMATCH;
      
      // Check if an exception with the same reason and similar detail already exists
      const existingException = await prisma.exception.findFirst({
        where: {
          invoice_id: invoiceId,
          reason: flagReason as any,
          status: 'PENDING' as any,
          detail: {
            contains: `[PRE-POST ${flag.severity.toUpperCase()}]`,
          },
        },
      });
      
      // Only create exception if it doesn't already exist
      if (!existingException) {
        await prisma.exception.create({
          data: {
            invoice_id: invoiceId,
            reason: flagReason as any,
            detail: `[PRE-POST ${flag.severity.toUpperCase()}] ${flag.detail}`,
          },
        });
      }
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.ON_HOLD as any },
    });

    // Exit the PENDING_ACCOUNTING stage timestamp — SLA stops ticking while on hold
    const accountingStage = await prisma.stageTimestamp.findFirst({
      where: { invoice_id: invoiceId, stage: InvoiceStatus.PENDING_ACCOUNTING as any, exited_at: null },
    });
    if (accountingStage) {
      const elapsedHours = calcWorkingHoursElapsed(new Date(accountingStage.entered_at), new Date());
      await prisma.stageTimestamp.update({
        where: { id: accountingStage.id },
        data: {
          exited_at: new Date(),
          is_breached: elapsedHours > accountingStage.sla_hours,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'PRE_POST_CHECK_FAILED',
        performed_by: userId,
        note: `Pre-post check failed: ${check.flags.filter(f => f.severity === 'block').length} block(s), ${check.flags.filter(f => f.severity === 'warn').length} warn(s). ${check.flags.map(f => f.detail).join(' | ')}`,
      },
    });

    return { posted: false, status: 'ON_HOLD', flags: check.flags };
  }

  // Log any warnings (non-blocking) as audit trail
  if (check.flags.length > 0) {
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'PRE_POST_WARNINGS',
        performed_by: 'system',
        note: `Pre-post warnings (non-blocking): ${check.flags.map(f => f.detail).join(' | ')}`,
      },
    });
  }

  // Post to QuickBooks Online
  const postingResult = await postToQuickBooks(invoice, check.gl_account, check.qb_memo);

  // Exit PENDING_ACCOUNTING stage timestamp
  const accountingStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, stage: InvoiceStatus.PENDING_ACCOUNTING as any, exited_at: null },
  });
  if (accountingStage) {
    const elapsedHours = calcWorkingHoursElapsed(new Date(accountingStage.entered_at), new Date());
    await prisma.stageTimestamp.update({
      where: { id: accountingStage.id },
      data: {
        exited_at: new Date(),
        is_breached: elapsedHours > accountingStage.sla_hours,
      },
    });
  }

  // Update invoice status to POSTED_TO_QB
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.POSTED_TO_QB as any,
      qb_posted_at: new Date(),
    },
  });
  await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'POSTED_TO_QB');

  // Create stage timestamp for POSTED_TO_QB
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: InvoiceStatus.POSTED_TO_QB as any,
      entered_at: new Date(),
      sla_hours: SLA_LIMITS.PAYMENT_DAYS * 24,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'POSTED',
      performed_by: userId,
      note: `Invoice ${invoice.invoice_number} posted to QuickBooks. QB Invoice ID: ${postingResult.qbInvoiceId}`,
    },
  });

  return { ...postingResult, payment_scheduled: false };
}

async function postToQuickBooks(invoice: any, glAccount: string, qbMemo: string) {
  // In production, this would use the QuickBooks Online API
  // For now, we'll simulate the posting process with QB-specific fields
  const qbInvoiceId = `QB-${Date.now()}-${invoice.invoice_number}`;

  // Map invoice data to QuickBooks format using pre-computed GL account and memo
  const qbInvoice = {
    InvoiceNum: invoice.invoice_number,
    VendorRef: {
      value: invoice.vendor_id,
      name: invoice.vendor?.name,
    },
    TxnDate: invoice.invoice_date ? invoice.invoice_date.toISOString().split('T')[0] : null,
    DueDate: invoice.due_date ? invoice.due_date.toISOString().split('T')[0] : null,
    Line: [
      {
        Amount: Number(invoice.total_amount),
        Description: qbMemo || `Invoice ${invoice.invoice_number}`,
        AccountRef: {
          value: glAccount,
        },
      },
    ],
    PrivateNote: qbMemo || '',
    CurrencyRef: {
      value: invoice.currency === 'USD' ? 'USD' : invoice.currency,
    },
    ClassRef: invoice.vendor?.supplier_location ? {
      value: invoice.vendor.supplier_location,
    } : undefined,
  };

  // TODO: Implement actual QuickBooks Online API call here
  // const qbResponse = await quickbooksClient.createInvoice(qbInvoice);

  return {
    success: true,
    qbInvoiceId,
    posted_at: new Date(),
    gl_account: glAccount,
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    vendor_id: invoice.vendor_id,
    qb_memo: qbMemo,
  };
}

export async function schedulePayment(
  invoiceId: string,
  paymentDate: Date,
  userId: string
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== InvoiceStatus.POSTED_TO_QB as any) {
    throw new AppError('Invoice must be posted before scheduling payment', 400);
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoiceId,
      amount: Number(invoice.total_amount),
      currency: invoice.currency,
      payment_date: paymentDate,
      status: 'SCHEDULED',
      vendor_id: invoice.vendor_id || undefined,
    },
  });

  // Exit POSTED_TO_QB stage timestamp
  const postedStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, stage: InvoiceStatus.POSTED_TO_QB as any, exited_at: null },
  });
  if (postedStage) {
    const elapsedHours = calcWorkingHoursElapsed(new Date(postedStage.entered_at), new Date());
    await prisma.stageTimestamp.update({
      where: { id: postedStage.id },
      data: {
        exited_at: new Date(),
        is_breached: elapsedHours > postedStage.sla_hours,
      },
    });
  }

  // Update invoice status to PAYMENT_SCHEDULED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.PAYMENT_SCHEDULED as any },
  });
  await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'PAYMENT_SCHEDULED');

  // Create stage timestamp for PAYMENT_SCHEDULED
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: InvoiceStatus.PAYMENT_SCHEDULED as any,
      entered_at: new Date(),
      sla_hours: SLA_LIMITS.PAYMENT_DAYS * 24,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'PAYMENT_SCHEDULED',
      performed_by: userId,
      note: `Payment of ${invoice.currency} ${Number(invoice.total_amount).toFixed(2)} scheduled for ${paymentDate.toISOString().split('T')[0]}`,
    },
  });

  return payment;
}

export async function processPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: true },
  });

  if (!payment) {
    throw new AppError('Payment not found', 404);
  }

  if (payment.status !== 'SCHEDULED') {
    throw new AppError('Payment must be scheduled to be processed', 400);
  }

  // Simulate payment processing
  const paymentResult = await simulatePaymentProcessing(payment);

  // Update payment status
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'PAID',
      paid_at: new Date(),
      reference: paymentResult.reference,
    },
  });

  // Update invoice status to PAID
  await prisma.invoice.update({
    where: { id: payment.invoice_id },
    data: { status: InvoiceStatus.PAID as any },
  });
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: payment.invoice_id }, include: { vendor: true } });
  await inAppNotificationService.notifyStageTransition(payment.invoice_id, paidInvoice?.invoice_number || '', paidInvoice?.vendor?.name || 'Unknown', '', 'PAID');

  // Exit PAYMENT_SCHEDULED stage timestamp
  const scheduledStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: payment.invoice_id, stage: InvoiceStatus.PAYMENT_SCHEDULED as any, exited_at: null },
  });
  if (scheduledStage) {
    const elapsedHours = calcWorkingHoursElapsed(new Date(scheduledStage.entered_at), new Date());
    await prisma.stageTimestamp.update({
      where: { id: scheduledStage.id },
      data: {
        exited_at: new Date(),
        is_breached: elapsedHours > scheduledStage.sla_hours,
      },
    });
  }

  // Create stage timestamp for PAID (final stage)
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: payment.invoice_id,
      stage: InvoiceStatus.PAID as any,
      entered_at: new Date(),
      sla_hours: 0,
      exited_at: new Date(),
      is_breached: false,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'PAYMENT_PROCESSED',
      performed_by: userId,
      note: `Payment processed successfully. Reference: ${paymentResult.reference}`,
    },
  });

  return paymentResult;
}

async function simulatePaymentProcessing(payment: any) {
  const reference = `PAY-${Date.now()}-${payment.id}`;
  
  return {
    success: true,
    reference,
    processed_at: new Date(),
    amount: payment.amount,
    currency: payment.currency,
    vendor_id: payment.vendor_id,
  };
}

/**
 * Release an invoice from ON_HOLD back to APPROVED
 * Used when pre-post check issues have been resolved manually
 */
export async function releaseFromHold(invoiceId: string, userId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { exceptions: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== InvoiceStatus.ON_HOLD as any) {
    throw new AppError('Invoice is not on hold', 400);
  }

  // Resolve any PENDING exceptions that were created by the pre-post check
  const pendingExceptions = invoice.exceptions.filter(
    (exc: any) => exc.status === 'PENDING'
  );
  for (const exc of pendingExceptions) {
    await prisma.exception.update({
      where: { id: exc.id },
      data: {
        status: 'RESOLVED' as any,
        resolved_at: new Date(),
        resolved_by: userId,
        resolution_notes: `Auto-resolved: invoice released from ON_HOLD by user. Pre-post issue manually addressed.`,
      },
    });
  }

  // Update invoice status back to PENDING_ACCOUNTING so it can be re-posted
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.PENDING_ACCOUNTING as any },
  });

  // Re-enter PENDING_ACCOUNTING stage since the previous one was exited when the pre-post check failed
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: InvoiceStatus.PENDING_ACCOUNTING as any,
      entered_at: new Date(),
      sla_hours: SLA_LIMITS.ACCOUNTING_DAYS * 24,
    },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'RELEASED_FROM_HOLD',
      performed_by: userId,
      note: `Invoice released from ON_HOLD back to PENDING_ACCOUNTING by user. ${pendingExceptions.length} pre-post exception(s) auto-resolved.`,
    },
  });

  return { message: 'Invoice released from hold', invoice_id: invoiceId };
}

export async function getScheduledPayments() {
  const scheduledPayments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
      payment_date: {
        gte: new Date(),
      },
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: {
      payment_date: 'asc',
    },
  });

  return scheduledPayments;
}
