import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { validateInvoice } from './validationService';

const COORDINATOR_REVISION_STATUSES = new Set([
  'RECEIVED', 'OCR_PROCESSING', 'VALIDATION_PENDING', 'EXCEPTION_FLAGGED', 'PENDING_COORDINATOR',
]);
const PAYMENT_PROTECTED_STATUSES = new Set([
  'APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID', 'PAYMENT_CONFIRMATION_SENT',
]);
const PAYMENT_PROTECTED_WORKFLOW_STATUSES = new Set([
  'APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID',
]);

function revisionBlocked(message: string): never {
  throw new AppError(message, 409);
}

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
  const resolutionTime = new Date();
  const { resolved, revisedInvoiceId } = await prisma.$transaction(async (tx) => {
    const review = await tx.duplicateRevisionReview.findUnique({ where: { id: input.reviewId } });
    if (!review) throw new Error('Duplicate/revision review not found');
    if (review.status !== 'PENDING') revisionBlocked('This duplicate/revision review has already been resolved.');

    const newInvoice = await tx.invoice.findUnique({
      where: { id: review.invoice_id },
      include: { payments: { select: { id: true, status: true, batch_id: true } } },
    });
    if (!newInvoice) throw new Error('Revision invoice not found');

    let oldInvoice: any = null;
    if (input.classification === 'CORRECTED_REVISED') {
      if (!review.candidate_invoice_id) revisionBlocked('A corrected revision must be linked to the original invoice candidate.');
      if (!COORDINATOR_REVISION_STATUSES.has(String(newInvoice.status))) {
        revisionBlocked('The incoming document has moved beyond coordinator review and cannot be activated as a revision.');
      }
      if (!['RECEIVED', 'OCR_PROCESSING', 'REVIEW_REQUIRED', 'PURCHASING_REVIEW', 'DUPLICATE_REVIEW', 'REVISION_REVIEW'].includes(String(newInvoice.workflow_status))) {
        revisionBlocked('The incoming document is protected or outside coordinator review and cannot be activated as a revision.');
      }
      oldInvoice = await tx.invoice.findUnique({
        where: { id: review.candidate_invoice_id },
        include: { payments: { select: { id: true, status: true, batch_id: true } } },
      });
      if (!oldInvoice) revisionBlocked('The original invoice candidate no longer exists.');
      if (oldInvoice.vendor_id !== newInvoice.vendor_id
        || normalizeInvoiceReference(oldInvoice.invoice_number) !== normalizeInvoiceReference(newInvoice.invoice_number)) {
        revisionBlocked('The candidate vendor or invoice reference does not match; the revision cannot replace it.');
      }
      if (oldInvoice.legal_hold || (oldInvoice.payments || []).length > 0
        || PAYMENT_PROTECTED_STATUSES.has(String(oldInvoice.status).toUpperCase())
        || PAYMENT_PROTECTED_WORKFLOW_STATUSES.has(String(oldInvoice.workflow_status).toUpperCase())) {
        revisionBlocked('The original invoice is protected by approval, payment, posting, or legal hold and cannot be replaced.');
      }
      if ((newInvoice.payments || []).length > 0 || newInvoice.legal_hold) {
        revisionBlocked('The incoming revision is already linked to a payment or legal hold and cannot be activated.');
      }
    }

    // A corrected PDF replaces the whole active duplicate family, not only
    // the first candidate returned by duplicate detection. This prevents
    // older sibling rows for the same vendor/reference from remaining visible
    // as payable invoices after the new revision is activated.
    let supersededInvoices: any[] = [];
    let nextRevision = 1;
    if (input.classification === 'CORRECTED_REVISED' && oldInvoice) {
      const normalizedReference = normalizeInvoiceReference(newInvoice.invoice_number);
      if (!normalizedReference) revisionBlocked('The corrected revision must have a valid invoice number before duplicate records can be replaced.');
      const siblings = await tx.invoice.findMany({
        where: {
          vendor_id: newInvoice.vendor_id,
          id: { not: newInvoice.id },
          status: { not: 'CANCELLED' },
          OR: [
            { normalized_invoice_number: normalizedReference },
            { invoice_number: { in: [newInvoice.invoice_number, oldInvoice.invoice_number] } },
          ],
        },
        include: { payments: { select: { id: true, status: true, batch_id: true } } },
      });
      const family = [oldInvoice, ...(siblings || [])].filter((candidate, index, all) =>
        candidate
        && all.findIndex((other) => other?.id === candidate.id) === index
        && candidate.vendor_id === newInvoice.vendor_id
        && normalizeInvoiceReference(candidate.invoice_number) === normalizedReference,
      );
      for (const candidate of family) {
        if (candidate.legal_hold || (candidate.payments || []).length > 0
          || PAYMENT_PROTECTED_STATUSES.has(String(candidate.status).toUpperCase())
          || PAYMENT_PROTECTED_WORKFLOW_STATUSES.has(String(candidate.workflow_status).toUpperCase())) {
          revisionBlocked(`Invoice ${candidate.invoice_number} is protected by approval, payment, posting, or legal hold; resolve it before activating this revision.`);
        }
      }
      supersededInvoices = family;
      nextRevision = Math.max(0, ...family.map((candidate) => Number(candidate.revision || 1))) + 1;
    }

    const claim = await tx.duplicateRevisionReview.updateMany({
      where: { id: review.id, status: 'PENDING' },
      data: { status: 'RESOLVED' },
    });
    if (claim.count !== 1) revisionBlocked('This duplicate/revision review was already resolved by another user.');

    const updated = await tx.duplicateRevisionReview.update({
      where: { id: review.id },
      data: {
        status: 'RESOLVED',
        classification: input.classification,
        reason: input.reason,
        evidence: input.evidence as any,
        reviewer_id: input.reviewerId,
        reviewed_at: resolutionTime,
      },
    });
    const isDuplicate = input.classification === 'DUPLICATE_SUBMISSION';
    const invoice = await tx.invoice.update({
      where: { id: newInvoice.id },
      data: {
        ...(input.classification === 'CORRECTED_REVISED' ? {
          parent_invoice_id: oldInvoice.id,
          revision: nextRevision,
          status: 'RECEIVED',
          workflow_status: 'RECEIVED',
          duplicate_review_status: 'RESOLVED',
        } : {
          duplicate_review_status: input.classification,
          workflow_status: isDuplicate
            ? 'CANCELLED'
            : input.classification === 'NEW_INVOICE' ? 'RECEIVED' : 'REVIEW_REQUIRED',
          status: isDuplicate ? 'CANCELLED' : undefined,
        }),
        duplicate_review_reason: input.reason,
        duplicate_reviewed_by: input.reviewerId,
        duplicate_reviewed_at: resolutionTime,
        is_duplicate: isDuplicate,
      } as any,
    });
    if (input.classification === 'CORRECTED_REVISED' && oldInvoice) {
      for (const priorInvoice of supersededInvoices) {
        await tx.duplicateRevisionReview.updateMany({
          where: { invoice_id: priorInvoice.id, status: 'PENDING' },
          data: {
            status: 'RESOLVED',
            classification: 'SUPERSEDED_BY_CORRECTED_REVISION',
            reason: `Superseded by corrected revision ${newInvoice.invoice_number}`,
            reviewer_id: input.reviewerId,
            reviewed_at: resolutionTime,
          },
        });
        await tx.invoice.update({
          where: { id: priorInvoice.id },
          data: {
            status: 'CANCELLED',
            workflow_status: 'SUPERSEDED',
            duplicate_review_status: 'SUPERSEDED',
            is_duplicate: true,
            cancelled_by: input.reviewerId,
            cancelled_at: resolutionTime,
            cancellation_reason: `Superseded by corrected revision ${newInvoice.invoice_number} (revision ${nextRevision})`,
          } as any,
        });
        await tx.auditLog.create({
          data: {
            invoice_id: priorInvoice.id,
            performed_by: input.reviewerId,
            action: 'INVOICE_SUPERSEDED_BY_CORRECTED_REVISION',
            note: input.reason,
            metadata: { replacement_invoice_id: newInvoice.id, replacement_revision: nextRevision },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          invoice_id: newInvoice.id,
          performed_by: input.reviewerId,
          action: 'CORRECTED_REVISION_ACTIVATED',
          note: input.reason,
          metadata: { superseded_invoice_ids: supersededInvoices.map((candidate) => candidate.id), revision: nextRevision },
        },
      });
    }
    return { resolved: updated, revisedInvoiceId: input.classification === 'CORRECTED_REVISED' ? invoice.id : null };
  });

  // Re-run validation only after the atomic activation/supersede transaction.
  // A failed rule leaves the new revision visible for coordinator correction;
  // it never rolls back or deletes either retained source document.
  if (revisedInvoiceId) {
    try {
      await validateInvoice(revisedInvoiceId, { freshRevision: true });
    } catch (error) {
      await prisma.invoice.update({
        where: { id: revisedInvoiceId },
        data: { status: 'EXCEPTION_FLAGGED', workflow_status: 'REVIEW_REQUIRED' } as any,
      });
      await prisma.auditLog.create({
        data: {
          invoice_id: revisedInvoiceId,
          performed_by: input.reviewerId,
          action: 'CORRECTED_REVISION_REVALIDATION_FAILED',
          note: error instanceof Error ? error.message : 'Fresh validation failed',
          metadata: { review_id: input.reviewId },
        },
      });
      throw new AppError('The corrected revision was activated and the prior record retained as superseded, but fresh validation failed. The new invoice is held for coordinator review; retry validation.', 503);
    }
  }
  return resolved;
}

