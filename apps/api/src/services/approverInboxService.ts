import prisma from '../config/database';
import { InvoiceStatus, UserRole, SignatoryRole } from '@ap-invoice/shared';

// All approval-pending statuses (used to query invoices awaiting approval)
const PENDING_APPROVAL_STATUSES = [
  InvoiceStatus.PENDING_COORDINATOR,
  InvoiceStatus.PENDING_MANAGER,
  InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
  InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
  InvoiceStatus.PENDING_SR_MANAGER,
  InvoiceStatus.PENDING_POLLY,
];

// Minimum invoice amount threshold per role (0 = no threshold)
// Tier 1: ≤$2,000 (Coordinator + PM)
// Tier 2: $2,001–$99,999 (+ MLO Account Holder + MLO Planning Manager + Sr. Manager)
// Tier 3: ≥$100,000 (+ Ms. Polly)
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
  SUPERADMIN: 0,
};

/**
 * Get pending approvals for a specific user role
 */
export async function getApproverInbox(userRole: UserRole) {
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    return [];
  }

  const threshold = ROLE_TIER_THRESHOLD[userRole] || 0;

  const pendingApprovals = await prisma.invoice.findMany({
    where: {
      status: { in: PENDING_APPROVAL_STATUSES as any[] },
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
      signatures: {
        where: {
          signatory_role: { in: signatoryRoles as any[] },
        },
      },
    },
    orderBy: {
      invoice_date: 'asc',
    },
  });

  return pendingApprovals;
}

/**
 * Get approval statistics for a specific user role
 */
export async function getApproverStatistics(userRole: UserRole) {
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    return {
      pending: 0,
      approved: 0,
      total: 0,
    };
  }

  const threshold = ROLE_TIER_THRESHOLD[userRole] || 0;

  const pending = await prisma.invoice.count({
    where: {
      status: { in: PENDING_APPROVAL_STATUSES as any[] },
      ...(threshold > 0 ? { total_amount: { gt: threshold } } : {}),
      signatures: {
        some: {
          signatory_role: { in: signatoryRoles as any[] },
          signed_at: null,
        },
      },
    },
  });

  const approved = await prisma.signature.count({
    where: {
      signatory_role: { in: signatoryRoles as any[] },
      signed_at: { not: null },
    },
  });

  return {
    pending,
    approved,
    total: pending + approved,
  };
}

/**
 * Get approval history for a specific user role
 */
export async function getApprovalHistory(userRole: UserRole, limit = 50) {
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    return [];
  }

  const signatures = await prisma.signature.findMany({
    where: {
      signatory_role: { in: signatoryRoles as any[] },
      signed_at: { not: null },
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: {
      signed_at: 'desc',
    },
    take: limit,
  });

  return signatures;
}

/**
 * Get invoices that are waiting for this role's approval
 */
export async function getWaitingForApproval(userRole: UserRole) {
  const signatoryRoles = mapUserRoleToSignatoryRoles(userRole);
  if (signatoryRoles.length === 0) {
    return [];
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: PENDING_APPROVAL_STATUSES as any[] },
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
    orderBy: {
      invoice_date: 'asc',
    },
  });

  return invoices;
}

/**
 * Get all pending approvals across all roles (for admin view)
 */
export async function getAllPendingApprovals() {
  const pendingApprovals = await prisma.invoice.findMany({
    where: {
      status: { in: PENDING_APPROVAL_STATUSES as any[] },
    },
    include: {
      vendor: true,
      signatures: {
        where: {
          signed_at: null,
        },
      },
    },
    orderBy: {
      invoice_date: 'asc',
    },
  });

  return pendingApprovals;
}

/**
 * Map user role to signatory roles
 * PLANNING_MANAGER is a single role (brand-dependent routing handled at approval time)
 */
function mapUserRoleToSignatoryRoles(userRole: UserRole): SignatoryRole[] {
  const mapping: Record<UserRole, SignatoryRole[]> = {
    [UserRole.PURCHASING_COORDINATOR]: [SignatoryRole.COORDINATOR],
    [UserRole.PURCHASING_MANAGER]: [SignatoryRole.PURCHASING_MANAGER],
    [UserRole.MLO_ACCOUNT_HOLDER]: [SignatoryRole.MLO_ACCOUNT_HOLDER, SignatoryRole.MLO_PLANNING_MANAGER],
    [UserRole.PLANNING_MANAGER]: [SignatoryRole.MLO_PLANNING_MANAGER],
    [UserRole.SR_MANAGER_GLOBAL_PRODUCTION]: [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION],
    [UserRole.MS_POLLY]: [SignatoryRole.MS_POLLY],
    [UserRole.ACCOUNTING_ASSOCIATE]: [SignatoryRole.ACCOUNTING_REVIEWER],
    [UserRole.ACCOUNTING_SUPERVISOR]: [SignatoryRole.ACCOUNTING_REVIEWER],
    [UserRole.CFO]: [SignatoryRole.ACCOUNTING_REVIEWER],
    [UserRole.IT_ADMIN]: [SignatoryRole.COORDINATOR],
    [UserRole.SUPERADMIN]: [],
    [UserRole.ADMIN]: [],
    [UserRole.PRESIDENT]: [SignatoryRole.ACCOUNTING_REVIEWER],
  };

  return mapping[userRole] || [];
}
