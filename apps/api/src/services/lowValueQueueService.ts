import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

const LOW_VALUE_THRESHOLD = 100;

export interface LowValueInvoice {
  id: string;
  invoice_number: string;
  vendor_name: string;
  amount: number;
  currency: string;
  invoice_date: Date;
  status: InvoiceStatus;
}

/**
 * Check if an invoice qualifies for the low-value confirmation queue
 * Invoices below $100 that have passed validation are eligible
 */
export function isLowValueInvoice(amount: number, status: InvoiceStatus): boolean {
  return amount < LOW_VALUE_THRESHOLD && status === InvoiceStatus.VALIDATED;
}

/**
 * Get all invoices in the low-value confirmation queue
 * These are invoices below $100 that are awaiting confirmation
 */
export async function getLowValueQueue(): Promise<LowValueInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      amount: {
        lt: LOW_VALUE_THRESHOLD,
      },
      status: InvoiceStatus.VALIDATED,
    },
    include: {
      vendor: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      invoice_date: 'asc',
    },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_name: invoice.vendor?.name || 'Unknown',
    amount: Number(invoice.amount),
    currency: invoice.currency,
    invoice_date: invoice.invoice_date,
    status: invoice.status as InvoiceStatus,
  }));
}

/**
 * Confirm a low-value invoice
 * This bypasses the full approval workflow and routes directly to payment scheduling
 */
export async function confirmLowValueInvoice(
  invoiceId: string,
  userId: string,
  notes?: string
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (!isLowValueInvoice(Number(invoice.amount), invoice.status as InvoiceStatus)) {
    throw new Error('Invoice does not qualify for low-value confirmation');
  }

  // Update invoice status to APPROVED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.APPROVED,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'LOW_VALUE_CONFIRMED',
      user_id: userId,
      metadata: {
        notes: notes || `Low-value invoice confirmed by ${userId}`,
      },
    },
  });
}

/**
 * Reject a low-value invoice
 * Routes the invoice to the exception queue for manual review
 */
export async function rejectLowValueInvoice(
  invoiceId: string,
  userId: string,
  rejectionReason: string
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (!isLowValueInvoice(Number(invoice.amount), invoice.status as InvoiceStatus)) {
    throw new Error('Invoice does not qualify for low-value confirmation');
  }

  // Update invoice status to EXCEPTION
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.EXCEPTION,
    },
  });

  // Create exception record
  await prisma.exception.create({
    data: {
      invoice_id: invoiceId,
      reason: 'LOW_VALUE_REJECTED' as any,
      detail: rejectionReason,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'LOW_VALUE_REJECTED',
      user_id: userId,
      metadata: {
        rejection_reason: rejectionReason,
      },
    },
  });
}

/**
 * Get statistics for the low-value queue
 */
export async function getLowValueQueueStats() {
  const total = await prisma.invoice.count({
    where: {
      amount: {
        lt: LOW_VALUE_THRESHOLD,
      },
      status: InvoiceStatus.VALIDATED,
    },
  });

  const totalAmount = await prisma.invoice.aggregate({
    where: {
      amount: {
        lt: LOW_VALUE_THRESHOLD,
      },
      status: InvoiceStatus.VALIDATED,
    },
    _sum: {
      amount: true,
    },
  });

  return {
    count: total,
    total_amount: Number(totalAmount._sum.amount || 0),
    threshold: LOW_VALUE_THRESHOLD,
  };
}
