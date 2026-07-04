import prisma from '../config/database';
import { InvoiceStatus, InvoiceType, InvoiceCategory, BrandTier, InvoiceSource } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import { logAudit } from './auditLogService';
import crypto from 'crypto';

function safeDate(value: any): Date | null {
  if (!value || value === '') return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function isValidInvoiceType(value: any): value is InvoiceType {
  return value && Object.values(InvoiceType).includes(value as InvoiceType);
}

function isValidInvoiceSource(value: any): value is InvoiceSource {
  return value && Object.values(InvoiceSource).includes(value as InvoiceSource);
}

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
    subtotal,
    tax_amount,
    discount_amount,
    ship_to,
    sold_to,
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

  // Validate required fields
  if (!invoice_number || String(invoice_number).trim() === '') {
    throw new AppError('Invoice number is required', 400);
  }
  const parsedAmount = parseFloat(total_amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new AppError('Total amount must be a positive number', 400);
  }
  if (!isValidInvoiceType(invoice_type)) {
    throw new AppError(`Invalid invoice type: ${invoice_type}`, 400);
  }
  if (!isValidInvoiceSource(source)) {
    throw new AppError(`Invalid source: ${source}`, 400);
  }
  if (mpo_number && !/^MPO\d{6}$/.test(String(mpo_number))) {
    throw new AppError('MPO number must be MPO followed by exactly 6 digits (e.g. MPO015189)', 400);
  }

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
      invoice_number: String(invoice_number).trim(),
      invoice_date: safeDate(invoice_date),
      due_date: safeDate(due_date),
      invoice_received_date: safeDate(invoice_received_date),
      date_range_start: safeDate(date_range_start),
      date_range_end: safeDate(date_range_end),
      parent_invoice_id,
      vendor_id,
      total_amount: parsedAmount,
      invoice_currency_original,
      exchange_rate_to_usd: exchange_rate_to_usd ? parseFloat(exchange_rate_to_usd) : null,
      currency: currency || 'USD',
      payment_terms,
      incoterm,
      bank_charges: parseFloat(bank_charges) || 0,
      freight_charges: parseFloat(freight_charges) || 0,
      additional_charges: parseFloat(additional_charges) || 0,
      subtotal: subtotal ? parseFloat(subtotal) : null,
      tax_amount: tax_amount ? parseFloat(tax_amount) : null,
      discount_amount: discount_amount ? parseFloat(discount_amount) : null,
      ship_to: ship_to || null,
      sold_to: sold_to || null,
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
      priority_pay_date: safeDate(priority_pay_date),
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
  const existing = await prisma.invoice.findUnique({ where: { id } });
  const oldStatus = existing?.status;

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

  await logAudit({
    invoice_id: invoice.id,
    performed_by: userId,
    action: 'STATUS_UPDATED',
    note: `Status changed from ${oldStatus} to ${status}`,
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
