export type FinanceEnforcementMode = 'advisory' | 'strict';

export interface FinancePolicy {
  lineRoundingTolerance: number;
  invoiceRoundingTolerance: number;
  poAmountTolerancePercent: number;
  postingWarningPercent: number;
  /** advisory (default): data-gap finance checks warn but do not block. strict: they block. */
  enforcementMode: FinanceEnforcementMode;
  /** Categories that never require an MPO/NextGen validation (NOT_APPLICABLE). */
  nonPoCategories: string[];
}

function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function boundedMode(name: string, fallback: FinanceEnforcementMode): FinanceEnforcementMode {
  const parsed = String(process.env[name] || '').trim().toLowerCase();
  return parsed === 'strict' || parsed === 'advisory' ? parsed : fallback;
}

/** Categories that are not PO-backed purchases. Finance can extend this list via env. */
export const DEFAULT_NON_PO_CATEGORIES = [
  'SAMPLE_CHARGES',
  'SHIPPING_FREIGHT',
  'LAB_TESTING',
  'FACTORY',
  'FACTORY_AUDIT',
  'PROFESSIONAL_FEE',
  'SMS',
  'CONSULTATION',
  'OTHER',
];

function parseNonPoCategories(): string[] {
  const raw = String(process.env.FINANCE_NON_PO_CATEGORIES || '').trim();
  if (!raw) return DEFAULT_NON_PO_CATEGORIES;
  return raw.split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
}

/**
 * Finance-owned deployment policy. Defaults are deliberately strict; values
 * are fractions (0.01 = 1%) and are bounded to prevent unsafe configuration.
 * Enforcement mode defaults to 'advisory' so pre-existing production data gaps
 * (missing MPO, PO invoices without line items, unpopulated NextGen quantities)
 * do not hard-block the live Finance process; Finance can flip FINANCE_ENFORCEMENT_MODE=strict
 * once the data is clean.
 */
export function getFinancePolicy(): FinancePolicy {
  return {
    lineRoundingTolerance: boundedNumber('FINANCE_LINE_ROUNDING_TOLERANCE', 0.01, 0, 1),
    invoiceRoundingTolerance: boundedNumber('FINANCE_INVOICE_ROUNDING_TOLERANCE', 0.02, 0, 1),
    poAmountTolerancePercent: boundedNumber('FINANCE_PO_AMOUNT_TOLERANCE_PCT', 0, 0, 0.1),
    postingWarningPercent: boundedNumber('FINANCE_POSTING_WARNING_PCT', 0, 0, 0.1),
    enforcementMode: boundedMode('FINANCE_ENFORCEMENT_MODE', 'advisory'),
    nonPoCategories: parseNonPoCategories(),
  };
}

/** True when the invoice category never requires an MPO/NextGen validation. */
export function isNonPOCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return getFinancePolicy().nonPoCategories.includes(String(category).trim().toUpperCase());
}
