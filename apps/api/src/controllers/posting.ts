import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  postInvoice,
  schedulePayment,
  processPayment,
  getScheduledPayments,
  releaseFromHold,
} from '../services/postingService';
import { logAudit } from '../services/auditLogService';
import { sendPaymentConfirmationToSupplier } from '../services/notificationService';
import { InvoiceStatus } from '@ap-invoice/shared';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export const postInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { bypassVarianceCheck } = req.body || {};
    
    // Only ACCOUNTING_SUPERVISOR can bypass variance check
    const canBypass = req.user!.role === 'ACCOUNTING_SUPERVISOR' && bypassVarianceCheck === true;
    
    const result = await postInvoice(id, req.user!.id, canBypass);
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'INVOICE_POSTED',
      note: `Invoice posted to accounting by ${req.user!.role}${canBypass ? ' (variance check bypassed)' : ''}`,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const schedulePaymentController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { paymentDate } = req.body;
    const result = await schedulePayment(id, new Date(paymentDate), req.user!.id);
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'PAYMENT_SCHEDULED',
      note: `Payment scheduled for ${paymentDate} by ${req.user!.role}`,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const processPaymentController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentId } = req.params;
    const result = await processPayment(paymentId, req.user!.id);
    await logAudit({
      performed_by: req.user!.id,
      action: 'PAYMENT_PROCESSED',
      note: `Payment ${paymentId} processed by ${req.user!.role}`,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getScheduledPaymentsController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const payments = await getScheduledPayments();
    res.json(payments);
  } catch (error) {
    next(error);
  }
};

export const releaseFromHoldController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const result = await releaseFromHold(id, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const sendPaymentConfirmationController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    // Permission check — only ACCOUNTING_ASSOCIATE and ACCOUNTING_SUPERVISOR
    if (req.user!.role !== 'ACCOUNTING_ASSOCIATE' && req.user!.role !== 'ACCOUNTING_SUPERVISOR') {
      throw new AppError('Only Accounting Associate or Supervisor can send payment confirmations', 403);
    }

    // 1. Fetch invoice — must be PAID
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { vendor: true, payments: true },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    if (invoice.status !== InvoiceStatus.PAID) {
      throw new AppError('Invoice must be PAID before sending payment confirmation', 400);
    }

    // 2. Check vendor email
    if (!invoice.vendor?.contact_email) {
      throw new AppError('Vendor email not found — add vendor email before sending', 400);
    }

    // 3. Find the linked payment record
    const payment = invoice.payments.find(p => p.status === 'PAID' && p.reference);
    if (!payment) {
      throw new AppError('No paid payment record found with a reference number', 400);
    }

    // 4. Send email
    try {
      await sendPaymentConfirmationToSupplier(
        invoice.id,
        invoice.invoice_number,
        invoice.vendor.name,
        invoice.vendor.contact_email,
        Number(payment.amount),
        payment.currency || invoice.currency || 'USD',
        payment.reference!,
        payment.paid_at || new Date()
      );
    } catch (emailError) {
      logger.error('Failed to send payment confirmation email:', emailError);
      throw new AppError('Failed to send payment confirmation email — please try again', 500);
    }

    // 5. Update invoice status + timestamp
    const sentAt = new Date();
    await prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAYMENT_CONFIRMATION_SENT as any,
        confirmation_sent_at: sentAt,
      },
    });

    // 6. Audit log
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'PAYMENT_CONFIRMATION_SENT',
      note: `Payment confirmation sent by ${req.user!.role} to ${invoice.vendor.contact_email}, CC: PURCHASINGTEAM@madison88.com. Reference: ${payment.reference}, Amount: ${payment.currency || 'USD'} ${Number(payment.amount).toFixed(2)}`,
    });

    logger.info(`Payment confirmation sent for invoice ${invoice.invoice_number} to ${invoice.vendor.contact_email}`);

    res.json({
      success: true,
      sent_to: invoice.vendor.contact_email,
      cc: 'PURCHASINGTEAM@madison88.com',
      sent_at: sentAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
};
