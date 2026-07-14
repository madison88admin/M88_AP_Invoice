import prisma from '../config/database';
import { InvoiceStatus, InvoiceType, InvoiceCategory, BrandTier, InvoiceSource } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import { logAudit } from './auditLogService';
import { matchVendor } from './vendorMatchingService';
import { fieldDecisionEngine } from './fieldDecisionEngine';
import { inAppNotificationService } from './inAppNotificationService';
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
    category,
    order_type,
    brand,
    brand_code,
    season,
    qty_shipped,
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
    po_validation,
    ocr_raw_data,
    bank_name,
    swift_code,
    account_number,
    ocr_confidence_score,
  } = invoiceData;

  // Validate required fields
  if (!invoice_number || String(invoice_number).trim() === '') {
    throw new AppError('Invoice number is required', 400);
  }
  const parsedAmount = parseFloat(total_amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new AppError('Total amount must be a positive number', 400);
  }

  // Check for duplicate invoice number
  const existingInvoice = await prisma.invoice.findUnique({
    where: { invoice_number: String(invoice_number).trim() },
    select: { id: true, status: true },
  });
  if (existingInvoice) {
    throw new AppError(
      `Invoice number "${invoice_number}" already exists (status: ${existingInvoice.status}). Duplicate invoices are not allowed.`,
      409
    );
  }
  if (!isValidInvoiceType(invoice_type)) {
    throw new AppError(`Invalid invoice type: ${invoice_type}`, 400);
  }
  if (source && !isValidInvoiceSource(source)) {
    throw new AppError(`Invalid source: ${source}`, 400);
  }
  if (mpo_number && !/^MPO\d{5,8}$/.test(String(mpo_number))) {
    throw new AppError('MPO number must be MPO followed by 5 to 8 digits (e.g. MPO15371 or MPO015189)', 400);
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

  // Resolve vendor_id: use provided ID, match by name, or create new vendor
  let resolvedVendorId = vendor_id;
  if (!resolvedVendorId) {
    const vendorName = vendor_name_raw || '';
    if (!vendorName.trim()) {
      throw new AppError('Vendor name or vendor_id is required', 400);
    }
    const matched = await matchVendor(vendorName);
    if (matched) {
      resolvedVendorId = matched.vendor_id;
    } else {
      const newVendor = await prisma.vendor.create({
        data: {
          name: vendorName.trim(),
          name_aliases: [],
          invoice_template_type: 'NO_DATA' as any,
        },
      });
      resolvedVendorId = newVendor.id;
    }
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
      vendor_id: resolvedVendorId,
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
      category: category || 'TRIMS',
      order_type,
      brand,
      brand_code,
      brand_tier,
      season,
      qty_shipped: qty_shipped ? parseInt(qty_shipped) : null,
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
      status: InvoiceStatus.RECEIVED as any,
      po_validation: po_validation || undefined,
      ocr_raw_data: ocr_raw_data || undefined,
      bank_name: bank_name || undefined,
      swift_code: swift_code || undefined,
      account_number: account_number || undefined,
      ocr_confidence_score: ocr_confidence_score ? parseFloat(ocr_confidence_score) : null,
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

  // Notify: new invoice arrived
  await inAppNotificationService.notifyStageTransition(
    invoice.id, String(invoice_number), vendor_name_raw || 'Unknown', '', 'RECEIVED'
  );

  // Auto-trigger validation in background (non-blocking) so invoice creation returns quickly
  setImmediate(async () => {
    try {
      const { validateInvoice } = await import('./validationService');
      await validateInvoice(invoice.id);
      console.log('[AutoValidation] Completed for invoice:', invoice.id);
    } catch (error) {
      console.error('[AutoValidation] Failed after invoice creation:', error);
    }
  });

  // Return the created invoice immediately (without waiting for validation)
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

export const updateInvoice = async (id: string, invoiceData: any, userId: string, userRole: string, userName?: string) => {
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Invoice not found', 404);
  }

  // Only coordinators, accounting supervisors, or admins can edit invoice data
  const allowedRoles = ['PURCHASING_COORDINATOR', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'];
  if (!allowedRoles.includes(userRole)) {
    throw new AppError('Not authorized to edit invoice data', 403);
  }

  // Prevent editing invoices that are already posted or paid
  const lockedStatuses = ['APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID', 'REJECTED'];
  if (lockedStatuses.includes(existing.status)) {
    throw new AppError(`Cannot edit invoice in ${existing.status} status`, 400);
  }

  // Convert date strings to Date objects for Prisma DateTime fields
  const data: Record<string, any> = {};

  // Only copy defined, non-undefined values — prevents accidental null overwrites
  const protectedFields = ['id', 'created_at', 'updated_at', 'status', 'source', 'approval_tier', 'qb_posted_at', 'vendor_id'];
  for (const [key, value] of Object.entries(invoiceData)) {
    if (value === undefined) continue;
    if (protectedFields.includes(key)) continue;
    data[key] = value;
  }

  // Validate enum fields — skip invalid values to prevent Prisma errors
  const validCategories = Object.values(InvoiceCategory);
  if (data.category && !validCategories.includes(data.category)) {
    delete data.category;
  }

  const validInvoiceTypes = ['INVOICE', 'PROFORMA', 'COMMERCIAL', 'SALES', 'STATEMENT', 'PREPAID', 'PROTO_SAMPLE'];
  if (data.invoice_type && !validInvoiceTypes.includes(data.invoice_type)) {
    delete data.invoice_type;
  }

  const validOrderTypes = ['BULK', 'SMS', 'SAMPLE'];
  if (data.order_type && !validOrderTypes.includes(data.order_type)) {
    delete data.order_type;
  }

  const validBrandTiers = ['TOP_10', 'OTHER'];
  if (data.brand_tier && !validBrandTiers.includes(data.brand_tier)) {
    delete data.brand_tier;
  }

  const validBillToEntities = ['MADISON_88_LTD', 'MADISON_88_HK_LIMITED'];
  if (data.bill_to_entity && !validBillToEntities.includes(data.bill_to_entity)) {
    delete data.bill_to_entity;
  }

  // payment_terms is a free-text String field, not an enum — no validation needed

  const dateFields = ['invoice_date', 'due_date', 'invoice_received_date', 'date_range_start', 'date_range_end', 'priority_pay_date'];
  for (const field of dateFields) {
    if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
      data[field] = safeDate(data[field]);
    } else if (data[field] === '') {
      data[field] = null;
    }
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data,
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
      stage_timestamps: true,
    },
  });

  // Build detailed change log with old→new values
  const displayName = userName || userId;

  const changedFields: string[] = [];
  for (const key of Object.keys(invoiceData)) {
    if (invoiceData[key] === undefined) continue;
    const oldVal = (existing as any)[key];
    const newVal = invoiceData[key];
    if (oldVal !== undefined && String(oldVal) !== String(newVal)) {
      const oldDisplay = oldVal instanceof Date ? oldVal.toISOString().split('T')[0] : String(oldVal ?? '—');
      const newDisplay = newVal instanceof Date ? new Date(newVal).toISOString().split('T')[0] : String(newVal ?? '—');
      changedFields.push(`${key}: "${oldDisplay}" → "${newDisplay}"`);
    }
  }

  const auditNote = changedFields.length > 0
    ? `Invoice edited by ${displayName} (${userRole}). Changes:\n${changedFields.join('\n')}`
    : `Invoice updated by ${displayName} (${userRole}). Fields submitted: ${Object.keys(invoiceData).join(', ')} (no values changed)`;

  await logAudit({
    invoice_id: invoice.id,
    performed_by: userId,
    action: 'INVOICE_UPDATED',
    note: auditNote,
  });

  // Feed edits into AI learning system — compare original vs updated fields
  try {
    const originalFields: Record<string, any> = {};
    const correctedFields: Record<string, any> = {};
    for (const key of Object.keys(invoiceData)) {
      if (invoiceData[key] === undefined) continue;
      const oldVal = (existing as any)[key];
      const newVal = invoiceData[key];
      if (oldVal !== undefined && String(oldVal) !== String(newVal)) {
        originalFields[key] = oldVal;
        correctedFields[key] = newVal;
      }
    }
    if (Object.keys(correctedFields).length > 0) {
      await fieldDecisionEngine.saveCorrection({
        invoice_id: invoice.id,
        vendor_name: existing.vendor_name_raw || invoice.vendor_name_raw || undefined,
        original_fields: originalFields,
        corrected_fields: correctedFields,
        note: 'Auto-logged from dashboard edit',
      });
      console.log(`[AI Learning] Correction logged from edit: ${Object.keys(correctedFields).join(', ')}`);
    }
  } catch (learnError) {
    console.error('[AI Learning] Failed to log correction from edit:', learnError);
  }

  // Re-validate if charge-related fields or amount were changed — PO amount comparison depends on net amount
  const chargeFields = ['total_amount', 'bank_charges', 'freight_charges', 'additional_charges',
    'tt_charge', 'courier_charges', 'handling_fee', 'finance_surcharge', 'setup_charge',
    'sample_charge', 'min_order_charge', 'discount_amount', 'mpo_number', 'customer_po_number'];
  const shouldRevalidate = chargeFields.some(f => invoiceData[f] !== undefined);
  if (shouldRevalidate && invoice.status === 'EXCEPTION_FLAGGED') {
    setImmediate(async () => {
      try {
        const { validateInvoice } = await import('./validationService');
        await validateInvoice(invoice.id);
        console.log('[AutoRevalidation] Completed after edit for invoice:', invoice.id);
      } catch (error) {
        console.error('[AutoRevalidation] Failed after edit:', error);
      }
    });
  }

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
