export type WorkflowTransitionContext = {
  duplicateReviewStatus?: string | null;
  documentType?: string | null;
  allowCorrection?: boolean;
};

const TERMINAL = new Set(['PAID', 'CANCELLED', 'REJECTED']);
const NON_PAYABLE = new Set(['PROFORMA_REVIEW', 'NON_PAYABLE_REVIEW']);
const PAYMENT_STAGES = new Set(['APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID']);

/**
 * Enforce the accounting invariants without requiring every feature to know
 * the entire state machine. Normal workflow steps remain flexible, while
 * terminal, non-payable, and duplicate-review records cannot silently jump
 * into payment.
 */
export function validateWorkflowTransition(from: string | null | undefined, to: string | null | undefined, context: WorkflowTransitionContext = {}): { ok: boolean; reason?: string } {
  const previous = String(from || 'RECEIVED').toUpperCase();
  const next = String(to || previous).toUpperCase();
  if (previous === next) return { ok: true };
  if (TERMINAL.has(previous) && !context.allowCorrection) {
    return { ok: false, reason: `${previous} records are immutable and cannot transition to ${next}.` };
  }
  if (NON_PAYABLE.has(previous) && PAYMENT_STAGES.has(next)) {
    return { ok: false, reason: `${previous} documents cannot advance to a payable/payment stage.` };
  }
  if (['DUPLICATE_REVIEW', 'REVISION_REVIEW'].includes(previous) && PAYMENT_STAGES.has(next)) {
    return { ok: false, reason: `${previous} must be resolved before posting or payment.` };
  }
  if (context.duplicateReviewStatus?.toUpperCase() === 'PENDING' && PAYMENT_STAGES.has(next)) {
    return { ok: false, reason: 'Invoices with a pending duplicate/revision review cannot advance to posting or payment.' };
  }
  if (['DUPLICATE_SUBMISSION', 'CONFIRMED_DUPLICATE'].includes(String(context.duplicateReviewStatus || '').toUpperCase()) && PAYMENT_STAGES.has(next)) {
    return { ok: false, reason: 'Confirmed duplicate submissions cannot advance to posting or payment.' };
  }
  return { ok: true };
}
