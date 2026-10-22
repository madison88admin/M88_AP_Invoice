import crypto from 'crypto';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { buildDuplicateIndicators, normalizeInvoiceReference } from './accountingControlService';

export interface EmailDuplicateResult {
  isDuplicate: boolean;
  level: 'NONE' | 'EMAIL' | 'FILE_HASH' | 'BUSINESS' | 'BUSINESS_ADVANCED';
  existingInvoiceId?: string;
  existingInvoiceNumber?: string;
  detail: string;
}

/**
 * Exact duplicate levels are intake idempotency failures, not revision
 * candidates. The same email message or identical PDF must never create a
 * second AP invoice row. A changed PDF may still continue through the normal
 * revision/duplicate-review workflow.
 */
export function isHardDuplicate(result: EmailDuplicateResult | null | undefined): boolean {
  return Boolean(result?.isDuplicate && (result.level === 'EMAIL' || result.level === 'FILE_HASH'));
}

const REPLACEMENT_PROTECTED_STATUSES = new Set([
  'APPROVED',
  'POSTED_TO_QB',
  'PAYMENT_SCHEDULED',
  'PAID',
  'PAYMENT_CONFIRMATION_SENT',
]);

export type DuplicateReplacementDecision = {
  canReplace: boolean;
  existingInvoiceId: string;
  existingInvoiceNumber: string;
  reason?: string;
};

/**
 * Decide whether an exact duplicate may start a fresh intake cycle.  The old
 * row is never deleted: when replacement is allowed it is marked CANCELLED /
 * SUPERSEDED and linked to the new row.  Approved, paid, batched, or
 * legal-held records remain immutable and therefore keep the duplicate blocked.
 */
export async function getDuplicateReplacementDecision(
  existingInvoiceId: string,
  client: any = prisma,
): Promise<DuplicateReplacementDecision | null> {
  const existing = await client.invoice.findUnique({
    where: { id: existingInvoiceId },
    select: {
      id: true,
      invoice_number: true,
      status: true,
      workflow_status: true,
      legal_hold: true,
      payments: { select: { id: true }, take: 1 },
    },
  });
  if (!existing) return null;

  const status = String(existing.status || '').toUpperCase();
  const workflowStatus = String(existing.workflow_status || '').toUpperCase();
  const hasPayment = Array.isArray(existing.payments) && existing.payments.length > 0;
  const protectedRecord = Boolean(existing.legal_hold)
    || hasPayment
    || REPLACEMENT_PROTECTED_STATUSES.has(status)
    || ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'].includes(workflowStatus);
  if (protectedRecord) {
    return {
      canReplace: false,
      existingInvoiceId: existing.id,
      existingInvoiceNumber: existing.invoice_number,
      reason: `Exact duplicate matches protected invoice ${existing.invoice_number}. Approved, paid, batched, or legal-held invoices cannot be superseded automatically.`,
    };
  }
  return {
    canReplace: true,
    existingInvoiceId: existing.id,
    existingInvoiceNumber: existing.invoice_number,
  };
}

/** Mark an old intake row as superseded while retaining its audit trail. */
export async function supersedeInvoiceForReplacement(
  existingInvoiceId: string,
  replacementInvoiceId: string,
  source: string,
  client: any = prisma,
): Promise<void> {
  const decision = await getDuplicateReplacementDecision(existingInvoiceId, client);
  if (!decision) throw new Error(`Invoice ${existingInvoiceId} was not found for replacement`);
  if (!decision.canReplace) throw new Error(decision.reason || 'Invoice is protected from replacement');

  const note = `Superseded by replacement invoice ${replacementInvoiceId}; the replacement restarts the coordinator workflow.`;
  await client.invoice.update({
    where: { id: existingInvoiceId },
    data: {
      status: 'CANCELLED' as any,
      workflow_status: 'SUPERSEDED',
      is_duplicate: true,
      duplicate_review_status: 'SUPERSEDED',
      duplicate_review_reason: note,
      duplicate_reviewed_by: source,
      duplicate_reviewed_at: new Date(),
      cancelled_by: source,
      cancelled_at: new Date(),
      cancellation_reason: note,
    },
  });
  await client.auditLog.create({
    data: {
      invoice_id: existingInvoiceId,
      action: 'INVOICE_SUPERSEDED_BY_REPLACEMENT',
      performed_by: source,
      note,
      metadata: {
        replacement_invoice_id: replacementInvoiceId,
        existing_invoice_number: decision.existingInvoiceNumber,
        reason: 'IDENTICAL_FILE_REDELIVERY',
      },
    },
  });
}

/**
 * Level 1: Check by Internet Message ID (same email forwarded/re-sent)
 */
async function checkByEmailMessageId(internetMessageId: string): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  try {
    const result = await prisma.$queryRaw`
      SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
      WHERE ocr_raw_data->>'email_internet_message_id' = ${internetMessageId}
      LIMIT 1
    `;
    const row = Array.isArray(result) ? result[0] : null;
    if (row) return { invoiceId: row.id, invoiceNumber: row.invoice_number };
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Level 2: Check by SHA256 hash of file content (same PDF re-uploaded)
 */
async function checkByFileHash(fileBuffer: Buffer): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  try {
    const result = await prisma.$queryRaw`
      SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
      WHERE invoice_hash = ${fileHash}
      LIMIT 1
    `;
    const row = Array.isArray(result) ? result[0] : null;
    if (row) return { invoiceId: row.id, invoiceNumber: row.invoice_number };
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Level 3: Check by business key (vendor + invoice number + amount)
 */
async function checkByBusinessKey(
  vendorName: string,
  invoiceNumber: string,
  amount: number,
  invoiceDate: Date | string | null
): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  if (!invoiceNumber || !vendorName) return null;
  try {
    const dateStr = invoiceDate
      ? (invoiceDate instanceof Date ? invoiceDate.toISOString().split('T')[0] : new Date(invoiceDate).toISOString().split('T')[0])
      : null;

    let result: any[];
    if (dateStr) {
      result = await prisma.$queryRaw`
        SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
        WHERE invoice_number = ${invoiceNumber}
          AND vendor_name_raw = ${vendorName}
          AND total_amount = ${amount}::numeric
          AND invoice_date::date = ${dateStr}::date
        LIMIT 1
      ` as any[];
    } else {
      result = await prisma.$queryRaw`
        SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
        WHERE invoice_number = ${invoiceNumber}
          AND vendor_name_raw = ${vendorName}
          AND total_amount = ${amount}::numeric
        LIMIT 1
      ` as any[];
    }

    const row = Array.isArray(result) ? result[0] : null;
    if (row) return { invoiceId: row.id, invoiceNumber: row.invoice_number };
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Shared accounting duplicate/revision gate used by every email intake path.
 * It deliberately queries the same fields as the file watcher so an email
 * attachment cannot bypass normalized revision, MPO/PO, line-signature, or
 * document-fingerprint checks.
 */
async function checkByAdvancedBusinessKey(input: {
  vendorId?: string;
  vendorName?: string;
  invoiceNumber?: string;
  amount?: number;
  invoiceDate?: Date | string | null;
  currency?: string;
  mpoNumber?: string;
  customerPoNumber?: string;
  fileHash: string;
  lineItemsSignature?: string;
  documentLayoutFingerprint?: string;
}): Promise<{ invoiceId: string; invoiceNumber: string; detail: string } | null> {
  const normalized = normalizeInvoiceReference(input.invoiceNumber);
  if (!normalized && !input.mpoNumber && !input.customerPoNumber && !input.fileHash) return null;
  const refs = [input.mpoNumber, input.customerPoNumber].filter(Boolean).map(v => String(v).trim().toUpperCase());
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { not: 'CANCELLED' as any },
      OR: [
        ...(normalized ? [{ normalized_invoice_number: normalized }, { invoice_number: input.invoiceNumber }] : []),
        ...(input.fileHash ? [{ invoice_hash: input.fileHash }] : []),
        ...refs.flatMap(ref => [{ mpo_number: ref }, { mpo_base_number: ref }, { customer_po_number: ref }]),
      ],
    },
    select: {
      id: true,
      invoice_number: true,
      normalized_invoice_number: true,
      vendor_id: true,
      vendor_name_raw: true,
      mpo_number: true,
      customer_po_number: true,
      invoice_date: true,
      total_amount: true,
      currency: true,
      invoice_hash: true,
      line_items_signature: true,
      document_layout_fingerprint: true,
    },
    take: 50,
  });
  const incomingDate = input.invoiceDate ? new Date(input.invoiceDate) : null;
  const incoming = {
    vendor_id: input.vendorId || null,
    invoice_number: input.invoiceNumber,
    mpo_number: input.mpoNumber,
    customer_po_number: input.customerPoNumber,
    invoice_date: incomingDate,
    total_amount: input.amount,
    currency: input.currency,
    invoice_hash: input.fileHash,
    line_items_signature: input.lineItemsSignature,
    document_layout_fingerprint: input.documentLayoutFingerprint,
  };
  for (const candidate of candidates) {
    const indicators = buildDuplicateIndicators({ existing: candidate as any, incoming });
    const sameVendorByName = Boolean(input.vendorName && candidate.vendor_name_raw
      && String(input.vendorName).trim().toLowerCase() === String(candidate.vendor_name_raw).trim().toLowerCase());
    const sameVendor = indicators.same_vendor || sameVendorByName;
    const matched = [indicators.same_normalized_reference, indicators.same_mpo_po, indicators.same_date,
      indicators.same_amount_currency, indicators.same_line_details, indicators.same_document_similarity,
      indicators.same_file_hash].filter(Boolean).length;
    const strongMatch = indicators.same_file_hash
      || (sameVendor && indicators.same_normalized_reference)
      || (indicators.same_normalized_reference && indicators.same_mpo_po)
      || matched >= 3;
    if (strongMatch) {
      return {
        invoiceId: candidate.id,
        invoiceNumber: candidate.invoice_number,
        detail: `Potential duplicate/revision of ${candidate.invoice_number}: ${indicators.reason}${sameVendor ? '' : '; vendor differs or is not yet matched'}.`,
      };
    }
  }
  return null;
}

/**
 * Run all 3 levels of duplicate detection.
 * Returns the first match found (most specific first).
 */
export async function checkEmailDuplicate(
  fileBuffer: Buffer,
  emailMetadata?: {
    internetMessageId?: string;
    conversationId?: string;
  },
  businessData?: {
    vendorName?: string;
    vendorId?: string;
    invoiceNumber?: string;
    amount?: number;
    invoiceDate?: Date | string | null;
    currency?: string;
    mpoNumber?: string;
    customerPoNumber?: string;
    lineItemsSignature?: string;
    documentLayoutFingerprint?: string;
  }
): Promise<EmailDuplicateResult> {
  // Level 1: Email Message ID
  if (emailMetadata?.internetMessageId) {
    const emailMatch = await checkByEmailMessageId(emailMetadata.internetMessageId);
    if (emailMatch) {
      logger.info(`Duplicate detected (Level 1 - Email Message ID): ${emailMatch.invoiceNumber}`);
      return {
        isDuplicate: true,
        level: 'EMAIL',
        existingInvoiceId: emailMatch.invoiceId,
        existingInvoiceNumber: emailMatch.invoiceNumber,
        detail: `Duplicate of existing invoice ${emailMatch.invoiceNumber} (same email Message ID)`,
      };
    }
  }

  // Level 2: File Hash
  const hashMatch = await checkByFileHash(fileBuffer);
  if (hashMatch) {
    logger.info(`Duplicate detected (Level 2 - File Hash): ${hashMatch.invoiceNumber}`);
    return {
      isDuplicate: true,
      level: 'FILE_HASH',
      existingInvoiceId: hashMatch.invoiceId,
      existingInvoiceNumber: hashMatch.invoiceNumber,
      detail: `Duplicate of existing invoice ${hashMatch.invoiceNumber} (identical file content)`,
    };
  }

  // Level 3: Business Key
  if (businessData?.vendorName && businessData?.invoiceNumber && businessData?.amount) {
    const businessMatch = await checkByBusinessKey(
      businessData.vendorName,
      businessData.invoiceNumber,
      businessData.amount,
      businessData.invoiceDate || null
    );
    if (businessMatch) {
      logger.info(`Duplicate detected (Level 3 - Business Key): ${businessMatch.invoiceNumber}`);
      return {
        isDuplicate: true,
        level: 'BUSINESS',
        existingInvoiceId: businessMatch.invoiceId,
        existingInvoiceNumber: businessMatch.invoiceNumber,
        detail: `Duplicate of existing invoice ${businessMatch.invoiceNumber} (same vendor + invoice number + amount)`,
      };
    }
  }

  const advancedMatch = await checkByAdvancedBusinessKey({
    ...businessData,
    fileHash: crypto.createHash('sha256').update(fileBuffer).digest('hex'),
  });
  if (advancedMatch) {
    logger.info(`Duplicate/revision candidate detected (advanced accounting controls): ${advancedMatch.invoiceNumber}`);
    return {
      isDuplicate: true,
      level: 'BUSINESS_ADVANCED',
      existingInvoiceId: advancedMatch.invoiceId,
      existingInvoiceNumber: advancedMatch.invoiceNumber,
      detail: advancedMatch.detail,
    };
  }

  return {
    isDuplicate: false,
    level: 'NONE',
    detail: 'No duplicate found',
  };
}

/**
 * Generate SHA256 hash for a file buffer (for storing as invoice_hash)
 */
export function generateFileHash(fileBuffer: Buffer): string {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}
