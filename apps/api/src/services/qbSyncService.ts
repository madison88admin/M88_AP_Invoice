import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

export interface SyncStatus {
  invoice_id: string;
  invoice_number: string;
  qb_invoice_id: string | null;
  sync_status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING';
  sync_error?: string;
  last_sync_attempt?: Date;
  retry_count: number;
}

/**
 * Get all invoices with their QuickBooks sync status
 */
export async function getQBSyncStatus(): Promise<SyncStatus[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: {
        in: [InvoiceStatus.POSTED, InvoiceStatus.PAYMENT_INITIATED, InvoiceStatus.PAID],
      },
    },
    include: {
      vendor: true,
    },
    orderBy: {
      updated_at: 'desc',
    },
  });

  return invoices.map((invoice: any) => ({
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    qb_invoice_id: invoice.qb_invoice_id || null,
    sync_status: invoice.qb_invoice_id ? 'SUCCESS' : 'PENDING',
    sync_error: undefined,
    last_sync_attempt: invoice.updated_at,
    retry_count: 0,
  }));
}

/**
 * Get invoices that failed to sync with QuickBooks
 */
export async function getFailedSyncs(): Promise<SyncStatus[]> {
  // In a real implementation, this would query a sync_errors table
  // For now, we'll return invoices that are POSTED but don't have a QB invoice ID
  const invoices = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.POSTED,
      qb_invoice_id: null,
    },
    include: {
      vendor: true,
    },
    orderBy: {
      updated_at: 'desc',
    },
  });

  return invoices.map((invoice: any) => ({
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    qb_invoice_id: null,
    sync_status: 'FAILED',
    sync_error: 'No QuickBooks invoice ID assigned',
    last_sync_attempt: invoice.updated_at,
    retry_count: 0,
  }));
}

/**
 * Retry syncing an invoice to QuickBooks
 */
export async function retrySync(invoiceId: string, userId: string): Promise<SyncStatus> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.POSTED) {
    throw new Error('Invoice must be posted before syncing to QuickBooks');
  }

  // Simulate retry sync
  const qbInvoiceId = `QB-RETRY-${Date.now()}-${invoice.invoice_number}`;

  // Update invoice with QB invoice ID
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      qb_invoice_id: qbInvoiceId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'QB_SYNC_RETRY',
      user_id: userId,
      metadata: {
        message: `QuickBooks sync retry successful. QB Invoice ID: ${qbInvoiceId}`,
        qb_invoice_id: qbInvoiceId,
      },
    },
  });

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    qb_invoice_id: qbInvoiceId,
    sync_status: 'SUCCESS',
    sync_error: undefined,
    last_sync_attempt: new Date(),
    retry_count: 1,
  };
}

/**
 * Get sync statistics
 */
export async function getSyncStatistics() {
  const totalPosted = await prisma.invoice.count({
    where: {
      status: {
        in: [InvoiceStatus.POSTED, InvoiceStatus.PAYMENT_INITIATED, InvoiceStatus.PAID],
      },
    },
  });

  const synced = await prisma.invoice.count({
    where: {
      status: {
        in: [InvoiceStatus.POSTED, InvoiceStatus.PAYMENT_INITIATED, InvoiceStatus.PAID],
      },
      qb_invoice_id: { not: null },
    },
  });

  const failed = await prisma.invoice.count({
    where: {
      status: InvoiceStatus.POSTED,
      qb_invoice_id: null,
    },
  });

  return {
    total_posted: totalPosted,
    synced,
    failed,
    sync_rate: totalPosted > 0 ? (synced / totalPosted) * 100 : 0,
  };
}

/**
 * Force sync an invoice to QuickBooks
 */
export async function forceSync(invoiceId: string, userId: string): Promise<SyncStatus> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Simulate force sync
  const qbInvoiceId = `QB-FORCE-${Date.now()}-${invoice.invoice_number}`;

  // Update invoice with QB invoice ID
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      qb_invoice_id: qbInvoiceId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'QB_FORCE_SYNC',
      user_id: userId,
      metadata: {
        message: `QuickBooks force sync successful. QB Invoice ID: ${qbInvoiceId}`,
        qb_invoice_id: qbInvoiceId,
      },
    },
  });

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    qb_invoice_id: qbInvoiceId,
    sync_status: 'SUCCESS',
    sync_error: undefined,
    last_sync_attempt: new Date(),
    retry_count: 0,
  };
}
