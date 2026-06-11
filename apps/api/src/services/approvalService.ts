import prisma from '../config/database';
import { InvoiceStatus, SignatureRole, UserRole } from '@ap-invoice/shared';

// Approval routing thresholds according to BRD
const APPROVAL_THRESHOLDS = {
  TIER_2: 5000,   // Purchasing Manager threshold
  TIER_3: 25000,  // Planning Manager + Lindsey threshold
};

interface ApprovalRoute {
  role: SignatureRole;
  amount_threshold: number;
}

export function determineApprovalRoute(amount: number): SignatureRole[] {
  const route: SignatureRole[] = [];

  // Tier 1: Purchasing Coordinator only (amount < $5,000)
  if (amount < APPROVAL_THRESHOLDS.TIER_2) {
    route.push(SignatureRole.COORDINATOR);
  }
  // Tier 2: Purchasing Coordinator + Purchasing Manager ($5,000 <= amount < $25,000)
  else if (amount < APPROVAL_THRESHOLDS.TIER_3) {
    route.push(SignatureRole.COORDINATOR);
    route.push(SignatureRole.MANAGER);
  }
  // Tier 3: Purchasing Coordinator + Purchasing Manager + Planning Manager + Lindsey (amount >= $25,000)
  else {
    route.push(SignatureRole.COORDINATOR);
    route.push(SignatureRole.MANAGER);
    route.push(SignatureRole.PLANNING_MANAGER);
    route.push(SignatureRole.LINDSEY);
  }

  return route;
}

export async function createApprovalRequest(invoiceId: string, userId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.VALIDATED) {
    throw new Error('Invoice must be validated before requesting approval');
  }

  // Determine approval route
  const approvalRoute = determineApprovalRoute(Number(invoice.amount));

  // Create approval records for each role in the route
  const approvals = await Promise.all(
    approvalRoute.map((role, index) =>
      prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          role,
          signer_name: '',
          signed_at: null,
          status: index === 0 ? 'PENDING' : 'WAITING',
          order: index + 1,
        },
      })
    )
  );

  // Update invoice status to PENDING_APPROVAL
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.PENDING_APPROVAL },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'APPROVAL_REQUESTED',
      user_id: userId,
      metadata: {
        message: `Approval requested for invoice ${invoice.invoice_number}. Route: ${approvalRoute.join(' → ')}`,
      },
    },
  });

  return approvals;
}

export async function approveInvoice(
  invoiceId: string,
  userId: string,
  userRole: UserRole,
  signerName: string
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      signatures: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
    throw new Error('Invoice is not pending approval');
  }

  // Map user role to signature role
  const signatureRole = mapUserRoleToSignatureRole(userRole);
  if (!signatureRole) {
    throw new Error('User does not have approval authority');
  }

  // Find the pending signature for this role
  const pendingSignature = invoice.signatures.find(
    (sig: any) => sig.role === signatureRole && sig.status === 'PENDING'
  );

  if (!pendingSignature) {
    throw new Error('No pending approval found for this role');
  }

  // Update the signature
  await prisma.signature.update({
    where: { id: pendingSignature.id },
    data: {
      signer_name: signerName,
      signed_at: new Date(),
      status: 'APPROVED',
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'APPROVED',
      user_id: userId,
      metadata: {
        message: `Invoice approved by ${signerName} (${signatureRole})`,
      },
    },
  });

  // Check if there are more approvals needed
  const nextSignature = invoice.signatures.find(
    (sig: any) => sig.order === pendingSignature.order + 1
  );

  if (nextSignature) {
    // Activate the next signature
    await prisma.signature.update({
      where: { id: nextSignature.id },
      data: { status: 'PENDING' },
    });
  } else {
    // All approvals complete - update invoice status to APPROVED
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.APPROVED },
    });

    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'FULLY_APPROVED',
        user_id: userId,
        metadata: {
        message: `Invoice ${invoice.invoice_number} fully approved and ready for posting`,
      },
      },
    });
  }

  return { message: 'Invoice approved successfully' };
}

export async function rejectInvoice(
  invoiceId: string,
  userId: string,
  userRole: UserRole,
  reason: string
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      signatures: {
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.PENDING_APPROVAL) {
    throw new Error('Invoice is not pending approval');
  }

  // Map user role to signature role
  const signatureRole = mapUserRoleToSignatureRole(userRole);
  if (!signatureRole) {
    throw new Error('User does not have approval authority');
  }

  // Find the pending signature for this role
  const pendingSignature = invoice.signatures.find(
    (sig: any) => sig.role === signatureRole && sig.status === 'PENDING'
  );

  if (!pendingSignature) {
    throw new Error('No pending approval found for this role');
  }

  // Update the signature to rejected
  await prisma.signature.update({
    where: { id: pendingSignature.id },
    data: {
      status: 'REJECTED',
    },
  });

  // Update invoice status to REJECTED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.REJECTED },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'REJECTED',
      user_id: userId,
      metadata: {
        message: `Invoice rejected by ${signatureRole}. Reason: ${reason}`,
      },
    },
  });

  return { message: 'Invoice rejected successfully' };
}

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

export async function getPendingApprovals(userRole: UserRole) {
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
