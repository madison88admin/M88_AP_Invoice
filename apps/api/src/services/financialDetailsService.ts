/**
 * Resolve the payable invoice subtotal without asking Accounting to re-key a
 * value that can be determined from the extracted financial fields.
 *
 * `subtotal` deliberately excludes bank charges. Bank charges are added by
 * the payment workflow, not used to reconstruct the goods/services subtotal.
 * When a supplier does not print a separate subtotal, the total is a safe
 * fallback only when the non-bank components do not contradict it. A caller
 * can persist the returned resolution in OCR metadata for auditability.
 */

export type FinancialSubtotalResolution = {
  subtotal: number | null;
  source: 'EXTRACTED' | 'DERIVED_FROM_TOTAL' | 'DERIVED_FROM_LINES' | 'UNRESOLVED';
  reviewRecommended: boolean;
  reason: string;
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(typeof value === 'string' ? value.replace(/,/g, '').trim() : value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const closeEnough = (a: number, b: number, tolerance = 0.02): boolean => Math.abs(a - b) <= tolerance;

export function resolveInvoiceSubtotal(input: any): FinancialSubtotalResolution {
  const explicit = toNumber(input?.subtotal);
  const roundedExplicit = explicit === null ? null : roundMoney(explicit);
  if (roundedExplicit !== null && roundedExplicit > 0) {
    return { subtotal: roundedExplicit, source: 'EXTRACTED', reviewRecommended: false, reason: 'explicit_subtotal' };
  }

  const total = toNumber(input?.total_amount ?? input?.amount);
  if (total === null || total <= 0) {
    return { subtotal: null, source: 'UNRESOLVED', reviewRecommended: true, reason: 'missing_total_amount' };
  }
  const roundedTotal = roundMoney(total);
  if (roundedTotal <= 0) {
    return { subtotal: null, source: 'UNRESOLVED', reviewRecommended: true, reason: 'total_below_cent' };
  }

  const tax = toNumber(input?.tax_amount) ?? 0;
  const freight = toNumber(input?.freight_charges) ?? 0;
  const additional = toNumber(input?.additional_charges) ?? 0;
  const discount = toNumber(input?.discount_amount) ?? 0;
  const candidate = roundMoney(total - tax - freight - additional + discount);

  const lineItems = Array.isArray(input?.line_items) ? input.line_items : [];
  const lineSum = lineItems.reduce((sum: number, line: any) => {
    const amount = toNumber(line?.line_amount ?? line?.total_amount ?? line?.extended_price);
    return amount !== null && amount >= 0 ? sum + amount : sum;
  }, 0);
  const hasLineAmounts = lineItems.length > 0 && lineSum > 0;

  // If the extracted line amounts agree with the reconstructed pre-charge
  // amount, prefer the line sum because it is the most direct subtotal proof.
  if (hasLineAmounts && closeEnough(lineSum, candidate)) {
    return {
      subtotal: roundMoney(lineSum),
      source: 'DERIVED_FROM_LINES',
      reviewRecommended: false,
      reason: 'line_amounts_reconcile_to_total',
    };
  }

  // A plain invoice total with no non-bank components is the common supplier
  // layout. Bank charges are intentionally ignored because the field label
  // says the subtotal excludes them and payment batches add them separately.
  const hasNonBankComponents = [input?.tax_amount, input?.freight_charges, input?.additional_charges, input?.discount_amount]
    .some((value) => {
      const number = toNumber(value);
      return number !== null && Math.abs(number) > 0.005;
    });
  if (!hasNonBankComponents && (!hasLineAmounts || closeEnough(lineSum, roundedTotal))) {
    return {
      subtotal: roundedTotal,
      source: 'DERIVED_FROM_TOTAL',
      reviewRecommended: false,
      reason: 'total_used_when_no_non_bank_components',
    };
  }

  // A positive tax/freight/additional/discount component can still produce a
  // deterministic subtotal, but retain a review signal if line evidence is
  // absent or conflicts. This prevents a guessed value from silently passing.
  if (candidate > 0 && (!hasLineAmounts || closeEnough(lineSum, candidate))) {
    return {
      subtotal: candidate,
      source: 'DERIVED_FROM_TOTAL',
      reviewRecommended: true,
      reason: 'derived_from_total_components_without_matching_line_evidence',
    };
  }

  return {
    subtotal: null,
    source: 'UNRESOLVED',
    reviewRecommended: true,
    reason: hasLineAmounts ? 'line_amounts_conflict_with_total_components' : 'total_components_conflict',
  };
}
