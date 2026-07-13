import { Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
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

    // Permission check — only ACCOUNTING_SUPERVISOR
    if (req.user!.role !== 'ACCOUNTING_SUPERVISOR') {
      throw new AppError('Only Accounting Supervisor can send payment confirmations', 403);
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

    // 2. Find the linked payment record
    const payment = invoice.payments.find(p => p.status === 'PAID' && p.reference);
    if (!payment) {
      throw new AppError('No paid payment record found with a reference number', 400);
    }

    // 3. Send email if vendor has contact email, otherwise skip
    const vendorEmail = invoice.vendor?.contact_email;
    let emailSent = false;
    if (vendorEmail) {
      try {
        await sendPaymentConfirmationToSupplier(
          invoice.id,
          invoice.invoice_number,
          invoice.vendor.name,
          vendorEmail,
          Number(payment.amount),
          payment.currency || invoice.currency || 'USD',
          payment.reference!,
          payment.paid_at || new Date()
        );
        emailSent = true;
      } catch (emailError) {
        logger.error('Failed to send payment confirmation email:', emailError);
        throw new AppError('Failed to send payment confirmation email — please try again', 500);
      }
    } else {
      logger.info(`No vendor contact email for invoice ${invoice.invoice_number} — marking confirmation as sent without email`);
    }

    // 4. Update invoice status + timestamp
    const sentAt = new Date();
    await prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAYMENT_CONFIRMATION_SENT as any,
        confirmation_sent_at: sentAt,
      },
    });

    // 4b. Create PaymentConfirmation record for tracking
    const confirmationId = randomUUID();
    await prisma.$executeRaw`INSERT INTO "APInvoice_PaymentConfirmation" (id, invoice_id, payment_id, vendor_name, vendor_email, amount, currency, payment_reference, email_sent, cc_email, sent_by, sent_at, created_at) VALUES (${confirmationId}, ${id}, ${payment.id}, ${invoice.vendor?.name || 'Unknown'}, ${vendorEmail || null}, ${Number(payment.amount)}::numeric, ${payment.currency || invoice.currency || 'USD'}, ${payment.reference}, ${emailSent}, ${emailSent ? 'PURCHASINGTEAM@madison88.com' : null}, ${req.user!.id}, ${sentAt}, ${sentAt})`;

    // 5. Audit log
    const auditNote = vendorEmail
      ? `Payment confirmation sent by ${req.user!.role} to ${vendorEmail}, CC: PURCHASINGTEAM@madison88.com. Reference: ${payment.reference}, Amount: ${payment.currency || 'USD'} ${Number(payment.amount).toFixed(2)}`
      : `Payment confirmation marked as sent by ${req.user!.role} (no vendor email on file). Reference: ${payment.reference}, Amount: ${payment.currency || 'USD'} ${Number(payment.amount).toFixed(2)}`;
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'PAYMENT_CONFIRMATION_SENT',
      note: auditNote,
    });

    logger.info(`Payment confirmation ${emailSent ? 'sent' : 'marked'} for invoice ${invoice.invoice_number}${vendorEmail ? ' to ' + vendorEmail : ' (no email)'}`);

    res.json({
      success: true,
      sent_to: vendorEmail || null,
      cc: vendorEmail ? 'PURCHASINGTEAM@madison88.com' : null,
      sent_at: sentAt.toISOString(),
      email_sent: emailSent,
    });
  } catch (error) {
    next(error);
  }
};
