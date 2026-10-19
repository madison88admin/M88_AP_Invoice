import prisma from '../config/database';

/**
 * Normalizes supplier references for duplicate/revision review only. The
 * original printed reference is never overwritten.
 *
 * Examples: 0001-A, 0001-REV, and 0001 REV become the same review key while
 * keeping the distinction available in the source invoice number.
 */
export function normalizeInvoiceReference(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  const withoutRevision = compact.replace(/(?:REV(?:ISION)?|CORR(?:ECTED)?|REPLACEMENT)$/i, '');
  return withoutRevision
    .replace(/^0+(?=\d)/, '')
    .replace(/^([A-Z]+)0+(?=\d)/, '$1');
}

export function calculateRetentionUntil(createdAt: Date = new Date(), years = 7): Date {
  const result = new Date(createdAt);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

export type DuplicateReviewClassification = 'NEW_INVOICE' | 'CORRECTED_REVISED' | 'REPLACEMENT' | 'DUPLICATE_SUBMISSION';

export interface DuplicateIndicators {
  same_vendor: boolean;
  same_normalized_reference: boolean;
  same_mpo_po: boolean;
  same_date: boolean;
  same_amount_currency: boolean;
  same_line_details: boolean;
  same_document_similarity: boolean;
  same_file_hash: boolean;
  reason: string;
}

/**
 * Mark a newly ingested record for duplicate/revision review using an
 * existing candidate.  Intake callers use this after the new PDF and AP
 * record have been committed; the candidate is never replaced or cancelled.
 */
export async function createDuplicateRevisionReviewFromCandidate(input: {
  invoiceId: string;
  candidateInvoiceId: string;
  incoming: {
    vendor_id?: string | null;
    invoice_number?: string | null;
    mpo_number?: string | null;
    customer_po_number?: string | null;
    invoice_date?: Date | null;
    total_amount?: unknown;
    currency?: string | null;
    invoice_hash?: string | null;
    line_items_signature?: string | null;
    document_layout_fingerprint?: string | null;
  };
  reason?: string;
}): Promise<any | null> {
  if (input.invoiceId === input.candidateInvoiceId) return null;
  const existing = await prisma.invoice.findUnique({
    where: { id: input.candidateInvoiceId },
    select: {
      id: true,
      vendor_id: true,
      normalized_invoice_number: true,
      invoice_number: true,
      mpo_number: true,
      customer_po_number: true,
      invoice_date: true,
      total_amount: true,
      currency: true,
      invoice_hash: true,
      line_items_signature: true,
      document_layout_fingerprint: true,
    },
  });
  if (!existing) return null;
  const indicators = buildDuplicateIndicators({ existing, incoming: input.incoming });
  return createDuplicateRevisionReview({
    invoiceId: input.invoiceId,
    candidateInvoiceId: existing.id,
    indicators,
    reason: input.reason || `Incoming invoice ${input.incoming.invoice_number || ''} matches existing record ${existing.invoice_number}; Purchasing Coordinator classification required.`,
  });
}

export function buildDuplicateIndicators(input: {
  existing: { vendor_id?: string | null; normalized_invoice_number?: string | null; invoice_number?: string | null; mpo_number?: string | null; customer_po_number?: string | null; invoice_date?: Date | null; total_amount?: unknown; currency?: string | null; invoice_hash?: string | null; line_items_signature?: string | null; document_layout_fingerprint?: string | null };
  incoming: { vendor_id?: string | null; invoice_number?: string | null; mpo_number?: string | null; customer_po_number?: string | null; invoice_date?: Date | null; total_amount?: unknown; currency?: string | null; invoice_hash?: string | null; line_items_signature?: string | null; document_layout_fingerprint?: string | null };
}): DuplicateIndicators {
  const sameVendor = Boolean(input.existing.vendor_id && input.incoming.vendor_id && input.existing.vendor_id === input.incoming.vendor_id);
  const existingRef = input.existing.normalized_invoice_number || normalizeInvoiceReference(input.existing.invoice_number);
  const incomingRef = normalizeInvoiceReference(input.incoming.invoice_number);
  const sameReference = Boolean(existingRef && incomingRef && existingRef === incomingRef);
  const existingMpo = String(input.existing.mpo_number || input.existing.customer_po_number || '').trim().toUpperCase();
  const incomingMpo = String(input.incoming.mpo_number || input.incoming.customer_po_number || '').trim().toUpperCase();
  const sameMpo = Boolean(existingMpo && incomingMpo && existingMpo === incomingMpo);
  const existingDate = input.existing.invoice_date ? input.existing.invoice_date.toISOString().slice(0, 10) : '';
  const incomingDate = input.incoming.invoice_date ? input.incoming.invoice_date.toISOString().slice(0, 10) : '';
  const sameDate = Boolean(existingDate && incomingDate && existingDate === incomingDate);
  const sameAmountCurrency = Number(input.existing.total_amount ?? NaN) === Number(input.incoming.total_amount ?? NaN)
    && String(input.existing.currency || 'USD').toUpperCase() === String(input.incoming.currency || 'USD').toUpperCase();
  const sameLineDetails = Boolean(input.existing.line_items_signature && input.incoming.line_items_signature
    && input.existing.line_items_signature === input.incoming.line_items_signature);
  const sameDocumentSimilarity = Boolean(input.existing.document_layout_fingerprint && input.incoming.document_layout_fingerprint
    && input.existing.document_layout_fingerprint === input.incoming.document_layout_fingerprint);
  const sameFileHash = Boolean(input.existing.invoice_hash && input.incoming.invoice_hash && input.existing.invoice_hash === input.incoming.invoice_hash);
  const matched = [sameReference, sameMpo, sameDate, sameAmountCurrency, sameLineDetails, sameDocumentSimilarity, sameFileHash].filter(Boolean).length;
  return {
    same_vendor: sameVendor,
    same_normalized_reference: sameReference,
    same_mpo_po: sameMpo,
    same_date: sameDate,
    same_amount_currency: sameAmountCurrency,
    same_line_details: sameLineDetails,
    same_document_similarity: sameDocumentSimilarity,
    same_file_hash: sameFileHash,
    reason: sameFileHash
      ? 'Exact file hash match'
      : `${matched}/7 duplicate indicators matched${sameReference ? '; normalized invoice reference matches' : ''}${sameMpo ? '; MPO/PO matches' : ''}${sameLineDetails ? '; line details match' : ''}${sameDocumentSimilarity ? '; document layout is similar' : ''}`,
  };
}

/**
 * Creates an auditable duplicate/revision review and blocks downstream
 * approval/payment until Purchasing records a classification.
 */
export async function createDuplicateRevisionReview(input: {
  invoiceId: string;
  candidateInvoiceId?: string;
  indicators: DuplicateIndicators;
  reason?: string;
}): Promise<any> {
  const review = await prisma.duplicateRevisionReview.create({
    data: {
      invoice_id: input.invoiceId,
      candidate_invoice_id: input.candidateInvoiceId || null,
      status: 'PENDING',
      reason: input.reason || input.indicators.reason,
      matching_indicators: input.indicators as any,
    },
  });
  await prisma.invoice.update({
    where: { id: input.invoiceId },
    data: {
      duplicate_review_status: 'PENDING',
      duplicate_review_reason: input.reason || input.indicators.reason,
      is_duplicate: true,
      workflow_status: 'DUPLICATE_REVIEW',
    } as any,
  });
  return review;
}

export async function resolveDuplicateRevisionReview(input: {
  reviewId: string;
  classification: DuplicateReviewClassification;
  reviewerId: string;
  reason: string;
  evidence?: unknown;
}): Promise<any> {
  const review = await prisma.duplicateRevisionReview.findUnique({ where: { id: input.reviewId } });
  if (!review) throw new Error('Duplicate/revision review not found');
  const resolved = await prisma.$transaction(async (tx) => {
    const updated = await tx.duplicateRevisionReview.update({
      where: { id: review.id },
      data: {
        status: 'RESOLVED',
        classification: input.classification,
        reason: input.reason,
        evidence: input.evidence as any,
        reviewer_id: input.reviewerId,
        reviewed_at: new Date(),
      },
    });
    const isDuplicate = input.classification === 'DUPLICATE_SUBMISSION';
    await tx.invoice.update({
      where: { id: review.invoice_id },
      data: {
        duplicate_review_status: input.classification,
        duplicate_review_reason: input.reason,
        duplicate_reviewed_by: input.reviewerId,
        duplicate_reviewed_at: new Date(),
        is_duplicate: isDuplicate,
        workflow_status: isDuplicate
          ? 'CANCELLED'
          : input.classification === 'NEW_INVOICE' ? 'RECEIVED' : 'REVIEW_REQUIRED',
        status: isDuplicate ? 'CANCELLED' : undefined,
      } as any,
    });
    return updated;
  });
  return resolved;
}

