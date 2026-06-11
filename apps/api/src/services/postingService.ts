import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

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
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.APPROVED) {
    throw new Error('Invoice must be approved before posting');
  }

  // Check if all signatures are approved
  const allApproved = invoice.signatures.every((sig: any) => sig.status === 'APPROVED');
  if (!allApproved) {
    throw new Error('All approvals must be completed before posting');
  }

  // Check for any unresolved exceptions
  const hasExceptions = invoice.exceptions.length > 0;
  if (hasExceptions) {
    throw new Error('Invoice has unresolved exceptions and cannot be posted');
  }

  // Post to QuickBooks Online
  const postingResult = await postToQuickBooks(invoice);

  // Update invoice status to POSTED and store QB invoice ID
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.POSTED,
      posted_at: new Date(),
      qb_invoice_id: postingResult.qbInvoiceId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'POSTED',
      user_id: userId,
      metadata: {
        message: `Invoice ${invoice.invoice_number} posted to QuickBooks. QB Invoice ID: ${postingResult.qbInvoiceId}`,
        qb_invoice_id: postingResult.qbInvoiceId,
      },
    },
  });

  return postingResult;
}

async function postToQuickBooks(invoice: any) {
  // In production, this would use the QuickBooks Online API
  // For now, we'll simulate the posting process with QB-specific fields
  const qbInvoiceId = `QB-${Date.now()}-${invoice.invoice_number}`;

  // Map invoice data to QuickBooks format
  const qbInvoice = {
    InvoiceNum: invoice.invoice_number,
    VendorRef: {
      value: invoice.vendor_id,
      name: invoice.vendor?.name,
    },
    TxnDate: invoice.invoice_date.toISOString().split('T')[0],
    DueDate: invoice.invoice_due_date ? invoice.invoice_due_date.toISOString().split('T')[0] : null,
    Line: [
      {
        Amount: Number(invoice.amount),
        Description: invoice.qb_memo || `Invoice ${invoice.invoice_number}`,
        AccountRef: {
          value: determineGLAccount(invoice),
        },
      },
    ],
    PrivateNote: invoice.qb_memo || '',
    CurrencyRef: {
      value: invoice.currency === 'USD' ? 'USD' : invoice.currency,
    },
  };

  // TODO: Implement actual QuickBooks Online API call here
  // const qbResponse = await quickbooksClient.createInvoice(qbInvoice);

  return {
    success: true,
    qbInvoiceId,
    posted_at: new Date(),
    gl_account: determineGLAccount(invoice),
    amount: Number(invoice.amount),
    currency: invoice.currency,
    vendor_id: invoice.vendor_id,
  };
}

function determineGLAccount(invoice: any) {
  // Determine the appropriate GL account based on invoice category
  const category = invoice.category;
  
  const glAccounts: Record<string, string> = {
    'OPERATIONAL': '6000-Operational Expenses',
    'CAPITAL': '1000-Capital Assets',
    'MAINTENANCE': '6100-Maintenance Expenses',
    'SERVICES': '6200-Service Expenses',
    'RENT': '6300-Rent Expenses',
    'UTILITIES': '6400-Utility Expenses',
    'INSURANCE': '6500-Insurance Expenses',
    'TRAVEL': '6600-Travel Expenses',
    'MARKETING': '6700-Marketing Expenses',
    'OTHER': '6900-Miscellaneous Expenses',
  };

  return glAccounts[category] || '6900-Miscellaneous Expenses';
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
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.POSTED) {
    throw new Error('Invoice must be posted before scheduling payment');
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoiceId,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      payment_date: paymentDate,
      status: 'SCHEDULED',
      vendor_id: invoice.vendor_id,
    },
  });

  // Update invoice status to PAYMENT_INITIATED
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.PAYMENT_INITIATED },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'PAYMENT_SCHEDULED',
      user_id: userId,
      detail: `Payment of ${invoice.currency} ${Number(invoice.amount).toFixed(2)} scheduled for ${paymentDate.toISOString().split('T')[0]}`,
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
    throw new Error('Payment not found');
  }

  if (payment.status !== 'SCHEDULED') {
    throw new Error('Payment must be scheduled to be processed');
  }

  // Simulate payment processing
  // In production, this would integrate with banking/payment systems
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
    data: { status: InvoiceStatus.PAID },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'PAYMENT_PROCESSED',
      user_id: userId,
      detail: `Payment processed successfully. Reference: ${paymentResult.reference}`,
    },
  });

  return paymentResult;
}

async function simulatePaymentProcessing(payment: any) {
  // Simulate payment processing
  // In production, this would call banking APIs
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
