import prisma from '../config/database';
import { InvoiceStatus, UserRole, SignatureRole } from '@ap-invoice/shared';

/**
 * Get pending approvals for a specific user role
 */
export async function getApproverInbox(userRole: UserRole) {
  const signatureRole = mapUserRoleToSignatureRole(userRole);
  if (!signatureRole) {
    return [];
  }

  const pendingApprovals = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.PENDING_APPROVAL,
      signatures: {
        some: {
          role: signatureRole,
          status: 'PENDING',
        },
      },
    },
    include: {
      vendor: true,
      signatures: {
        where: {
          role: signatureRole,
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
  const signatureRole = mapUserRoleToSignatureRole(userRole);
  if (!signatureRole) {
    return {
      pending: 0,
      approved: 0,
      rejected: 0,
      total: 0,
    };
  }

  const pending = await prisma.invoice.count({
    where: {
      status: InvoiceStatus.PENDING_APPROVAL,
      signatures: {
        some: {
          role: signatureRole,
          status: 'PENDING',
        },
      },
    },
  });

  const approved = await prisma.signature.count({
    where: {
      role: signatureRole,
      status: 'APPROVED',
    },
  });

  const rejected = await prisma.signature.count({
    where: {
      role: signatureRole,
      status: 'REJECTED',
    },
  });

  return {
    pending,
    approved,
    rejected,
    total: pending + approved + rejected,
  };
}

/**
 * Get approval history for a specific user role
 */
export async function getApprovalHistory(userRole: UserRole, limit = 50) {
  const signatureRole = mapUserRoleToSignatureRole(userRole);
  if (!signatureRole) {
    return [];
  }

  const signatures = await prisma.signature.findMany({
    where: {
      role: signatureRole,
      status: {
        in: ['APPROVED', 'REJECTED'],
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
  const signatureRole = mapUserRoleToSignatureRole(userRole);
  if (!signatureRole) {
    return [];
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.PENDING_APPROVAL,
      signatures: {
        some: {
          role: signatureRole,
          status: 'WAITING',
        },
      },
    },
    include: {
      vendor: true,
      signatures: {
        where: {
          role: signatureRole,
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
      status: InvoiceStatus.PENDING_APPROVAL,
    },
    include: {
      vendor: true,
      signatures: {
        where: {
          status: 'PENDING',
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
 * Map user role to signature role
 */
function mapUserRoleToSignatureRole(userRole: UserRole): SignatureRole | null {
  const mapping: Record<UserRole, SignatureRole> = {
    [UserRole.PURCHASING_COORDINATOR]: SignatureRole.COORDINATOR,
    [UserRole.PURCHASING_MANAGER]: SignatureRole.MANAGER,
    [UserRole.PLANNING_MANAGER]: SignatureRole.PLANNING_MANAGER,
    [UserRole.PRESIDENT]: SignatureRole.LINDSEY,
    [UserRole.ACCOUNTING_ASSOCIATE]: SignatureRole.COORDINATOR,
    [UserRole.ACCOUNTING_SUPERVISOR]: SignatureRole.COORDINATOR,
    [UserRole.CFO]: SignatureRole.LINDSEY,
    [UserRole.IT_ADMIN]: SignatureRole.COORDINATOR,
    [UserRole.ADMIN]: SignatureRole.COORDINATOR,
    [UserRole.LINDSEY]: SignatureRole.LINDSEY,
    [UserRole.POLLY]: SignatureRole.COORDINATOR,
  };

  return mapping[userRole] || null;
}
