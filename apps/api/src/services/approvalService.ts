import prisma from '../config/database';
import { InvoiceStatus, SignatoryRole, SignatureType, ExceptionReason, BrandTier, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { getStageSLAStart } from '../utils/slaTime';
import { AppError } from '../middleware/errorHandler';
import {
  APPROVAL_THRESHOLDS,
  SLA_LIMITS,
  KNOWN_BRANDS,
  COORDINATOR_NAMES,
  PURCHASING_MANAGER_NAMES,
  MLO_ACCOUNT_HOLDER_EDWIN,
  MLO_ACCOUNT_HOLDER_GLECIE,
  SR_MANAGER_NAME,
  MS_POLLY_NAME,
  determineApprovalTier,
  mapSignatoryRoleToPendingStatus,
  matchSignerToRole,
} from '@ap-invoice/shared';
import { sendApprovalRequestNotification } from './notificationService';
import { inAppNotificationService } from './inAppNotificationService';
import { eventBroadcaster } from './eventBroadcaster';
import { logger } from '../utils/logger';
import { getApprovalReadiness } from './approvalReadinessService';

interface ApprovalRouteStep {
  role: SignatoryRole;
  assignee_name: string;
  sla_days: number;
}

interface BrandValidationResult {
  tier: BrandTier;
  brandName: string | null;
  needsException: boolean;
  exceptionDetail?: string;
}

/**
 * Validate brand information for Tier 2+ invoices using KNOWN_BRANDS table
 */
function validateBrandForApproval(
  brandCode: string | null | undefined,
  brandName?: string | null,
  explicitTier?: BrandTier | null
): BrandValidationResult {
  const knownByCode = brandCode ? KNOWN_BRANDS[brandCode.toUpperCase()] : undefined;
  const knownByName = brandName
    ? Object.values(KNOWN_BRANDS).find(
        known => known.name.toLowerCase() === brandName.trim().toLowerCase()
      )
    : undefined;
  const known = knownByCode || knownByName;

  if (known) {
    return {
      tier: known.tier,
      brandName: known.name,
      needsException: false
    };
  }

  // A manually confirmed brand tier is enough to select the correct MLO route,
  // even when a new brand code has not been added to KNOWN_BRANDS yet.
  if (explicitTier) {
    return {
      tier: explicitTier,
      brandName: brandName || null,
      needsException: false
    };
  }

  if (!brandCode && !brandName) {
    return {
      tier: BrandTier.OTHER, // placeholder, won't be used if needsException
      brandName: null,
      needsException: true,
      exceptionDetail: 'Approval routing needs a Brand or a manually confirmed Brand Tier (TOP_10 or OTHER).'
    };
  }

  return {
    tier: BrandTier.OTHER,
    brandName: null,
    needsException: true,
    exceptionDetail: `Brand '${brandCode || brandName}' is not in the routing table. Select Brand Tier TOP_10 or OTHER to continue.`
  };
}

/**
 * Determine the approval route based on invoice amount and brand
 * 3-tier system per new flow:
 * - Planning Tier (<=2000): Coordinator + Purchasing Manager (shared 7-day SLA)
 * - Tier 2 (2001-99999): + MLO Account Holder + MLO Planning Manager + Sr. Manager GPO
 * - Tier 3 (>=100000): + Ms. Polly
 */
export function determineApprovalRoute(
  amount: number,
  brandName?: string,
  brandCode?: string,
  brandTier?: BrandTier
): ApprovalRouteStep[] {
  const tier = determineApprovalTier(amount);
  const route: ApprovalRouteStep[] = [];

  // Planning Tier: amount <= $2,000 → Coordinator + Purchasing Manager (shared 7-day SLA)
  route.push({ role: SignatoryRole.COORDINATOR, assignee_name: 'Any Coordinator', sla_days: SLA_LIMITS.COORDINATOR_DAYS });
  route.push({ role: SignatoryRole.PURCHASING_MANAGER, assignee_name: 'Any Purchasing Manager', sla_days: SLA_LIMITS.PURCHASING_MANAGER_DAYS });

  if (tier >= 2) {
    const brandValidation = validateBrandForApproval(brandCode, brandName, brandTier);
    if (brandValidation.needsException) {
      throw new AppError(brandValidation.exceptionDetail!, 400);
    }

    // MLO Account Holder — brand-dependent: Edwin for TOP_10, Glecie for OTHER
    const mloAccountHolder = brandValidation.tier === BrandTier.TOP_10
      ? MLO_ACCOUNT_HOLDER_EDWIN
      : MLO_ACCOUNT_HOLDER_GLECIE;

    // MLO Account Holder approval step
    route.push({ role: SignatoryRole.MLO_ACCOUNT_HOLDER, assignee_name: mloAccountHolder, sla_days: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS });

    // MLO Planning Manager approval step
    route.push({ role: SignatoryRole.MLO_PLANNING_MANAGER, assignee_name: mloAccountHolder, sla_days: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS });

    route.push({ role: SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION, assignee_name: SR_MANAGER_NAME, sla_days: SLA_LIMITS.SR_MANAGER_DAYS });
  }

  if (tier >= 3) {
    route.push({ role: SignatoryRole.MS_POLLY, assignee_name: MS_POLLY_NAME, sla_days: SLA_LIMITS.MS_POLLY_DAYS });
  }

  return route;
}

/**
 * Check if an invoice qualifies for auto-approval (low-risk Planning Tier)
 * Criteria: Planning Tier (≤$2,000) + vendor bank verified + OCR confidence ≥90% + no exceptions + not duplicate
 * Note: The sub-$100 hold is applied at payment scheduling time (HELD_BELOW_100 +
 * Accounting Supervisor release approval), never during validation or approval — see schedulePayment.
 */
async function isAutoApprovalEligible(invoice: any): Promise<{ eligible: boolean; reason?: string }> {
  // Auto-approval disabled: ALL invoices must go through Purchasing Coordinator for validation
  // regardless of amount, OCR confidence, or vendor bank verification status.
  return { eligible: false, reason: 'Auto-approval disabled — all invoices require coordinator validation' };
}

/**
 * Create approval request for a validated invoice
 * Sets invoice to PENDING_COORDINATOR and creates signature records
 * For low-risk Planning Tier invoices, auto-approves directly to APPROVED
 */
const approvalRequestInFlight = new Map<string, Promise<any>>();

export async function createApprovalRequest(
  invoiceId: string,
  userId: string,
  options?: { fromExceptionResolution?: boolean }
) {
  const existing = approvalRequestInFlight.get(invoiceId);
  if (existing) return existing;

  const task = createApprovalRequestInternal(invoiceId, userId, options)
    .finally(() => approvalRequestInFlight.delete(invoiceId));
  approvalRequestInFlight.set(invoiceId, task);
  return task;
}

async function createApprovalRequestInternal(
  invoiceId: string,
  userId: string,
  options?: { fromExceptionResolution?: boolean }
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true, signatures: true, invoice_lines: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Validate required fields before allowing approval request
  const readiness = getApprovalReadiness(invoice);
  if (!readiness.ready) {
    throw new AppError(
      `Cannot request approval — missing required fields: ${readiness.missing.map(f => f.lineNumber ? `Line ${f.lineNumber} ${f.label}` : f.label).join(', ')}. Please fill these in before requesting approval.`,
      400
    );
  }

  if (invoice.status !== 'VALIDATION_PENDING') {
    throw new AppError('Invoice must be validated before requesting approval', 400);
  }

  // NOTE: Vendor threshold is a warning only and does not block approval.
  // The threshold exception remains visible for reporting but will not prevent approval.

  // Determine approval route based on amount and brand
  const amount = Number(invoice.total_amount);
  const brandName = invoice.brand || undefined;
  const brandCode = invoice.brand_code || undefined;
  let approvalRoute: ApprovalRouteStep[];
  try {
    approvalRoute = determineApprovalRoute(
      amount,
      brandName,
      brandCode,
      (invoice.brand_tier || undefined) as BrandTier | undefined
    );
  } catch (routeError: any) {
    // Never leave a successfully validated invoice stuck in VALIDATION_PENDING.
    // Route failures become one actionable, de-duplicated exception.
    // BUT: if MISSING_BRAND_TIER was already waived, don't re-create it (infinite loop).
    const existingRouteException = await prisma.exception.findFirst({
      where: {
        invoice_id: invoiceId,
        reason: ExceptionReason.MISSING_BRAND_TIER as any,
        status: { in: ['PENDING', 'WAIVED'] as any },
      },
    });
    if (existingRouteException && existingRouteException.status === 'WAIVED') {
      // User already waived this exception — advance to default approval route
      logger.warn(`Approval route failed for ${invoiceId} but MISSING_BRAND_TIER was already waived. Using default route.`);
      approvalRoute = [
        { role: SignatoryRole.COORDINATOR, assignee_name: 'Any Coordinator', sla_days: SLA_LIMITS.COORDINATOR_DAYS },
        { role: SignatoryRole.PURCHASING_MANAGER, assignee_name: 'Any Purchasing Manager', sla_days: SLA_LIMITS.PURCHASING_MANAGER_DAYS },
      ];
    } else {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
      });
      await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'EXCEPTION');
      if (!existingRouteException) {
        await prisma.exception.create({
          data: {
            invoice_id: invoiceId,
            reason: ExceptionReason.MISSING_BRAND_TIER as any,
            detail: routeError.message || 'Approval route could not be determined. Confirm Brand Tier.',
          },
        });
      }
      await prisma.auditLog.create({
        data: {
          invoice_id: invoiceId,
          action: 'EXCEPTION_FLAGGED',
          performed_by: 'system',
          note: routeError.message || 'Approval route could not be determined',
        },
      });
      return [{ exception_flagged: true, invoice_id: invoiceId }];
    }
  }
  const tier = determineApprovalTier(amount);

  // Make repeated approval requests idempotent. OCR-detected document
  // signatures are source evidence; only workflow signatures count here.
  const activeWorkflowSignatures = (invoice.signatures || []).filter((signature: any) =>
    !signature.ocr_detected &&
    signature.invoice_revision === invoice.revision &&
    signature.approval_status !== 'SUPERSEDED'
  );

  // Keep the persisted approval chain aligned with the amount-based route.
  // Older records can contain stale higher-tier signatures (for example a
  // Senior Manager signature on a sub-threshold invoice). Those signatures
  // must not remain approvable after a new approval request is created.
  const routeRoles = new Set(approvalRoute.map((step) => step.role));
  const staleSignatures = activeWorkflowSignatures.filter((signature: any) => !routeRoles.has(signature.signatory_role));
  if (staleSignatures.length > 0) {
    await prisma.signature.updateMany({
      where: { id: { in: staleSignatures.map((signature: any) => signature.id) } },
      data: {
        approval_status: 'SUPERSEDED',
        invalidated_at: new Date(),
        invalidation_reason: `Removed from approval route after recalculating tier ${tier}`,
      },
    });
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        performed_by: userId,
        action: 'APPROVAL_ROUTE_NORMALIZED',
        note: `Removed ${staleSignatures.length} stale approval signature(s) not required for the current amount/brand route.`,
      },
    });
    activeWorkflowSignatures.splice(0, activeWorkflowSignatures.length, ...activeWorkflowSignatures.filter((signature: any) => routeRoles.has(signature.signatory_role)));
  }
  const routeAlreadyInitialized = approvalRoute.every(step =>
    activeWorkflowSignatures.some((signature: any) => signature.signatory_role === step.role)
  );
  if (routeAlreadyInitialized) {
    // If route is already initialized but invoice is still in VALIDATION_PENDING,
    // it means a previous request-approval call crashed before updating the status.
    // Fix: update the status to the first unsigned approver's stage.
    if (invoice.status === InvoiceStatus.VALIDATION_PENDING) {
      logger.warn(`Invoice ${invoiceId} has signatures but status is still VALIDATION_PENDING — fixing status`);
      const firstUnsigned = activeWorkflowSignatures.find((sig: any) => !sig.signed_at);
      if (firstUnsigned) {
        const fixStatus = mapSignatoryRoleToPendingStatus(firstUnsigned.signatory_role as SignatoryRole);
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: fixStatus as any,
            approval_tier: tier,
            current_approver_role: firstUnsigned.signatory_role,
          },
        });
        await prisma.stageTimestamp.create({
          data: {
            invoice_id: invoiceId,
            stage: fixStatus as any,
            entered_at: new Date(),
            sla_hours: SLA_LIMITS.COORDINATOR_DAYS * 24,
          },
        });
        logger.info(`Fixed invoice ${invoiceId} status to ${fixStatus}`);
      }
    }
    return activeWorkflowSignatures;
  }

  // Check auto-approval eligibility for low-risk Planning Tier invoices
  const autoApproval = await isAutoApprovalEligible(invoice);

  if (autoApproval.eligible) {
    // Auto-approve: skip the approval chain entirely
    // Create stage timestamps for both Coordinator and PM stages (exited immediately for SLA records)
    const now = new Date();

    await prisma.stageTimestamp.create({
      data: {
        invoice_id: invoiceId,
        stage: InvoiceStatus.PENDING_COORDINATOR as any,
        entered_at: now,
        exited_at: now,
        sla_hours: SLA_LIMITS.COORDINATOR_DAYS * 24,
        is_breached: false,
      },
    });

    await prisma.stageTimestamp.create({
      data: {
        invoice_id: invoiceId,
        stage: InvoiceStatus.PENDING_MANAGER as any,
        entered_at: now,
        exited_at: now,
        sla_hours: SLA_LIMITS.PURCHASING_MANAGER_DAYS * 24,
        is_breached: false,
      },
    });

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.PENDING_ACCOUNTING as any,
        approval_tier: tier,
        current_approver_role: null,
      },
    });
    await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'PENDING_ACCOUNTING');

    // Create auto-signed signatures for both Coordinator and PM
    await prisma.signature.create({
      data: {
        invoice_id: invoiceId,
        signatory_role: SignatoryRole.COORDINATOR as any,
        signatory_name: 'AUTO-APPROVED',
        signature_type: SignatureType.COMPUTER_GENERATED as any,
        signed_at: now,
        invoice_revision: invoice.revision,
        approval_status: 'APPROVED',
      },
    });

    await prisma.signature.create({
      data: {
        invoice_id: invoiceId,
        signatory_role: SignatoryRole.PURCHASING_MANAGER as any,
        signatory_name: 'AUTO-APPROVED',
        signature_type: SignatureType.COMPUTER_GENERATED as any,
        signed_at: now,
        invoice_revision: invoice.revision,
        approval_status: 'APPROVED',
      },
    });

    // Enter Accounting stage
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
        action: 'AUTO_APPROVED',
        performed_by: 'system',
        note: `Auto-approved: Tier ${tier}, amount $${amount.toFixed(2)}, OCR ${(invoice.ocr_confidence_score ? Math.round(Number(invoice.ocr_confidence_score) * 100) : 0)}%, vendor bank verified`,
      },
    });

    return [{ auto_approved: true, invoice_id: invoiceId }];
  }

  // Check for OCR-detected signatures already on the invoice document
  // These are signatures extracted from the PDF during OCR processing
  // NOTE: COORDINATOR role is NEVER auto-skipped — all invoices must go through
  // Purchasing Coordinator for manual validation, even if the PDF is already signed.
  const ocrSignatures = (invoice.signatures || []).filter(
    (sig: any) => sig.ocr_detected && sig.signed_at
  );

  // Create signature records for each step in the route
  // All workflow approvals require manual sign-off by actual system users.
  // OCR-detected signatures from the PDF are for reference only — they do NOT count as workflow approvals.
  const createdSignatures: any[] = [];
  const autoSignedRoles: string[] = [];
  const now = new Date();

  for (const step of approvalRoute) {
    const existingWorkflowSignature = activeWorkflowSignatures.find(
      (signature: any) => signature.signatory_role === step.role
    );
    if (existingWorkflowSignature) {
      createdSignatures.push(existingWorkflowSignature);
      if (existingWorkflowSignature.signed_at) autoSignedRoles.push(step.role);
      continue;
    }

    // All steps require manual approval by actual system users
    const sig = await prisma.signature.create({
      data: {
        invoice_id: invoiceId,
        signatory_role: step.role as any,
        signatory_name: '',
        signature_type: SignatureType.DIGITAL as any,
        signed_at: null,
        invoice_revision: invoice.revision,
        approval_status: 'PENDING',
      },
    });
    createdSignatures.push(sig);
  }

  // Find the first unsigned step — that's who needs to approve next
  const firstUnsignedIndex = createdSignatures.findIndex((sig: any) => !sig.signed_at);
  const allSigned = firstUnsignedIndex === -1;

  if (allSigned) {
    // All approvers already signed on the document — go straight to accounting
    // Create stage timestamps for all auto-signed stages (exited immediately)
    for (let i = 0; i < approvalRoute.length; i++) {
      const step = approvalRoute[i];
      const stageStatus = mapSignatoryRoleToPendingStatus(step.role);
      await prisma.stageTimestamp.create({
        data: {
          invoice_id: invoiceId,
          stage: stageStatus as any,
          entered_at: now,
          exited_at: now,
          sla_hours: step.sla_days * 24,
          is_breached: false,
        },
      });
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.PENDING_ACCOUNTING as any,
        approval_tier: tier,
        current_approver_role: null,
      },
    });
    await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'PENDING_ACCOUNTING');

    // Enter Accounting stage
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
        action: 'APPROVAL_REQUESTED',
        performed_by: userId,
        note: `Approval requested. Tier ${tier}. All approvers auto-signed from document signatures: ${autoSignedRoles.join(', ')}. Skipped to Accounting.`,
      },
    });

    return createdSignatures;
  }

  // There are unsigned steps — set invoice to the first unsigned approver's stage
  const firstUnsignedStep = approvalRoute[firstUnsignedIndex];
  const firstUnsignedStatus = mapSignatoryRoleToPendingStatus(firstUnsignedStep.role);

  // Create stage timestamps for all auto-signed (skipped) stages
  for (let i = 0; i < firstUnsignedIndex; i++) {
    const step = approvalRoute[i];
    const stageStatus = mapSignatoryRoleToPendingStatus(step.role);
    await prisma.stageTimestamp.create({
      data: {
        invoice_id: invoiceId,
        stage: stageStatus as any,
        entered_at: now,
        exited_at: now,
        sla_hours: step.sla_days * 24,
        is_breached: false,
      },
    });
  }

  // Create stage timestamp for the current (first unsigned) stage
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: firstUnsignedStatus as any,
      entered_at: new Date(),
      sla_hours: firstUnsignedStep.sla_days * 24,
    },
  });

  // Update invoice status to the first unsigned approver's stage
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: firstUnsignedStatus as any,
      approval_tier: tier,
      current_approver_role: firstUnsignedStep.role,
    },
  });
  await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', firstUnsignedStatus as string, firstUnsignedStep.role);

  // Auto-notify the first unsigned approver
  try {
    const approverEmail = getEmailForRole(firstUnsignedStep.role);
    if (approverEmail) {
      await sendApprovalRequestNotification(
        invoiceId,
        invoice.invoice_number,
        invoice.vendor?.name || 'Unknown',
        Number(invoice.total_amount),
        approverEmail
      );
      logger.info(`Auto-notified first unsigned approver (${firstUnsignedStep.role}) for invoice ${invoice.invoice_number}`);
    }
  } catch (notificationError) {
    logger.error(`Failed to notify first unsigned approver:`, notificationError);
  }

  const skippedNames = autoSignedRoles.length > 0 ? ` Auto-skipped: ${autoSignedRoles.join(', ')}` : '';
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'APPROVAL_REQUESTED',
      performed_by: userId,
      note: `Approval requested. Tier ${tier}. Route: ${approvalRoute.map(s => `${s.role}(${s.assignee_name})`).join(' -> ')}.${skippedNames} Next approver: ${firstUnsignedStep.role}`,
    },
  });

  return createdSignatures;
}

/**
 * Approve an invoice — sign the current pending signature and advance to next stage
 */
export async function approveInvoice(
  invoiceId: string,
  userId: string,
  userRole: string,
  signerName: string
) {
  let invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { 
      signatures: true,
      vendor: true,
      invoice_lines: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Validate required fields before allowing approval
  const readiness = getApprovalReadiness(invoice);
  if (!readiness.ready) {
    throw new AppError(
      `Cannot approve — missing required fields: ${readiness.missing.map(f => f.lineNumber ? `Line ${f.lineNumber} ${f.label}` : f.label).join(', ')}. Please fill these in before approving.`,
      400
    );
  }

  // Map user role to allowed signatory roles
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    throw new AppError('User does not have approval authority', 403);
  }

  let workflowSignatures = invoice!.signatures.filter((sig: any) =>
    !sig.ocr_detected &&
    sig.invoice_revision === invoice!.revision &&
    sig.approval_status !== 'SUPERSEDED'
  );

  // Pre-approved invoices uploaded by Accounting skip the normal approval chain
  // and arrive at PENDING_ACCOUNTING with zero signatures.  Create the missing
  // workflow signatures (Coordinator + PM) as auto-approved so accounting can
  // proceed to sign their review step.
  if (workflowSignatures.length === 0 && invoice.status === InvoiceStatus.PENDING_ACCOUNTING) {
    const now = new Date();
    const autoSig = async (role: SignatoryRole) =>
      prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          signatory_role: role as any,
          signatory_name: 'AUTO-APPROVED',
          signature_type: SignatureType.COMPUTER_GENERATED as any,
          signed_at: now,
          invoice_revision: invoice!.revision,
          approval_status: 'APPROVED',
        },
      });
    await autoSig(SignatoryRole.COORDINATOR);
    await autoSig(SignatoryRole.PURCHASING_MANAGER);
    // Create the ACCOUNTING_REVIEWER step as PENDING for accounting to sign
    await prisma.signature.create({
      data: {
        invoice_id: invoiceId,
        signatory_role: SignatoryRole.ACCOUNTING_REVIEWER as any,
        signatory_name: '',
        signature_type: 'DIGITAL' as any,
        signed_at: null,
        invoice_revision: invoice.revision,
        approval_status: 'PENDING',
      },
    });
    // Re-fetch to include the newly created signatures
    const refreshed = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { signatures: true, vendor: true, invoice_lines: true },
    });
    if (!refreshed) throw new AppError('Invoice not found after signature creation', 500);
    invoice = refreshed!;
    workflowSignatures = invoice.signatures.filter((sig: any) =>
      !sig.ocr_detected &&
      sig.invoice_revision === refreshed.revision &&
      sig.approval_status !== 'SUPERSEDED'
    );
  }

  // Find the first unsigned signature matching any allowed role
  let pendingSignature = workflowSignatures.find(
    (sig: any) => signatoryRoles.includes(sig.signatory_role) && !sig.signed_at
  );

  // PENDING_ACCOUNTING with all workflow signatures signed but no
  // ACCOUNTING_REVIEWER signature — this happens when the normal approval
  // chain completes but accounting review was never added. Create it now.
  if (!pendingSignature) {
    const allWorkflowSigned = workflowSignatures.length > 0
      && workflowSignatures.every((s: any) => s.signed_at && s.approval_status === 'APPROVED');
    const hasAccountingSig = workflowSignatures.some(
      (s: any) => s.signatory_role === (SignatoryRole as any).ACCOUNTING_REVIEWER
    );
    if (allWorkflowSigned && !hasAccountingSig
      && invoice!.status === (InvoiceStatus as any).PENDING_ACCOUNTING) {
      const created = await prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          signatory_role: (SignatoryRole as any).ACCOUNTING_REVIEWER,
          signatory_name: signerName,
          signatory_user_id: userId,
          signature_type: 'DIGITAL' as any,
          signed_at: new Date(),
          invoice_revision: invoice!.revision,
          approval_status: 'APPROVED',
        },
      });
      // Invoice is now fully approved — advance to PENDING_ACCOUNTING → APPROVED
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.APPROVED as any,
          current_approver_role: null,
        },
      });
      // Enter Accounting stage for posting
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
          action: 'APPROVED',
          performed_by: userId,
          note: `Invoice approved by ${signerName} (ACCOUNTING_REVIEWER) — accounting review completed`,
        },
      });
      await eventBroadcaster.broadcast({ type: 'INVOICE_UPDATED' as any, invoiceId, timestamp: Date.now() });
      return { success: true, message: 'Invoice approved — ready for posting' };
    }
    throw new AppError('No pending approval found for this role', 400);
  }

  if (
    pendingSignature.approval_status === 'RECONFIRMATION_REQUIRED' &&
    pendingSignature.signatory_name &&
    pendingSignature.signatory_name.trim().toLowerCase() !== signerName.trim().toLowerCase()
  ) {
    throw new AppError(`This returned invoice is assigned to ${pendingSignature.signatory_name}`, 403);
  }

  // Enforce sequential signing: all signatures created before this one must be signed
  const sortedSignatures = [...workflowSignatures].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const pendingIndex = sortedSignatures.findIndex((s: any) => s.id === pendingSignature.id);
  const priorUnsigned = sortedSignatures.slice(0, pendingIndex).filter((s: any) => !s.signed_at);

  if (priorUnsigned.length > 0) {
    const waitingFor = priorUnsigned.map((s: any) => s.signatory_role).join(', ');
    throw new AppError(`Cannot approve yet — waiting for prior approval(s): ${waitingFor}`, 403);
  }

  const signedRole = pendingSignature.signatory_role;

  // Update the signature with full attribution. signatory_user_id is what
  // makes "Returned to Me" match by user ID — it survives return/reject
  // re-open cycles because the re-open only clears signed_at.
  await prisma.signature.update({
    where: { id: pendingSignature.id },
    data: {
      signatory_name: signerName,
      signatory_user_id: userId,
      signed_at: new Date(),
      signature_type: 'DIGITAL',
      approval_status: 'APPROVED',
      invoice_revision: invoice.revision,
      invalidated_at: null,
      invalidation_reason: null,
    },
  });

  // Exit current stage timestamp — calculate breach status
  const currentStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  if (currentStage) {
    const elapsedHours = calcWorkingHoursElapsed(getStageSLAStart(invoice, currentStage.stage, currentStage.entered_at), new Date());
    await prisma.stageTimestamp.update({
      where: { id: currentStage.id },
      data: {
        exited_at: new Date(),
        is_breached: elapsedHours > currentStage.sla_hours,
      },
    });
  }

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'APPROVED',
      performed_by: userId,
      note: `Invoice approved by ${signerName} (${signedRole})`,
    },
  });

  // Find next unsigned signature, respecting the approval route order
  let routeOrder: string[];
  try {
    const approvalRoute = determineApprovalRoute(
      Number(invoice.total_amount),
      invoice.brand || undefined,
      invoice.brand_code || undefined,
      (invoice.brand_tier || undefined) as BrandTier | undefined
    );
    routeOrder = approvalRoute.map((step) => step.role);
  } catch {
    // Fallback: use creation order of remaining signatures if route can't be re-computed
    routeOrder = workflowSignatures
      .filter((sig: any) => !sig.signed_at && sig.id !== pendingSignature.id)
      .map((sig: any) => sig.signatory_role);
  }
  const remainingSignatures = workflowSignatures
    .filter((sig: any) => !sig.signed_at && sig.id !== pendingSignature.id)
    .sort((a: any, b: any) => {
      const indexA = routeOrder.indexOf(a.signatory_role);
      const indexB = routeOrder.indexOf(b.signatory_role);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

  if (remainingSignatures.length > 0) {
    // Advance to next approval stage
    const nextSignature = remainingSignatures[0];
    const nextRole = nextSignature.signatory_role as string;
    const nextStatus = mapSignatoryRoleToPendingStatus(nextRole as SignatoryRole);

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: nextStatus as any,
        current_approver_role: nextRole,
      },
    });
    await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', nextStatus as string, nextRole);

    // Shared SLA for Planning function: Coordinator + Manager share 7 calendar days total
    let slaHours = getSLAForRole(nextRole) * 24;
    if (nextRole === SignatoryRole.PURCHASING_MANAGER) {
      const coordinatorStage = await prisma.stageTimestamp.findFirst({
        where: {
          invoice_id: invoiceId,
          stage: InvoiceStatus.PENDING_COORDINATOR,
        },
        orderBy: { entered_at: 'desc' },
      });
      if (coordinatorStage) {
        const planningSLA = 7 * 24; // 7 calendar days shared
        const elapsedHours = calcWorkingHoursElapsed(new Date(coordinatorStage.entered_at), new Date());
        slaHours = Math.max(1, planningSLA - elapsedHours);
      }
    }

    await prisma.stageTimestamp.create({
      data: {
        invoice_id: invoiceId,
        stage: nextStatus as any,
        entered_at: new Date(),
        sla_hours: slaHours,
      },
    });

    // Auto-notify the next approver
    try {
      const approverEmail = getEmailForRole(nextRole);
      if (approverEmail) {
        await sendApprovalRequestNotification(
          invoiceId,
          invoice.invoice_number,
          invoice.vendor?.name || 'Unknown',
          Number(invoice.total_amount),
          approverEmail
        );
        logger.info(`Auto-notified next approver (${nextRole}) for invoice ${invoice.invoice_number}`);
      }
    } catch (notificationError) {
      logger.error(`Failed to notify next approver for invoice ${invoice.invoice_number}:`, notificationError);
      // Don't block the approval flow if notification fails
    }
  } else {
    // All approvals complete — update invoice status to PENDING_ACCOUNTING
    // Accounting team sees it in their pending approvals and posts to QuickBooks
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.PENDING_ACCOUNTING as any,
        current_approver_role: null,
      },
    });
    await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'APPROVED');

    // Enter Accounting stage
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
        action: 'FULLY_APPROVED',
        performed_by: userId,
        note: `Invoice ${invoice.invoice_number} fully approved and ready for posting`,
      },
    });
  }

  eventBroadcaster.broadcast({ type: 'INVOICE_STATUS_CHANGED', invoiceId, timestamp: Date.now() });
  return { message: 'Invoice approved successfully' };
}

/**
 * Find the best coordinator user to assign a freshly-created fallback
 * signature to (used when an invoice has no prior signed approver). Prefers
 * the coordinator who last acted on the invoice, then any active coordinator.
 * Returns null if no coordinator user exists — the signature is then created
 * without a user and "Returned to Me" falls back to name matching.
 */
async function findFallbackCoordinator(invoiceId: string): Promise<{ id: string; name: string } | null> {
  try {
    const lastAction = await prisma.invoiceWorkflowAction.findFirst({
      where: { invoice_id: invoiceId, performed_by_role: 'PURCHASING_COORDINATOR' },
      orderBy: { created_at: 'desc' },
    });
    if (lastAction?.performed_by) {
      const actor = await prisma.user.findUnique({ where: { id: lastAction.performed_by } });
      if (actor?.active) return { id: actor.id, name: actor.name };
    }
    const coord = await prisma.user.findFirst({
      where: { role: 'PURCHASING_COORDINATOR', active: true },
      orderBy: { created_at: 'asc' },
    });
    if (coord) return { id: coord.id, name: coord.name };
  } catch (error) {
    logger.error(`Failed to resolve fallback coordinator for ${invoiceId}:`, error);
  }
  return null;
}

/**
 * Create a fresh COORDINATOR workflow signature so a returned invoice with no
 * prior approval chain is actionable. Assigns the original coordinator user
 * when one can be resolved so the invoice lands in their "Returned to Me".
 */
async function createFallbackCoordinatorSignature(invoiceId: string, revision: number) {
  const coordinator = await findFallbackCoordinator(invoiceId);
  return prisma.signature.create({
    data: {
      invoice_id: invoiceId,
      signatory_role: SignatoryRole.COORDINATOR as any,
      signatory_name: coordinator?.name || '',
      signatory_user_id: coordinator?.id || null,
      signature_type: 'DIGITAL' as any,
      signed_at: null,
      invoice_revision: revision,
      approval_status: 'PENDING',
    },
  });
}

/**
 * Reject an invoice
 */
export async function rejectInvoice(
  invoiceId: string,
  userId: string,
  userRole: string,
  reason: string
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { signatures: true, vendor: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    throw new AppError('User does not have approval authority', 403);
  }

  // Find the first unsigned signature matching any allowed role
  let pendingSignature = invoice.signatures.find(
    (sig: any) => signatoryRoles.includes(sig.signatory_role) && !sig.signed_at
  );

  // Special case: Accounting rejecting from PENDING_ACCOUNTING stage
  // ACCOUNTING_REVIEWER is not part of the approval route signatures, so
  // we need to handle this case separately — find the last signed approver
  // and return the invoice to them.
  const isAccountingRole = ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'].includes(userRole);
  if (!pendingSignature && isAccountingRole && invoice.status === InvoiceStatus.PENDING_ACCOUNTING) {
    return rejectFromAccounting(invoiceId, userId, userRole, reason, invoice);
  }

  if (!pendingSignature) {
    throw new AppError('No pending approval found for this role', 400);
  }

  // Enforce sequential signing: all signatures created before this one must be signed
  const sortedSignatures = [...invoice.signatures].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const pendingIndex = sortedSignatures.findIndex((s: any) => s.id === pendingSignature.id);
  const priorUnsigned = sortedSignatures.slice(0, pendingIndex).filter((s: any) => !s.signed_at);

  if (priorUnsigned.length > 0) {
    const waitingFor = priorUnsigned.map((s: any) => s.signatory_role).join(', ');
    throw new AppError(`Cannot reject yet — waiting for prior approval(s): ${waitingFor}`, 403);
  }

  const signedRole = pendingSignature.signatory_role;

  // Invalidate all signatures from the rejecting approver onwards so re-approval is required
  const sortedSigs = [...invoice.signatures].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const rejectIndex = sortedSigs.findIndex((s: any) => s.id === pendingSignature.id);
  const sigsToInvalidate = sortedSigs.slice(rejectIndex);
  for (const sig of sigsToInvalidate) {
    if (sig.signed_at) {
      await prisma.signature.update({
        where: { id: sig.id },
        data: {
          invalidated_at: new Date(),
          invalidation_reason: `Rejected by ${signedRole}: ${reason}`,
        },
      });
    }
  }

  // Find the last approver who signed before the rejecting approver
  // Reject sends the invoice back to the last approver (not accounting)
  const priorSignedSigs = sortedSigs
    .slice(0, rejectIndex)
    .filter((s: any) => s.signed_at && !s.invalidated_at)
    .reverse();
  const lastApprover = priorSignedSigs[0];

  let targetStatus: any;
  let targetApproverRole: string | null;

  if (lastApprover) {
    // Return to the last approver who signed
    targetStatus = mapSignatoryRoleToPendingStatus(lastApprover.signatory_role as SignatoryRole);
    targetApproverRole = lastApprover.signatory_role;
  } else {
    // No prior approver — return to coordinator as fallback
    targetStatus = InvoiceStatus.PENDING_COORDINATOR as any;
    targetApproverRole = SignatoryRole.COORDINATOR;
  }

  // Re-open the actual prior approver's signature. Changing only the invoice
  // status leaves that signature signed, so the coordinator inbox still sees
  // the manager as the first unsigned step and the returned invoice disappears.
  const targetSignature = lastApprover || sortedSigs.find(
    (sig: any) => sig.signatory_role === SignatoryRole.COORDINATOR
  );
  if (targetSignature) {
    await prisma.signature.update({
      where: { id: targetSignature.id },
      data: {
        signed_at: null,
        approval_status: 'RECONFIRMATION_REQUIRED',
        invalidated_at: new Date(),
        invalidation_reason: `Re-opened after rejection by ${signedRole}: ${reason}`,
      },
    });
  } else {
    // No approval chain exists (e.g. accounting bulk-uploaded a pre-approved
    // invoice straight into PENDING_ACCOUNTING). Returning to the coordinator
    // without a signature strands the invoice — the coordinator could never
    // approve it. Create the coordinator signature so the return is actionable.
    await createFallbackCoordinatorSignature(invoiceId, invoice.revision);
  }

  // Exit current stage timestamp FIRST — before creating a new one
  const currentStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  if (currentStage) {
    const elapsedHours = calcWorkingHoursElapsed(getStageSLAStart(invoice, currentStage.stage, currentStage.entered_at), new Date());
    await prisma.stageTimestamp.update({
      where: { id: currentStage.id },
      data: {
        exited_at: new Date(),
        is_breached: elapsedHours > currentStage.sla_hours,
      },
    });
  }

  // Update invoice status to the last approver's pending status
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: targetStatus as any, current_approver_role: targetApproverRole as any },
  });
  await inAppNotificationService.notifyStageTransition(
    invoiceId,
    invoice.invoice_number,
    invoice.vendor?.name || 'Unknown',
    '',
    targetStatus as any
  );

  // Create new stage timestamp for the target status
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: targetStatus as any,
      sla_hours: getSLAForRole(targetApproverRole as SignatoryRole) * 24,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'REJECTED',
      performed_by: userId,
      note: `Invoice rejected by ${signedRole} — returned to ${targetApproverRole}. Reason: ${reason}`,
    },
  });

  eventBroadcaster.broadcast({ type: 'INVOICE_STATUS_CHANGED', invoiceId, timestamp: Date.now() });
  return { message: `Invoice rejected — returned to ${targetApproverRole} for correction` };
}

/**
 * Special reject path for Accounting roles rejecting from PENDING_ACCOUNTING stage.
 * Since ACCOUNTING_REVIEWER is not part of the signature chain, we find the last
 * signed approver and return the invoice to their stage for correction.
 */
async function rejectFromAccounting(
  invoiceId: string,
  userId: string,
  userRole: string,
  reason: string,
  invoice: any
) {
  if (!reason?.trim()) {
    throw new AppError('Rejection reason is required', 400);
  }

  const sortedSigs = [...invoice.signatures].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Find the last signed, non-invalidated approver
  const signedSigs = sortedSigs.filter(
    (s: any) => s.signed_at && !s.invalidated_at
  );
  const lastApprover = signedSigs[signedSigs.length - 1];

  let targetStatus: any;
  let targetApproverRole: string;

  if (lastApprover) {
    targetStatus = mapSignatoryRoleToPendingStatus(lastApprover.signatory_role as SignatoryRole);
    targetApproverRole = lastApprover.signatory_role;
  } else {
    // No signed approver — return to coordinator as fallback
    targetStatus = InvoiceStatus.PENDING_COORDINATOR as any;
    targetApproverRole = SignatoryRole.COORDINATOR;
  }

  // Re-open the last approver's signature (same as the regular reject path).
  // Without this, the signature stays signed and approveInvoice can find no
  // pending signature for that role, stranding the invoice at the returned stage.
  if (lastApprover) {
    await prisma.signature.update({
      where: { id: lastApprover.id },
      data: {
        signed_at: null,
        approval_status: 'RECONFIRMATION_REQUIRED',
        invalidated_at: new Date(),
        invalidation_reason: `Re-opened after rejection by Accounting (${userRole}): ${reason}`,
      },
    });
  } else {
    // No approval chain exists (accounting bulk-uploaded "pre-approved"
    // invoices are created directly in PENDING_ACCOUNTING with no signatures).
    // Without this, the returned invoice would strand at PENDING_COORDINATOR
    // because no coordinator signature exists to approve. Create one so the
    // coordinator can actually act on the returned invoice.
    await createFallbackCoordinatorSignature(invoiceId, invoice.revision);
  }

  // Exit current PENDING_ACCOUNTING stage
  const currentStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  if (currentStage) {
    const elapsedHours = calcWorkingHoursElapsed(getStageSLAStart(invoice, currentStage.stage, currentStage.entered_at), new Date());
    await prisma.stageTimestamp.update({
      where: { id: currentStage.id },
      data: {
        exited_at: new Date(),
        is_breached: elapsedHours > currentStage.sla_hours,
      },
    });
  }

  // Update invoice status back to the last approver
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: targetStatus as any,
      current_approver_role: targetApproverRole as any,
    },
  });
  await inAppNotificationService.notifyStageTransition(
    invoiceId,
    invoice.invoice_number,
    invoice.vendor?.name || 'Unknown',
    '',
    targetStatus as any
  );

  // Create new stage timestamp for the target status
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: targetStatus as any,
      sla_hours: getSLAForRole(targetApproverRole as SignatoryRole) * 24,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'REJECTED',
      performed_by: userId,
      note: `Invoice rejected by Accounting (${userRole}) — returned to ${targetApproverRole}. Reason: ${reason}`,
    },
  });

  // Create workflow action record
  await prisma.invoiceWorkflowAction.create({
    data: {
      invoice_id: invoiceId,
      invoice_revision: invoice.revision,
      action: 'REJECTED',
      from_stage: invoice.status,
      to_stage: targetStatus,
      reason: reason.trim(),
      performed_by: userId,
      performed_by_role: userRole,
    },
  }).catch(() => { /* workflow action table may not exist in all envs */ });

  eventBroadcaster.broadcast({ type: 'INVOICE_STATUS_CHANGED', invoiceId, timestamp: Date.now() });
  return { message: `Invoice rejected — returned to ${targetApproverRole} for correction` };
}

/** Return an invoice to a prior purchasing approver without destroying history. */
export async function returnInvoice(
  invoiceId: string,
  userId: string,
  userRole: string,
  reason: string,
  targetRole?: string
) {
  if (!reason?.trim()) throw new AppError('Return reason is required', 400);

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { signatures: { orderBy: { created_at: 'asc' } }, vendor: true },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);

  // Only digital workflow signatures participate in returns. OCR signatures are
  // source-document evidence and must never become the return owner.
  const workflowSignatures = invoice.signatures.filter((sig: any) =>
    !sig.ocr_detected &&
    sig.invoice_revision === invoice.revision &&
    sig.approval_status !== 'SUPERSEDED'
  );

  const allowedRoles = mapUserRoleToSignatoryRoles(userRole);
  const current = workflowSignatures.find((sig: any) =>
    allowedRoles.includes(sig.signatory_role) && !sig.signed_at && sig.approval_status !== 'SUPERSEDED'
  );
  if (!current) throw new AppError('No active approval is assigned to this user', 403);

  const currentIndex = workflowSignatures.findIndex((sig: any) => sig.id === current.id);
  let target = targetRole
    ? workflowSignatures.find((sig: any) => sig.signatory_role === targetRole && sig.signed_at)
    : [...workflowSignatures.slice(0, currentIndex)].reverse().find((sig: any) => sig.signed_at);
  if (!target && userRole !== 'PURCHASING_COORDINATOR') {
    target = workflowSignatures.find((sig: any) =>
      sig.signatory_role === SignatoryRole.COORDINATOR && sig.signed_at
    );
  }
  if (!target) throw new AppError('No prior approver is available for return', 400);

  const targetIndex = workflowSignatures.findIndex((sig: any) => sig.id === target!.id);
  const affectedIds = workflowSignatures.slice(targetIndex).map((sig: any) => sig.id);
  await prisma.signature.updateMany({
    where: { id: { in: affectedIds } },
    data: {
      signed_at: null,
      approval_status: 'RECONFIRMATION_REQUIRED',
      invalidated_at: new Date(),
      invalidation_reason: reason.trim(),
    },
  });

  const targetStatus = mapSignatoryRoleToPendingStatus(target.signatory_role as SignatoryRole);
  await prisma.stageTimestamp.updateMany({
    where: { invoice_id: invoiceId, exited_at: null },
    data: { exited_at: new Date() },
  });
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: targetStatus as any, current_approver_role: target.signatory_role },
  });
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: targetStatus as any,
      sla_hours: getSLAForRole(target.signatory_role) * 24,
    },
  });
  await prisma.invoiceWorkflowAction.create({
    data: {
      invoice_id: invoiceId,
      invoice_revision: invoice.revision,
      action: 'RETURNED_FOR_CORRECTION',
      from_stage: invoice.status,
      to_stage: targetStatus,
      reason: reason.trim(),
      performed_by: userId,
      performed_by_role: userRole,
    },
  });
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'RETURNED_FOR_CORRECTION',
      performed_by: userId,
      note: `Returned by ${userRole} to ${target.signatory_role}. Reason: ${reason.trim()}`,
    },
  });
  await inAppNotificationService.create({
    invoice_id: invoiceId,
    invoice_number: invoice.invoice_number,
    vendor_name: invoice.vendor?.name || 'Unknown',
    title: 'Invoice Change Requested',
    message: `${userRole.replace(/_/g, ' ')} requested changes: ${reason.trim()}`,
    type: 'warning',
    category: 'approval',
    target_role: ({
      COORDINATOR: 'PURCHASING_COORDINATOR',
      PURCHASING_MANAGER: 'PURCHASING_MANAGER',
      MLO_ACCOUNT_HOLDER: 'MLO_ACCOUNT_HOLDER',
      MLO_PLANNING_MANAGER: 'PLANNING_MANAGER',
      SR_MANAGER_GLOBAL_PRODUCTION: 'SR_MANAGER_GLOBAL_PRODUCTION',
      MS_POLLY: 'MS_POLLY',
      PRESIDENT: 'PRESIDENT',
    } as Record<string, string>)[target.signatory_role] as any,
  });
  await inAppNotificationService.notifyStageTransition(
    invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', invoice.status, targetStatus, target.signatory_role
  );
  eventBroadcaster.broadcast({ type: 'INVOICE_STATUS_CHANGED', invoiceId, timestamp: Date.now() });
  return { message: 'Invoice returned for correction', status: targetStatus, target_role: target.signatory_role };
}

/**
 * Map user role to SignatoryRole(s) the user is allowed to sign.
 * MLO Account Holder is mapped to both MLO_ACCOUNT_HOLDER and MLO_PLANNING_MANAGER
 * because the same person fills both roles in the approval chain.
 */
function mapUserRoleToSignatoryRoles(userRole: string): SignatoryRole[] {
  const mapping: Record<string, SignatoryRole[]> = {
    'PURCHASING_COORDINATOR': [SignatoryRole.COORDINATOR],
    'PURCHASING_MANAGER': [SignatoryRole.PURCHASING_MANAGER],
    'MLO_ACCOUNT_HOLDER': [SignatoryRole.MLO_ACCOUNT_HOLDER, SignatoryRole.MLO_PLANNING_MANAGER],
    'MLO_PLANNING_MANAGER': [SignatoryRole.MLO_PLANNING_MANAGER],
    'PLANNING_MANAGER': [SignatoryRole.MLO_PLANNING_MANAGER],
    'SR_MANAGER_GLOBAL_PRODUCTION': [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION],
    'MS_POLLY': [SignatoryRole.MS_POLLY],
    'ACCOUNTING_ASSOCIATE': [SignatoryRole.ACCOUNTING_REVIEWER],
    'ACCOUNTING_SUPERVISOR': [SignatoryRole.ACCOUNTING_REVIEWER],
    'CFO': [SignatoryRole.ACCOUNTING_REVIEWER],
    'PRESIDENT': [SignatoryRole.ACCOUNTING_REVIEWER],
  };

  return mapping[userRole] || [];
}

function getSLAForRole(signerRole: string): number {
  const mapping: Record<string, number> = {
    [SignatoryRole.COORDINATOR]: SLA_LIMITS.COORDINATOR_DAYS,
    [SignatoryRole.PURCHASING_MANAGER]: SLA_LIMITS.PURCHASING_MANAGER_DAYS,
    [SignatoryRole.MLO_ACCOUNT_HOLDER]: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS,
    [SignatoryRole.MLO_PLANNING_MANAGER]: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS,
    [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION]: SLA_LIMITS.SR_MANAGER_DAYS,
    [SignatoryRole.MS_POLLY]: SLA_LIMITS.MS_POLLY_DAYS,
    [SignatoryRole.ACCOUNTING_REVIEWER]: SLA_LIMITS.ACCOUNTING_DAYS,
  };
  return mapping[signerRole] || 7;
}

function getEmailForRole(signerRole: string): string | null {
  // In production, this would query a user/role mapping table
  // For now, return environment variables or default emails
  const emailMapping: Record<string, string> = {
    [SignatoryRole.COORDINATOR]: process.env.COORDINATOR_EMAIL || 'PURCHASINGTEAM@madison88.com',
    [SignatoryRole.PURCHASING_MANAGER]: process.env.PURCHASING_MANAGER_EMAIL || 'purchasing-manager@madison88.com',
    [SignatoryRole.MLO_ACCOUNT_HOLDER]: process.env.MLO_ACCOUNT_HOLDER_EMAIL || 'mlo-account-holder@madison88.com',
    [SignatoryRole.MLO_PLANNING_MANAGER]: process.env.MLO_PLANNING_MANAGER_EMAIL || 'planning-manager@madison88.com',
    [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION]: process.env.SR_MANAGER_EMAIL || 'sr-manager@madison88.com',
    [SignatoryRole.MS_POLLY]: process.env.MS_POLLY_EMAIL || 'ms-polly@madison88.com',
    [SignatoryRole.ACCOUNTING_REVIEWER]: process.env.ACCOUNTING_EMAIL || 'accounting@madison88.com',
  };
  return emailMapping[signerRole] || null;
}

// Minimum invoice amount threshold per role (0 = no threshold)
const ROLE_TIER_THRESHOLD: Record<string, number> = {
  PURCHASING_COORDINATOR: 0,
  PURCHASING_MANAGER: 0,
  MLO_ACCOUNT_HOLDER: 2000,
  PLANNING_MANAGER: 2000,
  SR_MANAGER_GLOBAL_PRODUCTION: 2000,
  MS_POLLY: 100000,
  ACCOUNTING_ASSOCIATE: 0,
  ACCOUNTING_SUPERVISOR: 0,
  CFO: 0,
  PRESIDENT: 0,
  IT_ADMIN: 0,
};

/**
 * Get pending approvals for a specific user role
 * Only returns invoices where it's actually this role's turn to approve
 * Also filters by tier threshold so roles only see invoices in their tier
 */
export async function getPendingApprovals(userRole: string) {
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    return [];
  }

  // Map signatory roles to their corresponding pending statuses
  // Only query statuses where it's this role's turn
  const roleToPendingStatus: Record<string, string> = {
    [SignatoryRole.COORDINATOR]: InvoiceStatus.PENDING_COORDINATOR,
    [SignatoryRole.PURCHASING_MANAGER]: InvoiceStatus.PENDING_MANAGER,
    [SignatoryRole.MLO_ACCOUNT_HOLDER]: InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
    [SignatoryRole.MLO_PLANNING_MANAGER]: InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
    [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION]: InvoiceStatus.PENDING_SR_MANAGER,
    [SignatoryRole.MS_POLLY]: InvoiceStatus.PENDING_POLLY,
    [SignatoryRole.ACCOUNTING_REVIEWER]: InvoiceStatus.PENDING_ACCOUNTING,
  };

  const pendingStatuses = signatoryRoles
    .map(role => roleToPendingStatus[role])
    .filter(Boolean);

  if (pendingStatuses.length === 0) {
    return [];
  }

  const threshold = ROLE_TIER_THRESHOLD[userRole] || 0;

  const pendingApprovals = await prisma.invoice.findMany({
    where: {
      status: { in: pendingStatuses as any[] },
      ...(threshold > 0 ? { total_amount: { gt: threshold } } : {}),
      signatures: {
        some: {
          signatory_role: { in: signatoryRoles as any[] },
          signed_at: null,
        },
      },
    },
    include: {
      vendor: true,
      signatures: { orderBy: { created_at: 'asc' } },
    },
    orderBy: [
      { invoice_received_date: 'asc' },
      { created_at: 'asc' },
      { id: 'asc' },
    ],
    take: 10,
  });

  return pendingApprovals;
}

/**
 * Batch approve multiple invoices at once
 * Only approves invoices where the user has pending approval authority
 */
export async function batchApproveInvoices(
  invoiceIds: string[],
  userId: string,
  userRole: string,
  signerName: string
) {
  const results: Array<{
    invoice_id: string;
    status: 'approved' | 'skipped' | 'error';
    message?: string;
  }> = [];

  for (const invoiceId of invoiceIds) {
    try {
      const result = await approveInvoice(invoiceId, userId, userRole, signerName);
      results.push({ invoice_id: invoiceId, status: 'approved', message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ invoice_id: invoiceId, status: 'error', message });
    }
  }

  const approved = results.filter(r => r.status === 'approved').length;
  const failed = results.filter(r => r.status === 'error').length;

  return {
    summary: { total: invoiceIds.length, approved, failed },
    results,
  };
}
