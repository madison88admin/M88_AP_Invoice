import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';

// QuickBooks Online API configuration
const QB_CLIENT_ID = process.env.QB_CLIENT_ID || '';
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET || '';
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI || '';
const QB_ENVIRONMENT = process.env.QB_ENVIRONMENT || 'sandbox';

export async function postInvoice(invoiceId: string, userId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== InvoiceStatus.APPROVED as any) {
    throw new AppError('Invoice must be approved before posting', 400);
  }

  // Check if all signatures are signed
  const allSigned = invoice.signatures.every((sig: any) => sig.signed_at !== null);
  if (!allSigned) {
    throw new AppError('All approvals must be completed before posting', 400);
  }

  // Check for any unresolved exceptions
  const unresolvedExceptions = invoice.exceptions.filter(
    (exc: any) => exc.status === 'PENDING'
  );
  if (unresolvedExceptions.length > 0) {
    throw new AppError('Invoice has unresolved exceptions and cannot be posted', 400);
  }

  // Post to QuickBooks Online
  const postingResult = await postToQuickBooks(invoice);

  // Update invoice status to POSTED_TO_QB
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.POSTED_TO_QB as any,
      qb_posted_at: new Date(),
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'POSTED',
      performed_by: userId,
      note: `Invoice ${invoice.invoice_number} posted to QuickBooks. QB Invoice ID: ${postingResult.qbInvoiceId}`,
    },
  });

  // Auto-schedule payment after QB posting
  try {
    const paymentDate = invoice.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // due_date or +30 days
    const payment = await schedulePayment(invoiceId, paymentDate, userId);
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'AUTO_PAYMENT_SCHEDULED',
        performed_by: 'system',
        note: `Payment auto-scheduled after QB posting for ${invoice.currency} ${Number(invoice.total_amount).toFixed(2)} on ${paymentDate.toISOString().split('T')[0]}`,
      },
    });
    return { ...postingResult, payment_scheduled: true, payment_id: payment.id, payment_date: paymentDate };
  } catch (scheduleError) {
    // Log but don't fail the posting
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId,
        action: 'AUTO_PAYMENT_SCHEDULE_FAILED',
        performed_by: 'system',
        note: `Auto-schedule payment failed after QB posting: ${scheduleError instanceof Error ? scheduleError.message : 'unknown error'}`,
      },
    });
    return { ...postingResult, payment_scheduled: false };
  }
}

async function postToQuickBooks(invoice: any) {
  // In production, this would use the QuickBooks Online API
  // For now, we'll simulate the posting process with QB-specific fields
  const qbInvoiceId = `QB-${Date.now()}-${invoice.invoice_number}`;

  // Generate QB memo: brand_season_ordertype_MPO_approvaldate
  const memoParts = [
    invoice.brand_code || invoice.brand || '',
    invoice.season || '',
    invoice.order_type || '',
    invoice.mpo_number || '',
    new Date().toISOString().split('T')[0],
  ].filter(Boolean);
  const qbMemo = invoice.qb_memo || memoParts.join('_');

  // Map invoice data to QuickBooks format
  const qbInvoice = {
    InvoiceNum: invoice.invoice_number,
    VendorRef: {
      value: invoice.vendor_id,
      name: invoice.vendor?.name,
    },
    TxnDate: invoice.invoice_date ? invoice.invoice_date.toISOString().split('T')[0] : null,
    DueDate: invoice.due_date ? invoice.due_date.toISOString().split('T')[0] : null,
    Line: [
      {
        Amount: Number(invoice.total_amount),
        Description: qbMemo || `Invoice ${invoice.invoice_number}`,
        AccountRef: {
          value: determineGLAccount(invoice),
        },
      },
    ],
    PrivateNote: qbMemo || '',
    CurrencyRef: {
      value: invoice.currency === 'USD' ? 'USD' : invoice.currency,
    },
    ClassRef: invoice.vendor?.supplier_location ? {
      value: invoice.vendor.supplier_location,
    } : undefined,
  };

  // TODO: Implement actual QuickBooks Online API call here
  // const qbResponse = await quickbooksClient.createInvoice(qbInvoice);

  return {
    success: true,
    qbInvoiceId,
    posted_at: new Date(),
    gl_account: determineGLAccount(invoice),
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    vendor_id: invoice.vendor_id,
    qb_memo: qbMemo,
  };
}

function determineGLAccount(invoice: any) {
  // Determine the appropriate GL account based on invoice type / category
  const invoiceType = invoice.invoice_type;
  
  const glAccounts: Record<string, string> = {
    'INVOICE': '6000-Operational Expenses',
    'PROFORMA': '6000-Operational Expenses',
    'COMMERCIAL': '6000-Operational Expenses',
    'SALES': '6200-Service Expenses',
    'STATEMENT': '6900-Miscellaneous Expenses',
    'PREPAID': '1000-Capital Assets',
    'PROTO_SAMPLE': '6100-Maintenance Expenses',
  };

  return glAccounts[invoiceType] || '6900-Miscellaneous Expenses';
}

export async function schedulePayment(
  invoiceId: string,
  paymentDate: Date,
  userId: string
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status !== InvoiceStatus.POSTED_TO_QB as any) {
    throw new AppError('Invoice must be posted before scheduling payment', 400);
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoiceId,
      amount: Number(invoice.total_amount),
      currency: invoice.currency,
      payment_date: paymentDate,
      status: 'SCHEDULED',
      vendor_id: invoice.vendor_id || undefined,
    },
  });

  // Update invoice status to PAYMENT_SCHEDULED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.PAYMENT_SCHEDULED as any },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'PAYMENT_SCHEDULED',
      performed_by: userId,
      note: `Payment of ${invoice.currency} ${Number(invoice.total_amount).toFixed(2)} scheduled for ${paymentDate.toISOString().split('T')[0]}`,
    },
  });

  return payment;
}

export async function processPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: true },
  });

  if (!payment) {
    throw new AppError('Payment not found', 404);
  }

  if (payment.status !== 'SCHEDULED') {
    throw new AppError('Payment must be scheduled to be processed', 400);
  }

  // Simulate payment processing
  const paymentResult = await simulatePaymentProcessing(payment);

  // Update payment status
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'PAID',
      paid_at: new Date(),
      reference: paymentResult.reference,
    },
  });

  // Update invoice status to PAID
  await prisma.invoice.update({
    where: { id: payment.invoice_id },
    data: { status: InvoiceStatus.PAID as any },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'PAYMENT_PROCESSED',
      performed_by: userId,
      note: `Payment processed successfully. Reference: ${paymentResult.reference}`,
    },
  });

  return paymentResult;
}

async function simulatePaymentProcessing(payment: any) {
  const reference = `PAY-${Date.now()}-${payment.id}`;
  
  return {
    success: true,
    reference,
    processed_at: new Date(),
    amount: payment.amount,
    currency: payment.currency,
    vendor_id: payment.vendor_id,
  };
}

export async function getScheduledPayments() {
  const scheduledPayments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
      payment_date: {
        gte: new Date(),
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
      payment_date: 'asc',
    },
  });

  return scheduledPayments;
}
