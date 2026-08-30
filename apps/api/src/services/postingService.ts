import prisma from '../config/database';
import { InvoiceStatus, ExceptionReason, SLA_LIMITS, BATCH_THRESHOLD_CONFIG, UserRole, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { nextGenService } from './nextGenService';
import { inAppNotificationService } from './inAppNotificationService';
import { sendPaymentConfirmationToSupplier } from './notificationService';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { getFinancePolicy } from './financePolicyService';

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

/** Deterministic GL account for an invoice type (shared by posting + QB export). */
export function deriveGLAccount(invoiceType: string): string {
  return GL_ACCOUNTS[invoiceType] || '6900-Miscellaneous Expenses';
}

/**
 * QB memo — existing string-concat logic (brand_season_ordertype_mpo_date),
 * shared by posting and the QB Bills export.
 */
export function deriveQBMemo(invoice: any): string {
  const memoParts = [
    invoice.brand_code || invoice.brand || '',
    invoice.season || '',
    invoice.order_type || '',
    invoice.mpo_number || '',
    new Date().toISOString().split('T')[0],
  ].filter(Boolean);
  return invoice.qb_memo || memoParts.join('_');
}

async function prePostCheck(invoice: any): Promise<PrePostResult> {
  const financePolicy = getFinancePolicy();
  const flags: PrePostFlag[] = [];

  // 1. GL account — deterministic lookup
  const gl_account = deriveGLAccount(invoice.invoice_type);
  if (!GL_ACCOUNTS[invoice.invoice_type]) {
    flags.push({
      type: 'GL_MAPPING_UNKNOWN',
      severity: 'block',
      detail: `invoice_type "${invoice.invoice_type}" has no GL mapping. Route to manual review.`,
    });
  }

  // 2. QB memo — existing string concat logic
  const qb_memo = deriveQBMemo(invoice);

  // 3. Amount vs PO variance via NextGen (new check)
  // Skip for STATEMENT documents — monthly aggregates won't match a single PO
  //
  // IMPORTANT: The NextGen lookup is wrapped in a hard deadline (NEXTGEN_PREPOST_DEADLINE_MS,
  // default 10s). The MPO header cache can be cold (15,000+ records) and a fresh NextGen
  // login + paginated grid read can take 30-60+ seconds. Netlify's redirect-based proxy
  // times out at ~30s, which would surface as a 504 to the user. Since the variance check
  // is already warn-only on failure, we abort early and treat NextGen as unavailable
  // rather than hanging the entire post request.
  const PREPOST_NEXTGEN_DEADLINE_MS = Math.max(
    1000,
    Number(process.env.NEXTGEN_PREPOST_DEADLINE_MS || 10000)
  );
  const poRef = invoice.mpo_number || invoice.po_number;
  if (poRef && invoice.invoice_type !== 'STATEMENT') {
    try {
      const nextgenPromise = invoice.mpo_number
        ? nextGenService.getFullPOByMPO(invoice.mpo_number)
        : nextGenService.getFullPO(invoice.po_number);

      const deadlinePromise = new Promise<null>((_, reject) =>
        setTimeout(
          () => reject(new Error(`NextGen lookup exceeded ${PREPOST_NEXTGEN_DEADLINE_MS / 1000}s deadline`)),
          PREPOST_NEXTGEN_DEADLINE_MS
        )
      );

      const po = await Promise.race([nextgenPromise, deadlinePromise]);

      if (!po) {
        flags.push({
          type: 'PO_NOT_FOUND',
          severity: 'block',
          detail: `PO ${poRef} referenced but not found in NextGen.`,
        });
      } else {
        const poAmount = Number(po.amount);
        const invoiceAmount = Number(invoice.total_amount);
        if (poAmount > 0) {
          const variance = Math.abs(invoiceAmount - poAmount) / poAmount;
          const absoluteDifference = Math.abs(invoiceAmount - poAmount);
          if (absoluteDifference > financePolicy.invoiceRoundingTolerance && variance > financePolicy.poAmountTolerancePercent) {
            flags.push({
              type: 'AMOUNT_VARIANCE',
              severity: 'block',
              detail: `Invoice $${invoiceAmount.toFixed(2)} vs PO $${poAmount.toFixed(2)} — ${(variance * 100).toFixed(1)}% variance exceeds ${(financePolicy.poAmountTolerancePercent * 100).toFixed(2)}% Finance tolerance.`,
            });
          } else if (absoluteDifference > financePolicy.invoiceRoundingTolerance && variance > financePolicy.postingWarningPercent) {
            flags.push({
              type: 'AMOUNT_VARIANCE',
              severity: 'warn',
              detail: `Invoice $${invoiceAmount.toFixed(2)} vs PO $${poAmount.toFixed(2)} — ${(variance * 100).toFixed(1)}% variance.`,
            });
          }
        }
      }
    } catch (error) {
      // Fail closed: Accounting must not post a PO-backed invoice whose source
      // of truth could not be verified at posting time.
      flags.push({
        type: 'PO_NOT_FOUND',
        severity: 'block',
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
      invoice_lines: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== InvoiceStatus.APPROVED as any && invoice.status !== InvoiceStatus.PENDING_ACCOUNTING as any) {
    throw new AppError('Invoice must be approved before posting', 400);
  }

  // Bypass is only allowed for invoices uploaded by Accounting.
  // Check the INVOICE_CREATED audit log to see if the uploader was an Accounting user.
  let uploadedByAccounting = false;
  if (bypassVarianceCheck) {
    const createLog = await prisma.auditLog.findFirst({
      where: { invoice_id: invoiceId, action: 'INVOICE_CREATED' },
    });
    const noteLower = (createLog?.note || '').toLowerCase();
    uploadedByAccounting = createLog?.actor_role === 'ACCOUNTING_ASSOCIATE'
      || createLog?.actor_role === 'ACCOUNTING_SUPERVISOR'
      || noteLower.includes('uploaded by accounting')
      || noteLower.includes('bulk upload') && noteLower.includes('accounting');
    if (!uploadedByAccounting) {
      throw new AppError('Bypass is only available for invoices uploaded by Accounting', 403);
    }
  }

  // Check if all signatures are signed.
  // Invoices approved before the workflow-signature era may only carry OCR-detected
  // signature records (no workflow signatures at all). Those legacy invoices fall back
  // to the OCR signature set so they are not permanently stuck; invoices with workflow
  // signatures always require the workflow set to be complete and current.
  const workflowSignatures = invoice.signatures.filter((sig: any) => !sig.ocr_detected);
  const requiredSignatures = workflowSignatures.length > 0
    ? workflowSignatures
    : invoice.signatures.filter((sig: any) => sig.ocr_detected);
  // Pre-approved invoices uploaded by Accounting arrive at PENDING_ACCOUNTING
  // with zero signatures — they are already considered approved.
  const preApprovedWithNoSignatures = invoice.status === InvoiceStatus.PENDING_ACCOUNTING
    && invoice.signatures.length === 0;
  const allSigned = preApprovedWithNoSignatures
    || (requiredSignatures.length > 0 && requiredSignatures.every((sig: any) =>
      sig.signed_at !== null &&
      !sig.invalidated_at &&
      sig.invoice_revision === invoice.revision &&
      sig.approval_status === 'APPROVED'
    ));
  if (!allSigned && !bypassVarianceCheck) {
    throw new AppError('All approvals must be completed before posting', 400);
  }

  // The sub-$100 hold is applied at payment scheduling time (HELD_BELOW_100 +
  // Purchasing release approval), NOT here. Posting never blocks a fully approved
  // invoice on a vendor-cumulative threshold — see schedulePayment below.

  // Check for any unresolved exceptions
  const unresolvedExceptions = invoice.exceptions.filter(
    (exc: any) => exc.status === 'PENDING'
  );
  
  // Auto-resolve batch-threshold exceptions created by a manual hold — the
  // invoice is being posted now, so the hold no longer applies.
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
        resolution_notes: 'Auto-resolved: manually held invoice posted to accounting.',
      },
    });
    // Remove from unresolved list
    unresolvedExceptions.splice(0, unresolvedExceptions.length, ...unresolvedExceptions.filter(
      (exc: any) => exc.reason !== ExceptionReason.BATCH_THRESHOLD_NOT_MET as any
    ));
  }
  
  if (unresolvedExceptions.length > 0 && !bypassVarianceCheck) {
    throw new AppError('Invoice has unresolved exceptions and cannot be posted', 400);
  }

  // When bypassing, auto-resolve all remaining PENDING exceptions and log
  if (unresolvedExceptions.length > 0 && bypassVarianceCheck) {
    await prisma.exception.updateMany({
      where: {
        id: { in: unresolvedExceptions.map((e: any) => e.id) },
      },
      data: {
        status: 'RESOLVED' as any,
        resolved_at: new Date(),
        resolved_by: userId,
        resolution_notes: 'Auto-resolved: Accounting bypassed all validation to proceed with posting.',
      },
    });
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'EXCEPTIONS_BYPASSED',
        performed_by: userId,
        note: `Bypassed ${unresolvedExceptions.length} unresolved exception(s): ${unresolvedExceptions.map((e: any) => e.reason).join(', ')}`,
      },
    });
  }

  // Pre-post sanity check (deterministic, no AI)
  const check = await prePostCheck(invoice);

  // When bypass is enabled, skip all pre-post blocking checks
  if (bypassVarianceCheck) {
    check.flags = check.flags.filter(f => f.severity !== 'block');
    check.ready = true;
  }

  if (!check.ready) {
    // Create exceptions for blocking flags and route to accounting review.
    // Skip flags that were already acknowledged (RESOLVED/WAIVED) by a previous
    // release-from-hold — otherwise the invoice loops ON_HOLD → release → post → ON_HOLD.
    const remainingBlockFlags: typeof check.flags = [];
    for (const flag of check.flags) {
      if (flag.severity !== 'block') continue;
      const flagReason = flag.type === 'AMOUNT_VARIANCE'
        ? ExceptionReason.AMOUNT_MISMATCH
        : flag.type === 'PO_NOT_FOUND'
        ? ExceptionReason.PO_NOT_FOUND
        : ExceptionReason.AMOUNT_MISMATCH;

      // Check if this exact pre-post flag was already handled (PENDING or RESOLVED/WAIVED)
      const existingException = await prisma.exception.findFirst({
        where: {
          invoice_id: invoiceId,
          reason: flagReason as any,
          status: { in: ['PENDING', 'RESOLVED', 'WAIVED'] as any },
          detail: {
            contains: `[PRE-POST ${flag.severity.toUpperCase()}]`,
          },
        },
      });

      if (existingException) {
        // Already acknowledged — skip this flag entirely
        continue;
      }

      // New blocking flag — create exception and hold
      await prisma.exception.create({
        data: {
          invoice_id: invoiceId,
          reason: flagReason as any,
          detail: `[PRE-POST ${flag.severity.toUpperCase()}] ${flag.detail}`,
        },
      });
      remainingBlockFlags.push(flag);
    }

    // If all blocking flags were already acknowledged, proceed with posting
    if (remainingBlockFlags.length === 0) {
      check.ready = true;
    } else {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.ON_HOLD as any },
      });

      // Exit the PENDING_ACCOUNTING stage timestamp — SLA stops ticking while on hold
      const holdStage = await prisma.stageTimestamp.findFirst({
        where: { invoice_id: invoiceId, stage: InvoiceStatus.PENDING_ACCOUNTING as any, exited_at: null },
      });
      if (holdStage) {
        const elapsedHours = calcWorkingHoursElapsed(new Date(holdStage.entered_at), new Date());
        await prisma.stageTimestamp.update({
          where: { id: holdStage.id },
          data: {
            exited_at: new Date(),
            is_breached: elapsedHours > holdStage.sla_hours,
          },
        });
      }

      await prisma.auditLog.create({
        data: {
          invoice_id: invoiceId,
          action: 'PRE_POST_CHECK_FAILED',
          performed_by: userId,
          note: `Pre-post check failed: ${remainingBlockFlags.filter((f: any) => f.severity === 'block').length} block(s), ${check.flags.filter((f: any) => f.severity === 'warn').length} warn(s). ${remainingBlockFlags.map((f: any) => f.detail).join(' | ')}`,
        },
      });

      return { posted: false, status: 'ON_HOLD', flags: check.flags };
    }
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
      note: `Invoice ${invoice.invoice_number} posted for QuickBooks — bill ready for manual import via the QB Bills export file (no live QB API call). GL: ${postingResult.gl_account}, Memo: ${postingResult.qb_memo}`,
    },
  });

  // Auto-schedule the payment — no manual Schedule Payment step. The payment
  // date derives from the invoice's due date (SCHEDULED = possible payment
  // date). If scheduling unexpectedly fails, the invoice stays POSTED_TO_QB
  // and can be scheduled via the API later.
  let payment: any = null;
  try {
    payment = await schedulePayment(invoiceId, undefined, userId);
  } catch (err) {
    logger.warn(`Auto-schedule failed for invoice ${invoiceId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ...postingResult, payment_scheduled: !!payment, payment };
}

async function postToQuickBooks(invoice: any, glAccount: string, qbMemo: string) {
  // The QuickBooks API is NOT called here. Posting marks the invoice as ready
  // for QuickBooks import; the actual artifact is the QB Bills export file
  // (see qbExportService) which the accounting team imports into QB manually.
  // The QB payload below documents the structure that export produces.
  const qbInvoiceId: string | null = null;

  // Build line items for QuickBooks — export each MPO line separately
  let qbLines: any[] = [];

  if (invoice.invoice_lines && invoice.invoice_lines.length > 0) {
    // Group lines by MPO base number so each MPO is exported as a separate line
    const mpoGroups = new Map<string, { mpo: string; amount: number; lines: any[] }>();
    for (const line of invoice.invoice_lines) {
      const mpoKey = line.mpo_base_number || invoice.mpo_number || 'NO_MPO';
      if (!mpoGroups.has(mpoKey)) {
        mpoGroups.set(mpoKey, { mpo: mpoKey, amount: 0, lines: [] });
      }
      const group = mpoGroups.get(mpoKey)!;
      group.amount += Number(line.line_amount) || 0;
      group.lines.push(line);
    }

    qbLines = Array.from(mpoGroups.values()).map(group => ({
      Amount: Number(group.amount.toFixed(2)),
      Description: `${qbMemo || `Invoice ${invoice.invoice_number}`} | MPO: ${group.mpo} (${group.lines.length} line(s))`,
      AccountRef: { value: glAccount },
      MPORef: group.mpo,
    }));
  } else {
    // No line items — post as single line
    qbLines = [
      {
        Amount: Number(invoice.total_amount),
        Description: qbMemo || `Invoice ${invoice.invoice_number}`,
        AccountRef: { value: glAccount },
      },
    ];
  }

  // Map invoice data to QuickBooks format
  const qbInvoice = {
    InvoiceNum: invoice.invoice_number,
    VendorRef: {
      value: invoice.vendor_id,
      name: invoice.vendor?.name,
    },
    TxnDate: invoice.invoice_date ? invoice.invoice_date.toISOString().split('T')[0] : null,
    DueDate: invoice.due_date ? invoice.due_date.toISOString().split('T')[0] : null,
    Line: qbLines,
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
    lines_exported: qbLines.length,
    mpo_lines: qbLines.filter(l => l.MPORef).map(l => ({ mpo: l.MPORef, amount: l.Amount })),
  };
}

export async function schedulePayment(
  invoiceId: string,
  paymentDate: Date | undefined,
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

  const existingPayment = await prisma.payment.findFirst({
    where: {
      invoice_id: invoiceId,
      status: { notIn: ['CANCELLED', 'VOIDED'] },
    },
    select: { id: true, status: true },
  });
  if (existingPayment) {
    throw new AppError(`Invoice already has an active or completed payment (${existingPayment.status})`, 409);
  }

  const beneficiary = invoice.vendor?.beneficiary_name || invoice.vendor?.name;
  const bankName = invoice.vendor?.bank_name;
  const accountNumber = invoice.vendor?.account_number;
  const swiftCode = invoice.vendor?.swift_code;
  if (!beneficiary || !bankName || !accountNumber || !swiftCode) {
    throw new AppError('Verified Vendor Master bank details are required before payment scheduling', 400);
  }
  const snapshotAt = new Date();
  const bankSnapshotHash = crypto.createHash('sha256').update(JSON.stringify({
    vendor_id: invoice.vendor_id,
    beneficiary,
    bank_name: bankName,
    bank_address: invoice.vendor?.bank_address || '',
    swift_code: swiftCode,
    account_number: accountNumber,
    invoice_revision: invoice.revision,
  })).digest('hex');

  // Payment date auto-derives from the invoice's due date — SCHEDULED is the
  // "possible payment date", not a manually typed commitment. Falls back to
  // today only when the invoice has no due date.
  const resolvedPaymentDate =
    paymentDate && !isNaN(paymentDate.getTime())
      ? paymentDate
      : invoice.due_date
        ? new Date(invoice.due_date)
        : new Date();

  // Record how the payment date was set explicitly (DUE_DATE / MANUAL /
  // DEFAULT) instead of inferring it later from date equality.
  const paymentDateSource =
    paymentDate && !isNaN(paymentDate.getTime())
      ? 'MANUAL'
      : invoice.due_date
        ? 'DUE_DATE'
        : 'DEFAULT';

  // Sub-$100 invoices are HELD: they appear in the batch schedule only when
  // they fall within the Associate's cut-off (due on or before the cut-off),
  // and only proceed after Accounting Supervisor release.
  const heldBelow100 = Number(invoice.total_amount) < BATCH_THRESHOLD_CONFIG.AMOUNT;

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoiceId,
      amount: Number(invoice.total_amount),
      currency: invoice.currency,
      payment_date: resolvedPaymentDate,
      payment_date_source: paymentDateSource,
      status: heldBelow100 ? 'HELD_BELOW_100' : 'SCHEDULED',
      vendor_id: invoice.vendor_id || undefined,
      beneficiary_name_snapshot: beneficiary,
      bank_name_snapshot: bankName,
      bank_address_snapshot: invoice.vendor?.bank_address || null,
      swift_code_snapshot: swiftCode,
      account_number_snapshot: accountNumber,
      bank_snapshot_hash: bankSnapshotHash,
      bank_snapshot_at: snapshotAt,
      vendor_bank_verified_at_snapshot: invoice.vendor?.bank_verified_at || null,
      invoice_revision_snapshot: invoice.revision,
    },
  });

  if (heldBelow100) {
    await inAppNotificationService.create({
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number,
      vendor_name: invoice.vendor?.name || 'Unknown',
      title: `Invoice ${invoice.invoice_number} held (below $${BATCH_THRESHOLD_CONFIG.AMOUNT})`,
      message: `Payment of ${invoice.currency} ${Number(invoice.total_amount).toFixed(2)} is under the $${BATCH_THRESHOLD_CONFIG.AMOUNT} threshold — held (HELD_BELOW_100) until it falls within the batch cut-off. Accounting Supervisor approval is required for release.`,
      type: 'warning',
      category: 'payment',
      target_role: UserRole.ACCOUNTING_SUPERVISOR,
    });
  }

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
      note: `Payment of ${invoice.currency} ${Number(invoice.total_amount).toFixed(2)} scheduled for ${resolvedPaymentDate.toISOString().split('T')[0]}${heldBelow100 ? ` — HELD_BELOW_100 (under $${BATCH_THRESHOLD_CONFIG.AMOUNT}); Accounting Supervisor notified for release approval` : ''}`,
    },
  });

  return payment;
}

export interface PaymentExecutionInput {
  paidDate?: string;
  reference?: string;
  bankUsed?: string;
  remarks?: string;
  proofFileUrl?: string;
  proofFileName?: string;
}

export async function processPayment(paymentId: string, userId: string, execution: PaymentExecutionInput = {}) {
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
  const paidAt = execution.paidDate ? new Date(execution.paidDate) : new Date();
  const reference = execution.reference?.trim() || paymentResult.reference;

  // Update payment status
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'PAID',
      paid_at: paidAt,
      reference,
      bank_used: execution.bankUsed?.trim() || null,
      remarks: execution.remarks?.trim() || null,
      proof_file_url: execution.proofFileUrl || null,
      proof_file_name: execution.proofFileName || null,
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
      note: [
        `Payment processed successfully. Reference: ${reference}`,
        execution.bankUsed ? `Bank: ${execution.bankUsed}` : null,
        execution.remarks ? `Remarks: ${execution.remarks}` : null,
        execution.proofFileName ? `Proof: ${execution.proofFileName}` : null,
      ].filter(Boolean).join(' | '),
    },
  });

  // Send payment confirmation email to supplier if vendor has contact email
  try {
    const fullInvoice = await prisma.invoice.findUnique({
      where: { id: payment.invoice_id },
      include: { vendor: true },
    });
    if (fullInvoice?.vendor?.contact_email) {
      await sendPaymentConfirmationToSupplier(
        payment.invoice_id,
        fullInvoice.invoice_number,
        fullInvoice.vendor.name,
        fullInvoice.vendor.contact_email,
        Number(payment.amount),
        payment.currency || 'USD',
        reference,
        paidAt
      );
      logger.info(`Payment confirmation email sent to ${fullInvoice.vendor.contact_email} for invoice ${fullInvoice.invoice_number}`);
    } else {
      logger.info(`No vendor contact email on file for invoice ${fullInvoice?.invoice_number} — skipping supplier confirmation email`);
    }
  } catch (emailError) {
    logger.error('Failed to send payment confirmation email to supplier:', emailError);
  }

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

  // Normal case: invoice was held during posting (pre-post check failed)
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

/**
 * Manually put an invoice ON_HOLD for batch threshold reasons.
 * Used by Accounting Associate when an invoice doesn't meet the $100 minimum
 * cumulative amount for a vendor. The invoice stays on hold until more invoices
 * for the same vendor arrive and the cumulative reaches the threshold.
 */
export async function holdInvoiceForBatchThreshold(invoiceId: string, userId: string, reason?: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true, exceptions: { where: { status: 'PENDING' as any } } },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status === InvoiceStatus.ON_HOLD as any) {
    throw new AppError('Invoice is already on hold', 400);
  }

  // Only allow holding invoices that are in a pre-payment stage
  const holdableStatuses = [InvoiceStatus.PENDING_ACCOUNTING];

  if (!holdableStatuses.includes(invoice.status as any)) {
    throw new AppError(`Cannot hold invoice in ${invoice.status}. ON_HOLD is available only in PENDING_ACCOUNTING.`, 400);
  }

  const threshold = 100;
  const openForVendor = await prisma.invoice.findMany({
    where: { vendor_id: invoice.vendor_id, status: { in: ['PENDING_ACCOUNTING', 'APPROVED', 'ON_HOLD'] as any } },
    select: { id: true, total_amount: true },
  });
  const cumulative = openForVendor.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
  if (cumulative >= threshold) {
    throw new AppError(`Vendor cumulative amount is already ${cumulative.toFixed(2)}, at or above the ${threshold.toFixed(2)} threshold. Create a payment batch instead of placing this invoice on hold.`, 400);
  }

  const previousStatus = invoice.status;

  // Update invoice status to ON_HOLD
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.ON_HOLD as any },
  });

  // Create batch threshold exception
  const holdReason = reason || `Vendor cumulative amount ${cumulative.toFixed(2)} is below ${threshold.toFixed(2)} batch threshold.`;
  await prisma.exception.create({
    data: {
      invoice_id: invoiceId,
      reason: ExceptionReason.BATCH_THRESHOLD_NOT_MET as any,
      detail: holdReason,
    },
  });

  // Log the hold action
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'MANUAL_HOLD',
      performed_by: userId,
      note: `Invoice manually put ON_HOLD by Accounting Associate. Previous status: ${previousStatus}. Reason: ${holdReason}`,
    },
  });

  // Send notification
  try {
    await inAppNotificationService.notifyStageTransition(
      invoiceId,
      invoice.invoice_number,
      invoice.vendor?.name || 'Unknown',
      previousStatus,
      InvoiceStatus.ON_HOLD as any
    );
  } catch (err) {
    logger.error('Failed to send on-hold notification:', err);
  }

  logger.info(`Invoice ${invoiceId} manually held by ${userId}. Previous status: ${previousStatus}`);

  return {
    message: 'Invoice put on hold for batch threshold',
    invoice_id: invoiceId,
    previous_status: previousStatus,
    vendor: invoice.vendor?.name,
    cumulative_amount: Number(cumulative.toFixed(2)),
    threshold_amount: threshold,
    amount: Number(invoice.total_amount),
  };
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
