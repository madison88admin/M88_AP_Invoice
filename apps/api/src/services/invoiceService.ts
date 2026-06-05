import prisma from '../config/database';
import { InvoiceStatus, InvoiceType, InvoiceCategory } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

export const createInvoice = async (invoiceData: any, userId: string) => {
  const {
    invoice_number,
    invoice_date,
    invoice_due_date,
    invoice_received_date,
    vendor_id,
    amount,
    currency,
    payment_terms,
    incoterm,
    bank_charges,
    shipping_charges,
    invoice_type,
    category,
    bill_to_name,
    bill_to_address,
    ocr_raw_data,
  } = invoiceData;

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number,
      invoice_date: new Date(invoice_date),
      invoice_due_date: invoice_due_date ? new Date(invoice_due_date) : null,
      invoice_received_date: invoice_received_date ? new Date(invoice_received_date) : null,
      vendor_id,
      amount: parseFloat(amount),
      currency: currency || 'USD',
      payment_terms,
      incoterm,
      bank_charges: parseFloat(bank_charges) || 0,
      shipping_charges: parseFloat(shipping_charges) || 0,
      invoice_type,
      category,
      bill_to_name,
      bill_to_address,
      status: InvoiceStatus.PENDING_VALIDATION,
      priority: 'NORMAL',
      ocr_raw_data,
    },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: invoice.id,
      user_id: userId,
      action: 'INVOICE_CREATED',
      metadata: { invoice_number },
    },
  });

  return invoice;
};

export const getInvoices = async (filters: any) => {
  const where: any = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.vendor) {
    where.vendor = {
      name: {
        contains: filters.vendor,
        mode: 'insensitive',
      },
    };
  }

  if (filters.dateFrom || filters.dateTo) {
    where.invoice_date = {};
    if (filters.dateFrom) {
      where.invoice_date.gte = filters.dateFrom;
    }
    if (filters.dateTo) {
      where.invoice_date.lte = filters.dateTo;
    }
  }

  if (filters.type) {
    where.invoice_type = filters.type;
  }

  if (filters.category) {
    where.category = filters.category;
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  return invoices;
};

export const getInvoiceById = async (id: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
      audit_logs: {
        orderBy: {
          created_at: 'desc',
        },
      },
    },
  });

  return invoice;
};

export const updateInvoiceStatus = async (id: string, status: InvoiceStatus, userId: string) => {
  const invoice = await prisma.invoice.update({
    where: { id },
    data: { status },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: invoice.id,
      user_id: userId,
      action: 'STATUS_UPDATED',
      metadata: { new_status: status },
    },
  });

  return invoice;
};

export const checkDuplicate = async (invoiceData: any) => {
  const { invoice_number, vendor_id, amount, invoice_date } = invoiceData;
  
  const hash = crypto
    .createHash('sha256')
    .update(`${invoice_number}${vendor_id}${amount}${invoice_date}`)
    .digest('hex');

  const existingInvoices = await prisma.invoice.findMany({
    where: {
      invoice_number,
      vendor_id,
      amount: parseFloat(amount),
      invoice_date: new Date(invoice_date),
    },
  });

  if (existingInvoices.length > 0) {
    return { isDuplicate: true, existingInvoice: existingInvoices[0] };
  }

  return { isDuplicate: false };
};
