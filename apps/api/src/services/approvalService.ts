import prisma from '../config/database';
import { InvoiceStatus, SignatoryRole, SignatureType, ExceptionReason, BrandTier, calcWorkingHoursElapsed } from '@ap-invoice/shared';
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
import { logger } from '../utils/logger';

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
function validateBrandForApproval(brandCode: string | null | undefined): BrandValidationResult {
  if (!brandCode) {
    return {
      tier: BrandTier.OTHER, // placeholder, won't be used if needsException
      brandName: null,
      needsException: true,
      exceptionDetail: "No brand could be extracted from this invoice's PO reference. Please confirm brand and tier manually."
    };
  }

  const known = KNOWN_BRANDS[brandCode.toUpperCase()];

  if (!known) {
    return {
      tier: BrandTier.OTHER, // placeholder, won't be used if needsException
      brandName: null,
      needsException: true,
      exceptionDetail: `Unrecognized brand code '${brandCode}' — please confirm brand and tier manually, or add ${brandCode} to the brand code table if this is a new brand.`
    };
  }

  return {
    tier: known.tier,
    brandName: known.name,
    needsException: false
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
  brandCode?: string
): ApprovalRouteStep[] {
  const tier = determineApprovalTier(amount);
  const route: ApprovalRouteStep[] = [];

  // Planning Tier: amount <= $2,000 → Coordinator + Purchasing Manager (shared 7-day SLA)
  route.push({ role: SignatoryRole.COORDINATOR, assignee_name: 'Any Coordinator', sla_days: SLA_LIMITS.COORDINATOR_DAYS });
  route.push({ role: SignatoryRole.PURCHASING_MANAGER, assignee_name: 'Any Purchasing Manager', sla_days: SLA_LIMITS.PURCHASING_MANAGER_DAYS });

  if (tier >= 2) {
    const brandValidation = validateBrandForApproval(brandCode);
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
 * Note: Batch threshold ($100 cumulative) is handled separately by checkBatchThreshold in validationService.
 * Invoices below the batch threshold are held ON_HOLD and never reach this function.
 */
async function isAutoApprovalEligible(invoice: any): Promise<{ eligible: boolean; reason?: string }> {
  const amount = Number(invoice.total_amount);
  const tier = determineApprovalTier(amount);

  // Only Planning Tier invoices are eligible
  if (tier !== 1) {
    return { eligible: false, reason: `Tier ${tier} requires manual approval` };
  }

  // Vendor must have verified bank details
  if (!invoice.vendor?.bank_verified_at) {
    return { eligible: false, reason: 'Vendor bank not verified' };
  }

  // OCR confidence must be ≥ 90%
  const ocrConfidence = invoice.ocr_confidence_score ? Number(invoice.ocr_confidence_score) : 0;
  if (ocrConfidence < 0.90) {
    return { eligible: false, reason: `OCR confidence ${Math.round(ocrConfidence * 100)}% below 90% threshold` };
  }

  // Must not be a duplicate
  if (invoice.is_duplicate) {
    return { eligible: false, reason: 'Invoice flagged as duplicate' };
  }

  // Check for any unresolved exceptions
  const exceptions = await prisma.exception.findMany({
    where: { invoice_id: invoice.id, status: 'PENDING' as any },
  });
  if (exceptions.length > 0) {
    return { eligible: false, reason: `${exceptions.length} unresolved exception(s)` };
  }

  return { eligible: true };
}

/**
 * Create approval request for a validated invoice
 * Sets invoice to PENDING_COORDINATOR and creates signature records
 * For low-risk Planning Tier invoices, auto-approves directly to APPROVED
 */
export async function createApprovalRequest(
  invoiceId: string,
  userId: string,
  options?: { fromExceptionResolution?: boolean }
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true, signatures: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
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
    approvalRoute = determineApprovalRoute(amount, brandName, brandCode);
  } catch (routeError: any) {
    // When called from exception resolution, don't re-flag (creates infinite loop).
    // Instead, throw so the caller can handle it — the invoice stays in VALIDATION_PENDING.
    if (options?.fromExceptionResolution) {
      await prisma.auditLog.create({
        data: {
          invoice_id: invoiceId,
          action: 'APPROVAL_REQUEST_FAILED',
          performed_by: userId,
          note: `Approval request could not be created: ${routeError.message}. Invoice remains in VALIDATION_PENDING — please update brand_code and manually request approval.`,
        },
      });
      throw routeError;
    }
    // Missing or unrecognized brand for Tier 2+ — flag as exception instead of silently failing
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
    });
    await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'EXCEPTION');
    await prisma.exception.create({
      data: {
        invoice_id: invoiceId,
        reason: ExceptionReason.MISSING_PO_REFERENCE as any,
        detail: routeError.message || 'Approval route could not be determined. Please confirm brand/tier.',
      },
    });
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
  const tier = determineApprovalTier(amount);

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
      },
    });

    await prisma.signature.create({
      data: {
        invoice_id: invoiceId,
        signatory_role: SignatoryRole.PURCHASING_MANAGER as any,
        signatory_name: 'AUTO-APPROVED',
        signature_type: SignatureType.COMPUTER_GENERATED as any,
        signed_at: now,
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
  const ocrSignatures = (invoice.signatures || []).filter(
    (sig: any) => sig.ocr_detected && sig.signed_at
  );

  // Create signature records for each step in the route
  // Auto-sign any step that has a matching OCR-detected signature on the document
  const createdSignatures: any[] = [];
  const autoSignedRoles: string[] = [];
  const now = new Date();

  for (const step of approvalRoute) {
    // Look for an existing OCR-detected signature matching this role
    const ocrMatch = ocrSignatures.find((sig: any) => {
      if (sig.signatory_role === step.role) return true;
      // Also try matching by name → role (OCR may have assigned a different role)
      const roleFromName = matchSignerToRole(sig.signatory_name);
      return roleFromName === step.role;
    });

    if (ocrMatch) {
      // Auto-sign: create the signature record as already signed
      const sig = await prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          signatory_role: step.role as any,
          signatory_name: ocrMatch.signatory_name,
          signature_type: SignatureType.DIGITAL as any,
          signed_at: ocrMatch.signed_at,
        },
      });
      createdSignatures.push(sig);
      autoSignedRoles.push(step.role);
      logger.info(`Auto-signed ${step.role} (${ocrMatch.signatory_name}) from OCR-detected signature on document`);
    } else {
      // Create unsigned signature record — needs manual approval
      const sig = await prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          signatory_role: step.role as any,
          signatory_name: '',
          signature_type: SignatureType.DIGITAL as any,
          signed_at: null,
        },
      });
      createdSignatures.push(sig);
    }
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
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { 
      signatures: true,
      vendor: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Map user role to allowed signatory roles
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    throw new AppError('User does not have approval authority', 403);
  }

  // Find the first unsigned signature matching any allowed role
  const pendingSignature = invoice.signatures.find(
    (sig: any) => signatoryRoles.includes(sig.signatory_role) && !sig.signed_at
  );

  if (!pendingSignature) {
    throw new AppError('No pending approval found for this role', 404);
  }

  // Enforce sequential signing: all signatures created before this one must be signed
  const sortedSignatures = [...invoice.signatures].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const pendingIndex = sortedSignatures.findIndex((s: any) => s.id === pendingSignature.id);
  const priorUnsigned = sortedSignatures.slice(0, pendingIndex).filter((s: any) => !s.signed_at);

  if (priorUnsigned.length > 0) {
    const waitingFor = priorUnsigned.map((s: any) => s.signatory_role).join(', ');
    throw new AppError(`Cannot approve yet — waiting for prior approval(s): ${waitingFor}`, 403);
  }

  const signedRole = pendingSignature.signatory_role;

  // Update the signature with full attribution
  await prisma.signature.update({
    where: { id: pendingSignature.id },
    data: {
      signatory_name: signerName,
      signed_at: new Date(),
      signature_type: 'DIGITAL',
    },
  });

  // Exit current stage timestamp — calculate breach status
  const currentStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  if (currentStage) {
    const elapsedHours = calcWorkingHoursElapsed(new Date(currentStage.entered_at), new Date());
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
      invoice.brand_code || undefined
    );
    routeOrder = approvalRoute.map((step) => step.role);
  } catch {
    // Fallback: use creation order of remaining signatures if route can't be re-computed
    routeOrder = invoice.signatures
      .filter((sig: any) => !sig.signed_at && sig.id !== pendingSignature.id)
      .map((sig: any) => sig.signatory_role);
  }
  const remainingSignatures = invoice.signatures
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

  return { message: 'Invoice approved successfully' };
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
  const pendingSignature = invoice.signatures.find(
    (sig: any) => signatoryRoles.includes(sig.signatory_role) && !sig.signed_at
  );

  if (!pendingSignature) {
    throw new AppError('No pending approval found for this role', 404);
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

  // Update invoice status to REJECTED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.REJECTED as any },
  });
  await inAppNotificationService.notifyStageTransition(invoiceId, invoice.invoice_number, invoice.vendor?.name || 'Unknown', '', 'REJECTED');

  // Exit current stage timestamp — calculate breach status
  const currentStage = await prisma.stageTimestamp.findFirst({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  if (currentStage) {
    const elapsedHours = calcWorkingHoursElapsed(new Date(currentStage.entered_at), new Date());
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
      action: 'REJECTED',
      performed_by: userId,
      note: `Invoice rejected by ${signedRole}. Reason: ${reason}`,
    },
  });

  return { message: 'Invoice rejected successfully' };
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

/**
 * Get pending approvals for a specific user role
 * Only returns invoices where it's actually this role's turn to approve
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

  const pendingApprovals = await prisma.invoice.findMany({
    where: {
      status: { in: pendingStatuses as any[] },
      signatures: {
        some: {
          signatory_role: { in: signatoryRoles as any[] },
          signed_at: null,
        },
      },
    },
    include: {
      vendor: true,
      signatures: {
        where: {
          signatory_role: { in: signatoryRoles as any[] },
        },
      },
    },
    orderBy: { invoice_date: 'asc' },
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
