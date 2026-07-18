import prisma from '../config/database';
import { logger } from '../utils/logger';
import { InvoiceStatus, UserRole } from '@ap-invoice/shared';

interface CreateNotificationInput {
  invoice_id?: string;
  invoice_number?: string;
  vendor_name?: string;
  title: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  category?: 'stage' | 'exception' | 'approval' | 'upload' | 'payment';
  target_role?: UserRole | null;
}

class InAppNotificationService {
  async create(input: CreateNotificationInput) {
    try {
      const notification = await prisma.notification.create({
        data: {
          invoice_id: input.invoice_id,
          invoice_number: input.invoice_number,
          vendor_name: input.vendor_name,
          title: input.title,
          message: input.message,
          type: input.type || 'info',
          category: input.category || 'stage',
          target_role: input.target_role || null,
        },
      });
      logger.info(`[Notification] Created: ${notification.title} for ${input.target_role || 'all'}`);
      return notification;
    } catch (error) {
      logger.error('[Notification] Failed to create:', error);
    }
  }

  async notifyStageTransition(
    invoiceId: string,
    invoiceNumber: string,
    vendorName: string,
    oldStatus: InvoiceStatus | string,
    newStatus: InvoiceStatus | string,
    nextRole?: UserRole | string
  ) {
    const stageMessages: Record<string, { title: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }> = {
      RECEIVED: { title: 'Invoice Received', message: `Invoice ${invoiceNumber} from ${vendorName} has arrived and is pending validation.`, type: 'info' },
      VALIDATED: { title: 'Invoice Validated', message: `Invoice ${invoiceNumber} passed validation and is ready for approval.`, type: 'success' },
      PENDING_COORDINATOR: { title: 'Awaiting Coordinator', message: `Invoice ${invoiceNumber} requires Purchasing Coordinator approval.`, type: 'info' },
      PENDING_PURCHASING_MGR: { title: 'Awaiting Purchasing Manager', message: `Invoice ${invoiceNumber} requires Purchasing Manager approval.`, type: 'info' },
      PENDING_MLO: { title: 'Awaiting MLO Account Holder', message: `Invoice ${invoiceNumber} requires MLO Account Holder approval.`, type: 'info' },
      PENDING_PLANNING_MGR: { title: 'Awaiting Planning Manager', message: `Invoice ${invoiceNumber} requires Planning Manager approval.`, type: 'info' },
      PENDING_SR_MANAGER: { title: 'Awaiting Sr. Manager', message: `Invoice ${invoiceNumber} requires Sr. Manager Global Production approval.`, type: 'info' },
      PENDING_MS_POLLY: { title: 'Awaiting Ms. Polly', message: `Invoice ${invoiceNumber} requires Ms. Polly's approval.`, type: 'info' },
      PENDING_PRESIDENT: { title: 'Awaiting President', message: `Invoice ${invoiceNumber} requires President's approval.`, type: 'warning' },
      PENDING_ACCOUNTING: { title: 'Awaiting Accounting', message: `Invoice ${invoiceNumber} is ready for accounting review and QuickBooks posting.`, type: 'info' },
      APPROVED: { title: 'Invoice Approved', message: `Invoice ${invoiceNumber} has been fully approved.`, type: 'success' },
      POSTED_TO_QB: { title: 'Posted to QuickBooks', message: `Invoice ${invoiceNumber} has been posted to QuickBooks.`, type: 'success' },
      PAYMENT_SCHEDULED: { title: 'Payment Scheduled', message: `Payment for invoice ${invoiceNumber} has been scheduled.`, type: 'success' },
      PAID: { title: 'Invoice Paid', message: `Invoice ${invoiceNumber} has been paid.`, type: 'success' },
      REJECTED: { title: 'Invoice Rejected', message: `Invoice ${invoiceNumber} has been rejected.`, type: 'error' },
      EXCEPTION: { title: 'Exception Raised', message: `Invoice ${invoiceNumber} has exceptions requiring review.`, type: 'warning' },
    };

    const stageInfo = stageMessages[newStatus] || {
      title: 'Status Updated',
      message: `Invoice ${invoiceNumber} moved from ${oldStatus} to ${newStatus}.`,
      type: 'info' as const,
    };

    // Determine target role based on the new status
    const roleMap: Record<string, UserRole | null> = {
      RECEIVED: UserRole.PURCHASING_COORDINATOR,
      VALIDATED: UserRole.PURCHASING_COORDINATOR,
      PENDING_COORDINATOR: UserRole.PURCHASING_COORDINATOR,
      PENDING_PURCHASING_MGR: UserRole.PURCHASING_MANAGER,
      PENDING_MLO: UserRole.MLO_ACCOUNT_HOLDER,
      PENDING_PLANNING_MGR: UserRole.PLANNING_MANAGER,
      PENDING_SR_MANAGER: UserRole.SR_MANAGER_GLOBAL_PRODUCTION,
      PENDING_MS_POLLY: UserRole.MS_POLLY,
      PENDING_PRESIDENT: UserRole.PRESIDENT,
      PENDING_ACCOUNTING: UserRole.ACCOUNTING_SUPERVISOR,
      APPROVED: UserRole.ACCOUNTING_SUPERVISOR,
      POSTED_TO_QB: UserRole.ACCOUNTING_ASSOCIATE,
      PAYMENT_SCHEDULED: UserRole.ACCOUNTING_SUPERVISOR,
      PAID: null, // everyone
      REJECTED: UserRole.PURCHASING_COORDINATOR,
      EXCEPTION: UserRole.PURCHASING_COORDINATOR,
    };

    const targetRole = nextRole ? (nextRole as UserRole) : (roleMap[newStatus] || null);

    await this.create({
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      vendor_name: vendorName,
      title: stageInfo.title,
      message: stageInfo.message,
      type: stageInfo.type,
      category: 'stage',
      target_role: targetRole,
    });
  }

  async getNotifications(userRole: string, limit: number = 20) {
    await this.ensureActionableAlerts(userRole);
    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          { target_role: null },
          { target_role: userRole },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    return notifications;
  }

  async ensureActionableAlerts(userRole: string) {
    const targetStatuses: Record<string, InvoiceStatus[]> = {
      [UserRole.PURCHASING_COORDINATOR]: [InvoiceStatus.RECEIVED, InvoiceStatus.VALIDATION_PENDING, InvoiceStatus.EXCEPTION_FLAGGED, InvoiceStatus.REJECTED, InvoiceStatus.ON_HOLD],
      [UserRole.PURCHASING_MANAGER]: [InvoiceStatus.PENDING_MANAGER],
      [UserRole.ACCOUNTING_SUPERVISOR]: [InvoiceStatus.PENDING_ACCOUNTING],
      [UserRole.ACCOUNTING_ASSOCIATE]: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED],
      [UserRole.MLO_ACCOUNT_HOLDER]: [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER],
      [UserRole.PLANNING_MANAGER]: [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER],
      [UserRole.SR_MANAGER_GLOBAL_PRODUCTION]: [InvoiceStatus.PENDING_SR_MANAGER],
      [UserRole.MS_POLLY]: [InvoiceStatus.PENDING_POLLY],
    };

    const statuses = targetStatuses[userRole] || [];
    if (statuses.length === 0) return;

    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleInvoices = await prisma.invoice.findMany({
      where: { status: { in: statuses as any[] }, updated_at: { lte: cutoff } },
      include: { vendor: true },
      take: 25,
      orderBy: { updated_at: 'asc' },
    });

    for (const invoice of staleInvoices) {
      const existing = await prisma.notification.findFirst({
        where: {
          invoice_id: invoice.id,
          target_role: userRole,
          category: 'approval',
          title: 'Long-pending invoice',
          created_at: { gte: recentCutoff },
        },
      });
      if (existing) continue;
      await this.create({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        vendor_name: invoice.vendor?.name || invoice.vendor_name_raw || 'Unknown',
        title: 'Long-pending invoice',
        message: `Invoice ${invoice.invoice_number} has been in ${invoice.status} since ${invoice.updated_at.toISOString().split('T')[0]}.`,
        type: 'warning',
        category: 'approval',
        target_role: userRole as UserRole,
      });
    }
  }

  async getUnreadCount(userRole: string): Promise<number> {
    const count = await prisma.notification.count({
      where: {
        is_read: false,
        OR: [
          { target_role: null },
          { target_role: userRole },
        ],
      },
    });
    return count;
  }

  async markAsRead(notificationId: string) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { is_read: true, read_at: new Date() },
    });
  }

  async markAllAsRead(userRole: string) {
    return prisma.notification.updateMany({
      where: {
        is_read: false,
        OR: [
          { target_role: null },
          { target_role: userRole },
        ],
      },
      data: { is_read: true, read_at: new Date() },
    });
  }
}

export const inAppNotificationService = new InAppNotificationService();
