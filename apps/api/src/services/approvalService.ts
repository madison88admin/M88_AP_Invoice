import prisma from '../config/database';
import { InvoiceStatus, SignatureRole, UserRole } from '@ap-invoice/shared';

// Approval routing thresholds
const APPROVAL_THRESHOLDS = {
  PURCHASING_MANAGER: 5000,
  PRESIDENT: 500000,
};

interface ApprovalRoute {
  role: SignatureRole;
  amount_threshold: number;
}

export async function determineApprovalRoute(amount: number): Promise<SignatureRole[]> {
  const route: SignatureRole[] = [];

  if (amount < APPROVAL_THRESHOLDS.PURCHASING_MANAGER) {
    route.push(SignatureRole.MANAGER);
  } else if (amount < APPROVAL_THRESHOLDS.PRESIDENT) {
    route.push(SignatureRole.PLANNING_MANAGER);
  } else {
    route.push(SignatureRole.LINDSEY);
  }

  // All approvals require accounting supervisor endorsement
  route.push(SignatureRole.COORDINATOR);

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
  const approvalRoute = await determineApprovalRoute(Number(invoice.amount));

  // Create approval records for each role in the route
  const approvals = await Promise.all(
    approvalRoute.map((role, index) =>
      prisma.signature.create({
        data: {
          invoice_id: invoiceId,
          role,
          signer_name: null,
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
      detail: `Approval requested for invoice ${invoice.invoice_number}. Route: ${approvalRoute.join(' → ')}`,
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
    (sig) => sig.role === signatureRole && sig.status === 'PENDING'
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
      detail: `Invoice approved by ${signerName} (${signatureRole})`,
    },
  });

  // Check if there are more approvals needed
  const nextSignature = invoice.signatures.find(
    (sig) => sig.order === pendingSignature.order + 1
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
        detail: `Invoice ${invoice.invoice_number} fully approved and ready for posting`,
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
    (sig) => sig.role === signatureRole && sig.status === 'PENDING'
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
      detail: `Invoice rejected by ${signatureRole}. Reason: ${reason}`,
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
