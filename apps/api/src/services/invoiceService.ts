import prisma from '../config/database';
import { InvoiceStatus, InvoiceType, InvoiceCategory, BrandTier } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import crypto from 'crypto';

export const createInvoice = async (invoiceData: any, userId: string) => {
  const {
    invoice_number,
    invoice_date,
    due_date,
    invoice_received_date,
    date_range_start,
    date_range_end,
    parent_invoice_id,
    vendor_id,
    total_amount,
    invoice_currency_original,
    exchange_rate_to_usd,
    currency,
    payment_terms,
    incoterm,
    bank_charges,
    freight_charges,
    additional_charges,
    invoice_type,
    order_type,
    brand,
    brand_code,
    season,
    mpo_number,
    customer_po_number,
    bill_to_entity,
    is_handwritten,
    priority_flag,
    priority_pay_date,
    is_urgent,
    qb_memo,
    qb_account_class,
    vendor_name_raw,
    source,
  } = invoiceData;

  // Determine brand_tier from brand or brand_code
  let brand_tier: BrandTier | undefined;
  if (brand_code && TOP_10_BRANDS[brand_code]) {
    brand_tier = BrandTier.TOP_10;
  } else if (brand && isTop10Brand(brand)) {
    brand_tier = BrandTier.TOP_10;
  } else {
    brand_tier = BrandTier.OTHER;
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number,
      invoice_date: invoice_date ? new Date(invoice_date) : null,
      due_date: due_date ? new Date(due_date) : null,
      invoice_received_date: invoice_received_date ? new Date(invoice_received_date) : null,
      date_range_start: date_range_start ? new Date(date_range_start) : null,
      date_range_end: date_range_end ? new Date(date_range_end) : null,
      parent_invoice_id,
      vendor_id,
      total_amount: parseFloat(total_amount),
      invoice_currency_original,
      exchange_rate_to_usd: exchange_rate_to_usd ? parseFloat(exchange_rate_to_usd) : null,
      currency: currency || 'USD',
      payment_terms,
      incoterm,
      bank_charges: parseFloat(bank_charges) || 0,
      freight_charges: parseFloat(freight_charges) || 0,
      additional_charges: parseFloat(additional_charges) || 0,
      invoice_type,
      order_type,
      brand,
      brand_code,
      brand_tier,
      season,
      mpo_number,
      customer_po_number,
      bill_to_entity: bill_to_entity || 'MADISON_88_LTD',
      is_handwritten: is_handwritten || false,
      priority_flag: priority_flag || false,
      priority_pay_date: priority_pay_date ? new Date(priority_pay_date) : null,
      is_urgent: is_urgent || false,
      qb_memo,
      qb_account_class,
      vendor_name_raw: vendor_name_raw || '',
      source: source || 'MANUAL_UPLOAD',
      status: InvoiceStatus.VALIDATION_PENDING as any,
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
      performed_by: userId,
      action: 'INVOICE_CREATED',
      note: `Invoice ${invoice_number} created`,
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
    data: { status: status as any },
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
      performed_by: userId,
      action: 'STATUS_UPDATED',
      note: `Status updated to ${status}`,
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
      total_amount: parseFloat(amount),
      invoice_date: new Date(invoice_date),
    },
  });

  if (existingInvoices.length > 0) {
    return { isDuplicate: true, existingInvoice: existingInvoices[0] };
  }

  return { isDuplicate: false };
};
