import prisma from '../config/database';
import { InvoiceStatus, InvoiceType } from '@ap-invoice/shared';
import { logger } from '../utils/logger';

export interface PIFollowUpItem {
  invoice_id: string;
  invoice_number: string;
  vendor_id: string;
  vendor_name: string;
  amount: number;
  currency: string;
  invoice_date: Date;
  pi_status: 'PENDING_CI' | 'CI_RECEIVED' | 'CI_APPROVED' | 'CI_REJECTED';
  follow_up_count: number;
  last_follow_up_date?: Date;
  next_follow_up_date?: Date;
}

/**
 * Get all Proforma Invoices that have been paid but are missing CI/SI
 */
export async function getPaidPIMissingCI(): Promise<PIFollowUpItem[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      invoice_type: InvoiceType.PROFORMA,
      status: InvoiceStatus.PAID,
    },
    include: {
      vendor: true,
      follow_up_tasks: {
        where: {
          task_type: 'REQUEST_CI',
          status: 'PENDING',
        },
      },
    },
    orderBy: {
      invoice_date: 'asc',
    },
  });

  return invoices.map((invoice: any) => ({
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_id: invoice.vendor_id,
    vendor_name: invoice.vendor?.name || 'Unknown',
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    invoice_date: invoice.invoice_date || new Date(),
    pi_status: 'PENDING_CI',
    follow_up_count: invoice.follow_up_tasks?.[0]?.reminder_count || 0,
    last_follow_up_date: invoice.follow_up_tasks?.[0]?.last_reminded_at,
    next_follow_up_date: invoice.follow_up_tasks?.[0]?.due_date,
  }));
}

/**
 * Get all invoices in PI_PENDING_CI status
 */
export async function getPIPendingInvoices(): Promise<PIFollowUpItem[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.VALIDATION_PENDING,
    },
    include: {
      vendor: true,
    },
    orderBy: {
      invoice_date: 'asc',
    },
  });

  return invoices.map((invoice: any) => ({
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_id: invoice.vendor_id,
    vendor_name: invoice.vendor?.name || 'Unknown',
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    invoice_date: invoice.invoice_date || new Date(),
    pi_status: 'PENDING_CI',
    follow_up_count: 0,
    last_follow_up_date: undefined,
    next_follow_up_date: undefined,
  }));
}

/**
 * Auto-create follow-up task when Proforma Invoice is paid
 */
export async function autoCreateCIFollowUpTask(invoiceId: string, paidAt: Date): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.invoice_type !== InvoiceType.PROFORMA) {
    logger.info(`Invoice ${invoice.invoice_number} is not a Proforma Invoice, skipping CI follow-up task creation`);
    return;
  }

  // Check if task already exists
  const existingTask = await prisma.followUpTask.findFirst({
    where: {
      invoice_id: invoiceId,
      task_type: 'REQUEST_CI',
      status: 'PENDING',
    },
  });

  if (existingTask) {
    logger.info(`CI follow-up task already exists for invoice ${invoice.invoice_number}`);
    return;
  }

  // Create follow-up task
  const dueDate = new Date(paidAt.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days from payment

  await prisma.followUpTask.create({
    data: {
      invoice_id: invoiceId,
      task_type: 'REQUEST_CI',
      assigned_to: process.env.COORDINATOR_EMAIL || 'coordinator@madison88.com',
      due_date: dueDate,
      status: 'PENDING',
      reminder_count: 0,
      notes: `Request Commercial/Sales Invoice from vendor ${invoice.vendor?.name} for PI ${invoice.invoice_number}, paid on ${paidAt.toISOString()}`,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'CI_FOLLOW_UP_TASK_CREATED',
      performed_by: 'system',
      note: `Auto-created CI follow-up task for PI ${invoice.invoice_number}, due ${dueDate.toISOString()}`,
    },
  });

  logger.info(`Auto-created CI follow-up task for PI ${invoice.invoice_number}, due ${dueDate.toISOString()}`);
}

/**
 * Send follow-up notification to vendor for CI
 */
export async function sendCIFollowUp(invoiceId: string, userId: string): Promise<PIFollowUpItem> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.VALIDATION_PENDING) {
    throw new Error('Invoice must be in PI_PENDING_CI status to send CI follow-up');
  }

  // Create audit log entry for follow-up
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'CI_FOLLOW_UP_SENT',
      performed_by: userId,
      note: `CI follow-up sent to vendor ${invoice.vendor?.name} for invoice ${invoice.invoice_number}`,
    },
  });

  // In production, this would send an email to the vendor
  // For now, we'll just log it

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_id: invoice.vendor_id || '',
    vendor_name: invoice.vendor?.name || 'Unknown',
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    invoice_date: invoice.invoice_date || new Date(),
    pi_status: 'PENDING_CI',
    follow_up_count: 1,
    last_follow_up_date: new Date(),
    next_follow_up_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  };
}

/**
 * Record CI received from vendor
 */
export async function recordCIReceived(
  invoiceId: string,
  ciFileUrl: string,
  userId: string
): Promise<PIFollowUpItem> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.VALIDATION_PENDING) {
    throw new Error('Invoice must be in PI_PENDING_CI status to record CI');
  }

  // Update invoice status to indicate CI received
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.APPROVED, // Move to approved after CI received
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'CI_RECEIVED',
      performed_by: userId,
      note: `Commercial Invoice received from vendor ${invoice.vendor?.name} for invoice ${invoice.invoice_number}`,
    },
  });

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_id: invoice.vendor_id || '',
    vendor_name: invoice.vendor?.name || 'Unknown',
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    invoice_date: invoice.invoice_date || new Date(),
    pi_status: 'CI_RECEIVED',
    follow_up_count: 0,
    last_follow_up_date: undefined,
    next_follow_up_date: undefined,
  };
}

/**
 * Get PI follow-up statistics
 */
export async function getPIFollowUpStatistics() {
  const pendingCI = await prisma.invoice.count({
    where: {
      status: InvoiceStatus.VALIDATION_PENDING,
    },
  });

  const ciReceived = await prisma.invoice.count({
    where: {
      status: InvoiceStatus.APPROVED,
    },
  });

  const totalAmountPending = await prisma.invoice.aggregate({
    where: {
      status: InvoiceStatus.VALIDATION_PENDING,
    },
    _sum: {
      total_amount: true,
    },
  });

  return {
    pending_ci: pendingCI,
    ci_received: ciReceived,
    total_amount_pending: totalAmountPending._sum.total_amount || 0,
  };
}

/**
 * Get invoices that need follow-up (based on follow-up schedule)
 */
export async function getInvoicesNeedingFollowUp(): Promise<PIFollowUpItem[]> {
  const pendingInvoices = await getPIPendingInvoices();

  // In production, this would check the last follow-up date and calculate if a follow-up is due
  // For now, we'll return all pending invoices
  return pendingInvoices;
}

/**
 * Auto-send follow-ups for invoices that are due
 */
export async function autoSendFollowUps(userId: string): Promise<{ sent: number; errors: number }> {
  const invoicesNeedingFollowUp = await getInvoicesNeedingFollowUp();
  let sent = 0;
  let errors = 0;

  for (const invoice of invoicesNeedingFollowUp) {
    try {
      await sendCIFollowUp(invoice.invoice_id, userId);
      sent++;
    } catch (error) {
      console.error(`Failed to send follow-up for invoice ${invoice.invoice_number}:`, error);
      errors++;
    }
  }

  return { sent, errors };
}

/**
 * Mark invoice as requiring CI (transition to PI_PENDING_CI)
 */
export async function markAsPendingCI(invoiceId: string, userId: string, reason: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Update invoice status to PI_PENDING_CI
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.VALIDATION_PENDING,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'MARKED_PENDING_CI',
      performed_by: userId,
      note: `Invoice ${invoice.invoice_number} marked as pending CI. Reason: ${reason}`,
    },
  });

  return { message: 'Invoice marked as pending CI' };
}
