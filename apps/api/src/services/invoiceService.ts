import prisma from '../config/database';
import { InvoiceStatus, InvoiceType, InvoiceCategory, BrandTier, InvoiceSource } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import { logAudit } from './auditLogService';
import { matchVendor } from './vendorMatchingService';
import { fieldDecisionEngine } from './fieldDecisionEngine';
import { inAppNotificationService } from './inAppNotificationService';
import crypto from 'crypto';
import { parseMPOReference } from '../utils/mpoReference';

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
    material_code,
    material_name,
    line_items,
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
    source_document_type,
    structured_source_format,
    document_layout_fingerprint,
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
  if (source && !isValidInvoiceSource(source)) {
    throw new AppError(`Invalid source: ${source}`, 400);
  }
  if (mpo_number && !/^MPO\d{5,8}(?:-[A-Z0-9]+){0,2}$/i.test(String(mpo_number))) {
    throw new AppError('MPO reference must be MPO plus 5-8 digits, optionally followed by order and material suffixes', 400);
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

  const existingInvoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: String(invoice_number).trim(),
      vendor_id: resolvedVendorId,
      invoice_type: invoice_type as any,
    },
    select: { id: true, status: true },
  });
  if (existingInvoice) {
    throw new AppError(`The same vendor, invoice number, and document type already exists (status: ${existingInvoice.status})`, 409);
  }

  const parsedMpo = parseMPOReference(mpo_number);

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
      mpo_base_number: parsedMpo.baseMpo,
      mpo_order_sequence: parsedMpo.orderSequence,
      material_code: material_code || parsedMpo.materialCode,
      material_name,
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
      source_document_type: source_document_type || undefined,
      structured_source_format: structured_source_format || undefined,
      document_layout_fingerprint: document_layout_fingerprint || undefined,
      ...(Array.isArray(line_items) && line_items.length > 0 ? {
        invoice_lines: {
          create: line_items.map((line: any, index: number) => ({
            line_number: Number(line.line_number || index + 1),
            description: line.description || line.material_name || null,
            mpo_base_number: line.mpo_base_number || parsedMpo.baseMpo || null,
            mpo_order_sequence: line.mpo_order_sequence || parsedMpo.orderSequence || null,
            material_code: line.material_code || line.item_code || parsedMpo.materialCode || null,
            material_name: line.material_name || line.description || null,
            quantity: line.quantity != null ? Number(line.quantity) : null,
            selling_quantity: line.selling_quantity != null ? Number(line.selling_quantity) : null,
            unit_price: line.unit_price != null ? Number(line.unit_price) : null,
            line_amount: line.line_amount != null ? Number(line.line_amount) : (line.total_amount != null ? Number(line.total_amount) : null),
            received_quantity: line.received_quantity != null ? Number(line.received_quantity) : null,
            accepted_quantity: line.accepted_quantity != null ? Number(line.accepted_quantity) : null,
            previously_invoiced_quantity: line.previously_invoiced_quantity != null ? Number(line.previously_invoiced_quantity) : null,
            remaining_receivable_quantity: line.remaining_receivable_quantity != null ? Number(line.remaining_receivable_quantity) : null,
            extraction_confidence: line.extraction_confidence != null ? Number(line.extraction_confidence) : null,
            field_confidence: line.field_confidence || undefined,
            extraction_provenance: line.extraction_provenance || undefined,
            source_evidence: line.source_evidence || undefined,
            match_status: 'PENDING',
          })),
        },
      } : {}),
    },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
      stage_timestamps: true,
      invoice_lines: true,
      payments: true,
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
      invoice_lines: true,
      payments: true,
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
      invoice_lines: true,
      workflow_actions: { orderBy: { created_at: 'desc' } },
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
  const allowedRoles = ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'];
  if (!allowedRoles.includes(userRole)) {
    throw new AppError('Not authorized to edit invoice data', 403);
  }

  // Prevent editing invoices that are already posted or paid
  const lockedStatuses = ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID', 'PAYMENT_CONFIRMATION_SENT', 'REJECTED'];
  if (lockedStatuses.includes(existing.status)) {
    throw new AppError(`Cannot edit invoice in ${existing.status} status`, 400);
  }

  // Convert date strings to Date objects for Prisma DateTime fields
  const data: Record<string, any> = {};

  // Only copy defined, non-undefined values — prevents accidental null overwrites
  const protectedFields = ['id', 'created_at', 'updated_at', 'status', 'source', 'approval_tier', 'qb_posted_at', 'vendor_id', 'revision', 'edit_reason'];
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

  // Invoice numbers are unique within a vendor/document type, not globally.
  if (data.invoice_number && data.invoice_number !== existing.invoice_number) {
    const duplicate = await prisma.invoice.findFirst({
      where: {
        invoice_number: data.invoice_number,
        vendor_id: existing.vendor_id,
        invoice_type: (data.invoice_type || existing.invoice_type) as any,
        id: { not: id },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError(`Invoice number "${data.invoice_number}" already exists`, 400);
    }
  }

  const materialFields = new Set([
    'vendor_name_raw', 'invoice_number', 'invoice_type', 'invoice_date', 'total_amount',
    'currency', 'mpo_number', 'mpo_base_number', 'mpo_order_sequence', 'material_code',
    'material_name', 'qty_shipped', 'bank_name', 'swift_code', 'account_number',
    'payment_terms', 'customer_po_number'
  ]);
  const materialChange = Object.keys(data).some((key) =>
    materialFields.has(key) && String((existing as any)[key] ?? '') !== String(data[key] ?? '')
  );
  if (materialChange && !String(invoiceData.edit_reason || '').trim()) {
    throw new AppError('A reason is required for material or financial invoice changes', 400);
  }
  const approvalStarted = String(existing.status).startsWith('PENDING_') || existing.status === 'APPROVED';
  const nextRevision = materialChange ? Number((existing as any).revision || 1) + 1 : Number((existing as any).revision || 1);

  if (materialChange && approvalStarted) {
    await prisma.signature.updateMany({
      where: { invoice_id: id, signed_at: { not: null } },
      data: {
        approval_status: 'SUPERSEDED',
        invalidated_at: new Date(),
        invalidation_reason: `Material invoice data changed by ${userName || userId}`,
      },
    });
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      ...data,
      revision: nextRevision,
      ...(materialChange && approvalStarted ? {
        status: 'VALIDATION_PENDING' as any,
        current_approver_role: null,
      } : {}),
    },
    include: {
      vendor: true,
      signatures: true,
      exceptions: true,
      stage_timestamps: true,
    },
  });

  if (materialChange) {
    await prisma.invoiceWorkflowAction.create({
      data: {
        invoice_id: id,
        invoice_revision: nextRevision,
        action: approvalStarted ? 'MATERIAL_EDIT_REVALIDATION_REQUIRED' : 'MATERIAL_EDIT',
        from_stage: existing.status,
        to_stage: approvalStarted ? 'VALIDATION_PENDING' : existing.status,
        reason: String(invoiceData.edit_reason || 'Invoice data corrected'),
        performed_by: userId,
        performed_by_role: userRole,
      },
    });
  }

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
      const rawTextForLearning = existing.ocr_raw_data
        ? JSON.stringify(existing.ocr_raw_data)
        : undefined;
      await fieldDecisionEngine.saveCorrection({
        invoice_id: invoice.id,
        vendor_name: existing.vendor_name_raw || invoice.vendor_name_raw || undefined,
        raw_text: rawTextForLearning,
        original_fields: originalFields,
        corrected_fields: correctedFields,
        note: 'Auto-logged from dashboard edit',
      });
      console.log(`[AI Learning] Correction logged from edit: ${Object.keys(correctedFields).join(', ')}`);
    }
  } catch (learnError) {
    console.error('[AI Learning] Failed to log correction from edit:', learnError);
  }

  // Re-validate when any validation-relevant field is edited — clears fixed exceptions automatically
  const validationFields = [
    // Amount & charges
    'total_amount', 'subtotal', 'tax_amount', 'discount_amount',
    'bank_charges', 'freight_charges', 'additional_charges', 'courier_charges',
    'handling_fee', 'tt_charge', 'setup_charge', 'sample_charge',
    'min_order_charge', 'finance_surcharge',
    // Bank info
    'bank_name', 'swift_code', 'account_number',
    // Dates
    'invoice_date', 'due_date', 'invoice_received_date',
    // PO & order refs
    'mpo_number', 'customer_po_number', 'po_number',
    // Classification
    'currency', 'invoice_currency_original', 'exchange_rate_to_usd',
    'payment_terms', 'incoterm', 'invoice_type', 'invoice_template_type',
    'vendor_name_raw', 'vendor_id',
    // Shipping
    'ship_to', 'sold_to', 'qty_shipped',
    // Brand
    'brand', 'brand_code', 'brand_tier', 'season',
  ];
  const shouldRevalidate = validationFields.some(f => invoiceData[f] !== undefined);
  const revalidateStatuses = ['EXCEPTION_FLAGGED', 'RECEIVED', 'VALIDATION_PENDING'];
  if (shouldRevalidate && revalidateStatuses.includes(invoice.status)) {
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

export const getInvoiceTimeline = async (invoiceId: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      audit_logs: { orderBy: { created_at: 'asc' } },
      workflow_actions: { orderBy: { created_at: 'asc' } },
      stage_timestamps: { orderBy: { entered_at: 'asc' } },
      signatures: { orderBy: { created_at: 'asc' } },
      payments: {
        include: { batch: true },
        orderBy: { created_at: 'asc' },
      },
      exceptions: { orderBy: { created_at: 'asc' } },
      payment_confirmations: { orderBy: { created_at: 'asc' } },
      parent_invoice: { select: { id: true, invoice_number: true, invoice_type: true, status: true } },
      child_invoices: { select: { id: true, invoice_number: true, invoice_type: true, status: true, created_at: true } },
    },
  });

  if (!invoice) return null;

  const events: Array<{
    id: string;
    type: string;
    title: string;
    detail?: string | null;
    actor?: string | null;
    status?: string | null;
    created_at: Date;
  }> = [
    {
      id: `created:${invoice.id}`,
      type: 'upload',
      title: 'Invoice uploaded/created',
      detail: `${invoice.invoice_number} from ${invoice.vendor?.name || invoice.vendor_name_raw || 'Unknown vendor'}`,
      actor: null,
      status: invoice.status,
      created_at: invoice.created_at,
    },
  ];

  for (const audit of invoice.audit_logs) {
    events.push({
      id: `audit:${audit.id}`,
      type: 'audit',
      title: audit.action,
      detail: audit.note,
      actor: audit.performed_by,
      status: null,
      created_at: audit.created_at,
    });
  }

  for (const action of invoice.workflow_actions) {
    events.push({
      id: `workflow:${action.id}`,
      type: 'workflow',
      title: action.action,
      detail: action.reason || [action.from_stage, action.to_stage].filter(Boolean).join(' -> '),
      actor: action.performed_by,
      status: action.to_stage,
      created_at: action.created_at,
    });
  }

  for (const stage of invoice.stage_timestamps) {
    events.push({
      id: `stage:${stage.id}`,
      type: 'stage',
      title: `Entered ${stage.stage}`,
      detail: stage.exited_at ? `Exited ${new Date(stage.exited_at).toLocaleString()}` : 'Current/open stage',
      actor: null,
      status: stage.stage,
      created_at: stage.entered_at,
    });
  }

  for (const signature of invoice.signatures) {
    events.push({
      id: `signature:${signature.id}`,
      type: 'approval',
      title: `${signature.signatory_role} ${signature.approval_status?.toLowerCase() || 'approval'}`,
      detail: signature.invalidated_at ? `Invalidated: ${signature.invalidation_reason || 'no reason recorded'}` : signature.signatory_name,
      actor: signature.signatory_name,
      status: signature.approval_status,
      created_at: signature.signed_at || signature.created_at,
    });
  }

  for (const exception of invoice.exceptions) {
    events.push({
      id: `exception:${exception.id}`,
      type: 'exception',
      title: `Exception: ${exception.reason}`,
      detail: exception.resolution_notes || exception.detail,
      actor: exception.resolved_by,
      status: exception.status,
      created_at: exception.resolved_at || exception.created_at,
    });
  }

  for (const payment of invoice.payments as any[]) {
    events.push({
      id: `payment:${payment.id}`,
      type: 'payment',
      title: payment.status === 'PAID' ? 'Payment executed' : 'Payment scheduled',
      detail: [
        `${payment.currency} ${Number(payment.amount).toLocaleString()}`,
        payment.batch?.batch_number ? `Batch ${payment.batch.batch_number}` : null,
        payment.reference ? `Reference ${payment.reference}` : null,
        payment.bank_used ? `Bank ${payment.bank_used}` : null,
        payment.proof_file_name ? `Proof ${payment.proof_file_name}` : null,
      ].filter(Boolean).join(' | '),
      actor: payment.batch?.processed_by || null,
      status: payment.status,
      created_at: payment.paid_at || payment.created_at,
    });
  }

  for (const confirmation of invoice.payment_confirmations) {
    events.push({
      id: `confirmation:${confirmation.id}`,
      type: 'payment_confirmation',
      title: confirmation.email_sent ? 'Payment confirmation sent' : 'Payment confirmation recorded',
      detail: confirmation.payment_reference || confirmation.vendor_email,
      actor: confirmation.sent_by,
      status: confirmation.email_sent ? 'SENT' : 'RECORDED',
      created_at: confirmation.sent_at,
    });
  }

  return {
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_name: invoice.vendor?.name || invoice.vendor_name_raw || 'Unknown',
      status: invoice.status,
      total_amount: Number(invoice.total_amount),
      currency: invoice.currency,
      parent_invoice: invoice.parent_invoice,
      child_invoices: invoice.child_invoices,
    },
    events: events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  };
};

export const deleteInvoice = async (id: string, userId: string, userRole: string, userName: string) => {
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Invoice not found', 404);
  }

  const lockedStatuses = ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID', 'PAYMENT_CONFIRMATION_SENT'];
  if (lockedStatuses.includes(existing.status)) {
    throw new AppError(`Cannot delete invoice in ${existing.status} status`, 400);
  }

  await prisma.invoice.delete({ where: { id } });

  await logAudit({
    invoice_id: id,
    performed_by: userName,
    action: 'INVOICE_DELETED',
    note: `Invoice ${existing.invoice_number} deleted by ${userName} (${userRole})`,
  });

  return { id, deleted: true, invoice_number: existing.invoice_number };
};
