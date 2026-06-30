import prisma from '../config/database';
import { InvoiceStatus, SignatoryRole, SignatureType, ExceptionReason, BrandTier } from '@ap-invoice/shared';
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
} from '@ap-invoice/shared';
import { sendApprovalRequestNotification } from './notificationService';
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
 * - Tier 1 (<=4999): Coordinator + Purchasing Manager
 * - Tier 2 (5000-99999): Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager + Sr. Manager GPO
 * - Tier 3 (>=100000): Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager + Sr. Manager GPO + Ms. Polly
 */
export function determineApprovalRoute(
  amount: number,
  brandName?: string,
  brandCode?: string
): ApprovalRouteStep[] {
  const tier = determineApprovalTier(amount);
  const route: ApprovalRouteStep[] = [];

  // Tier 1: amount <= $4,999 → Coordinator + Purchasing Manager
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

    // Tier 2+: add MLO Account Holder and MLO Planning Manager
    route.push({ role: SignatoryRole.MLO_ACCOUNT_HOLDER, assignee_name: mloAccountHolder, sla_days: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS });
    route.push({ role: SignatoryRole.MLO_PLANNING_MANAGER, assignee_name: mloAccountHolder, sla_days: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS });

    route.push({ role: SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION, assignee_name: SR_MANAGER_NAME, sla_days: SLA_LIMITS.SR_MANAGER_DAYS });
  }

  if (tier >= 3) {
    route.push({ role: SignatoryRole.MS_POLLY, assignee_name: MS_POLLY_NAME, sla_days: SLA_LIMITS.MS_POLLY_DAYS });
  }

  return route;
}

/**
 * Check if an invoice qualifies for auto-approval (low-risk Tier 1)
 * Criteria: Tier 1 (≤$4,999) + vendor bank verified + OCR confidence ≥90% + no exceptions + not duplicate + vendor cumulative < $100
 */
async function isAutoApprovalEligible(invoice: any): Promise<{ eligible: boolean; reason?: string }> {
  const amount = Number(invoice.total_amount);
  const tier = determineApprovalTier(amount);

  // Only Tier 1 invoices are eligible
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

  // Vendor cumulative amount this month must be less than $100
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const vendorCumulative = await prisma.invoice.aggregate({
    _sum: { total_amount: true },
    where: {
      vendor_id: invoice.vendor_id,
      status: { not: 'REJECTED' as any },
      created_at: { gte: startOfMonth },
      id: { not: invoice.id },
    },
  });
  const cumulativeAmount = Number(vendorCumulative._sum.total_amount || 0);
  if (cumulativeAmount >= 100) {
    return { eligible: false, reason: `Vendor cumulative amount $${cumulativeAmount.toFixed(2)} this month exceeds $100 threshold` };
  }

  return { eligible: true };
}

/**
 * Create approval request for a validated invoice
 * Sets invoice to PENDING_COORDINATOR and creates signature records
 * For low-risk Tier 1 invoices, auto-approves directly to APPROVED
 */
export async function createApprovalRequest(invoiceId: string, userId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== 'VALIDATION_PENDING') {
    throw new AppError('Invoice must be validated before requesting approval', 400);
  }

  // Determine approval route based on amount and brand
  const amount = Number(invoice.total_amount);
  const brandName = invoice.brand || undefined;
  const brandCode = invoice.brand_code || undefined;
  const approvalRoute = determineApprovalRoute(amount, brandName, brandCode);
  const tier = determineApprovalTier(amount);

  // Check auto-approval eligibility for low-risk Tier 1 invoices
  const autoApproval = await isAutoApprovalEligible(invoice);

  if (autoApproval.eligible) {
    // Auto-approve: skip the approval chain entirely
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.APPROVED as any,
        approval_tier: tier,
        current_approver_role: null,
      },
    });

    // Create a single auto-signed Coordinator signature
    await prisma.signature.create({
      data: {
        invoice_id: invoiceId,
        signatory_role: SignatoryRole.COORDINATOR as any,
        signatory_name: 'AUTO-APPROVED',
        signature_type: SignatureType.COMPUTER_GENERATED as any,
        signed_at: new Date(),
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

  // Create signature records for each step in the route
  const signatures = await Promise.all(
    approvalRoute.map((step) =>
      prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          signatory_role: step.role as any,
          signatory_name: '',
          signature_type: SignatureType.DIGITAL as any,
          signed_at: null,
        },
      })
    )
  );

  // Create StageTimestamp for the first stage (Coordinator)
  if (approvalRoute.length > 0) {
    await prisma.stageTimestamp.create({
      data: {
        invoice_id: invoiceId,
        stage: InvoiceStatus.PENDING_COORDINATOR as any,
        entered_at: new Date(),
        sla_hours: approvalRoute[0].sla_days * 24,
      },
    });
  }

  // Update invoice status to PENDING_COORDINATOR and set approval_tier
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.PENDING_COORDINATOR as any,
      approval_tier: tier,
      current_approver_role: SignatoryRole.COORDINATOR,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'APPROVAL_REQUESTED',
      performed_by: userId,
      note: `Approval requested. Tier ${tier}. Route: ${approvalRoute.map(s => `${s.role}(${s.assignee_name})`).join(' -> ')}`,
    },
  });

  return signatures;
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

  // Map user role to signatory role
  const signatoryRole = mapUserRoleToSignatoryRole(userRole);
  if (!signatoryRole) {
    throw new AppError('User does not have approval authority', 403);
  }

  // Find the unsigned signature for this role
  const pendingSignature = invoice.signatures.find(
    (sig: any) => sig.signatory_role === signatoryRole && !sig.signed_at
  );

  if (!pendingSignature) {
    throw new AppError('No pending approval found for this role', 404);
  }

  // Update the signature with full attribution
  await prisma.signature.update({
    where: { id: pendingSignature.id },
    data: {
      signatory_name: signerName,
      signatory_role: signatoryRole as any,
      signed_at: new Date(),
      signature_type: 'DIGITAL',
    },
  });

  // Exit current stage timestamp
  await prisma.stageTimestamp.updateMany({
    where: { invoice_id: invoiceId, exited_at: null },
    data: { exited_at: new Date() },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'APPROVED',
      performed_by: userId,
      note: `Invoice approved by ${signerName} (${signatoryRole})`,
    },
  });

  // Find next unsigned signature
  const remainingSignatures = invoice.signatures.filter(
    (sig: any) => !sig.signed_at && sig.id !== pendingSignature.id
  );

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

    await prisma.stageTimestamp.create({
      data: {
        invoice_id: invoiceId,
        stage: nextStatus as any,
        entered_at: new Date(),
        sla_hours: getSLAForRole(nextRole) * 24,
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
    // All approvals complete — update invoice status to APPROVED
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.APPROVED as any,
        current_approver_role: null,
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
    include: { signatures: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Map user role to signatory role
  const signatoryRole = mapUserRoleToSignatoryRole(userRole);
  if (!signatoryRole) {
    throw new AppError('User does not have approval authority', 403);
  }

  // Find the unsigned signature for this role
  const pendingSignature = invoice.signatures.find(
    (sig: any) => sig.signatory_role === signatoryRole && !sig.signed_at
  );

  if (!pendingSignature) {
    throw new AppError('No pending approval found for this role', 404);
  }

  // Update invoice status to REJECTED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.REJECTED as any },
  });

  // Exit current stage timestamp
  await prisma.stageTimestamp.updateMany({
    where: { invoice_id: invoiceId, exited_at: null },
    data: { exited_at: new Date() },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'REJECTED',
      performed_by: userId,
      note: `Invoice rejected by ${signatoryRole}. Reason: ${reason}`,
    },
  });

  return { message: 'Invoice rejected successfully' };
}

/**
 * Map user role to SignatoryRole
 */
function mapUserRoleToSignatoryRole(userRole: string): SignatoryRole | null {
  const mapping: Record<string, SignatoryRole> = {
    'PURCHASING_COORDINATOR': SignatoryRole.COORDINATOR,
    'PURCHASING_MANAGER': SignatoryRole.PURCHASING_MANAGER,
    'MLO_ACCOUNT_HOLDER': SignatoryRole.MLO_ACCOUNT_HOLDER,
    'MLO_PLANNING_MANAGER': SignatoryRole.MLO_PLANNING_MANAGER,
    'SR_MANAGER_GLOBAL_PRODUCTION': SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
    'MS_POLLY': SignatoryRole.MS_POLLY,
    'ACCOUNTING_ASSOCIATE': SignatoryRole.ACCOUNTING_REVIEWER,
    'ACCOUNTING_SUPERVISOR': SignatoryRole.ACCOUNTING_REVIEWER,
    'CFO': SignatoryRole.ACCOUNTING_REVIEWER,
    'IT_ADMIN': SignatoryRole.COORDINATOR,
    'ADMIN': SignatoryRole.COORDINATOR,
  };

  return mapping[userRole] || null;
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
    [SignatoryRole.COORDINATOR]: process.env.COORDINATOR_EMAIL || 'coordinator@madison88.com',
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
 */
export async function getPendingApprovals(userRole: string) {
  const signatoryRole = mapUserRoleToSignatoryRole(userRole);
  if (!signatoryRole) {
    return [];
  }

  // Query across all PENDING_* statuses
  const pendingStatuses = [
    InvoiceStatus.PENDING_COORDINATOR,
    InvoiceStatus.PENDING_MANAGER,
    InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
    InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
    InvoiceStatus.PENDING_SR_MANAGER,
    InvoiceStatus.PENDING_POLLY,
  ];

  const pendingApprovals = await prisma.invoice.findMany({
    where: {
      status: { in: pendingStatuses as any[] },
      signatures: {
        some: {
          signatory_role: signatoryRole as any,
          signed_at: null,
        },
      },
    },
    include: {
      vendor: true,
      signatures: {
        where: {
          signatory_role: signatoryRole as any,
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
