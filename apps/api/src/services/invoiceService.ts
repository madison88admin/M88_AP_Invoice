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
    date_range_start,
    date_range_end,
    invoice_version,
    invoice_version_notes,
    parent_invoice_id,
    vendor_id,
    amount,
    amount_original,
    currency_original,
    exchange_rate_to_usd,
    currency,
    payment_terms,
    payment_term_split,
    incoterm,
    bank_charges,
    shipping_charges,
    customs_charges,
    documentation_charges,
    surcharges,
    invoice_type,
    category,
    order_type,
    brand,
    season,
    mpo_number,
    po_number,
    bill_to_name,
    bill_to_address,
    bill_to_entity,
    is_handwritten,
    is_priority,
    priority_pay_date,
    payment_consolidation_note,
    qb_memo,
    qb_account_class,
    ocr_raw_data,
  } = invoiceData;

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number,
      invoice_date: new Date(invoice_date),
      invoice_due_date: invoice_due_date ? new Date(invoice_due_date) : null,
      invoice_received_date: invoice_received_date ? new Date(invoice_received_date) : null,
      date_range_start: date_range_start ? new Date(date_range_start) : null,
      date_range_end: date_range_end ? new Date(date_range_end) : null,
      invoice_version,
      invoice_version_notes,
      parent_invoice_id,
      vendor_id,
      amount: parseFloat(amount),
      amount_original: amount_original ? parseFloat(amount_original) : null,
      currency_original,
      exchange_rate_to_usd: exchange_rate_to_usd ? parseFloat(exchange_rate_to_usd) : null,
      currency: currency || 'USD',
      payment_terms,
      payment_term_split,
      incoterm,
      bank_charges: parseFloat(bank_charges) || 0,
      shipping_charges: parseFloat(shipping_charges) || 0,
      customs_charges: parseFloat(customs_charges) || 0,
      documentation_charges: parseFloat(documentation_charges) || 0,
      surcharges: parseFloat(surcharges) || 0,
      invoice_type,
      category,
      order_type,
      brand,
      season,
      mpo_number,
      po_number,
      bill_to_name,
      bill_to_address,
      bill_to_entity: bill_to_entity || 'MADISON_88_LTD',
      is_handwritten: is_handwritten || false,
      is_priority: is_priority || false,
      priority_pay_date: priority_pay_date ? new Date(priority_pay_date) : null,
      payment_consolidation_note,
      qb_memo,
      qb_account_class,
      status: InvoiceStatus.PENDING_VALIDATION,
      ocr_raw_data: ocr_raw_data || {},
    },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
      stage_timestamps: true,
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
      stage_timestamps: true,
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
      stage_timestamps: true,
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
      stage_timestamps: true,
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
