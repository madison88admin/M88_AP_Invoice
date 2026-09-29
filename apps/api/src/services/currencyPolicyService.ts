/**
 * Currency intake policy
 *
 * Historically the intake paths hard-blocked anything that was not USD
 * ("Currency HKD requires manual review before invoice creation"). Valid
 * invoices from C&T (HKD), PT UWU / PT BSN (IDR), Avery (EUR), and Filipino
 * vendors (PHP) were parked in manual-review forever — 125 in a 30-day window
 * alone. The invoice data was already extracted correctly; only the currency
 * differed from the payment currency.
 *
 * New policy (env-configurable):
 * - INTAKE_CURRENCY_MODE=park        → old behavior (park non-USD in manual-review)
 * - INTAKE_CURRENCY_MODE=exception   → create the invoice record, flag it with a
 *                                      currency exception for accounting review
 * - INTAKE_CURRENCY_MODE=auto        → create + auto-convert: if the invoice shows
 *                                      a USD settlement amount or an exchange rate,
 *                                      total_amount is stored in USD; otherwise it
 *                                      keeps the original currency and still gets
 *                                      the exception flag.
 *
 * Vendor allowlist (INTAKE_VENDOR_CURRENCY_ALLOWLIST):
 *   Comma-separated currency codes that a vendor may invoice in without any
 *   exception, e.g. "HKD,IDR". Applied per-vendor through
 *   INTAKE_VENDOR_CURRENCY_MAP entries of the form "VendorName:HKD;OtherVendor:IDR,EUR".
 *
 * The payment/bank layer already handles non-USD accounts (the Vendor model has
 * per-currency account fields: account_hkd, account_eur, account_idr…), so
 * creating the record is safe — the currency exception just keeps a human in
 * the loop before posting.
 */

/**
 * USD-only amounts policy (2026-09-28):
 * Madison88 pays in USD — every stored invoice amount must be USD.
 * Non-USD intake is allowed to CREATE an invoice, but the amount is immediately
 * normalized to USD:
 *   1. `usd_equivalent` stated on the invoice (strongest — printed by the vendor)
 *   2. `exchange_rate_to_usd` stated on the invoice (e.g. "@7.70", "settle in USD @7.70")
 *   3. `INTAKE_DEFAULT_FX_RATES` env ("HKD=7.8;IDR=16500;...") as last resort
 * The original currency/amount/rate are preserved in invoice_currency_original /
 * exchange_rate_to_usd / ocr_raw_data; only the settlement fields become USD.
 */
export const DEFAULT_FX_FALLBACK: Record<string, number> = {
  HKD: 7.8,
  EUR: 0.92,
  PHP: 58,
  IDR: 16000,
  CNY: 7.2,
  VND: 25000,
  JPY: 150,
  CAD: 1.37,
  TWD: 32,
  RMB: 7.2, // common invoice alias for CNY
};

export interface UsdNormalization {
  /** USD amount to store in total_amount. */
  usdAmount: number;
  /** USD currency code to store in currency. */
  usdCurrency: 'USD';
  /** Original currency code (e.g. HKD) preserved for reference. */
  originalCurrency: string;
  /** Original non-USD amount as printed on the invoice. */
  originalAmount: number;
  /** Exchange rate used (original currency per 1 USD). */
  rateUsed: number;
  /** Where the rate/amount came from: invoice_stated_usd | invoice_stated_rate | env_fallback. */
  basis: 'invoice_stated_usd' | 'invoice_stated_rate' | 'env_fallback';
}

/** Parse "HKD=7.8;IDR=16500" → { HKD: 7.8, IDR: 16500 }. */
export function getDefaultFxRates(): Record<string, number> {
  const raw = String(process.env.INTAKE_DEFAULT_FX_RATES || '');
  const out: Record<string, number> = {};
  for (const part of raw.split(';')) {
    const [code, rate] = part.split('=');
    if (!code || !rate) continue;
    const n = Number(rate);
    if (/^[A-Z]{3}$/.test(code.trim().toUpperCase()) && Number.isFinite(n) && n > 0) {
      out[code.trim().toUpperCase()] = n;
    }
  }
  return out;
}

/**
 * Convert a non-USD invoice amount to USD. Only call when currency !== 'USD'.
 * Returns null when no conversion basis exists (caller must park the file).
 */
export function normalizeToUsd(
  currency: string,
  amount: number,
  opts?: { usdEquivalent?: number | null; exchangeRateToUsd?: number | null; usdAmountOnInvoice?: number | null }
): UsdNormalization | null {
  const code = String(currency || '').trim().toUpperCase();
  const amt = Number(amount);
  if (!code || code === 'USD' || !Number.isFinite(amt) || amt <= 0) return null;

  // 1. Invoice itself states a USD settlement amount
  const statedUsd = Number(opts?.usdEquivalent ?? opts?.usdAmountOnInvoice ?? NaN);
  if (Number.isFinite(statedUsd) && statedUsd > 0) {
    return { usdAmount: statedUsd, usdCurrency: 'USD', originalCurrency: code, originalAmount: amt, rateUsed: amt / statedUsd, basis: 'invoice_stated_usd' };
  }
  // 2. Invoice states an exchange rate
  const statedRate = Number(opts?.exchangeRateToUsd ?? NaN);
  if (Number.isFinite(statedRate) && statedRate > 0) {
    return { usdAmount: amt / statedRate, usdCurrency: 'USD', originalCurrency: code, originalAmount: amt, rateUsed: statedRate, basis: 'invoice_stated_rate' };
  }
  // 3. Env fallback table (per 1 USD), then the built-in defaults
  const envRate = getDefaultFxRates()[code] || DEFAULT_FX_FALLBACK[code];
  if (envRate && envRate > 0) {
    return { usdAmount: amt / envRate, usdCurrency: 'USD', originalCurrency: code, originalAmount: amt, rateUsed: envRate, basis: 'env_fallback' };
  }
  return null;
}

/** Currencies the extractor is known to produce reliably. */
export const KNOWN_INTAKE_CURRENCIES = ['USD', 'HKD', 'IDR', 'EUR', 'PHP', 'JPY'] as const;

export type IntakeCurrencyMode = 'park' | 'exception' | 'auto';

export function getIntakeCurrencyMode(): IntakeCurrencyMode {
  const raw = String(process.env.INTAKE_CURRENCY_MODE || 'park').toLowerCase();
  return raw === 'exception' || raw === 'auto' ? (raw as IntakeCurrencyMode) : 'park';
}

/** Parse "A:HKD;B:IDR,EUR" → Map(lowercased vendor name → Set of currencies). */
export function getVendorCurrencyMap(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const raw = String(process.env.INTAKE_VENDOR_CURRENCY_MAP || '');
  for (const entry of raw.split(';')) {
    const [vendor, currencies] = entry.split(':');
    if (!vendor || !currencies) continue;
    const codes = currencies
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(c => /^[A-Z]{3}$/.test(c));
    if (codes.length > 0) map.set(vendor.trim().toLowerCase(), new Set(codes));
  }
  return map;
}

/**
 * Global allowlist: currencies no vendor needs an exception for (comma-separated).
 * USD is always allowed implicitly.
 */
export function getGlobalCurrencyAllowlist(): Set<string> {
  const raw = String(process.env.INTAKE_CURRENCY_ALLOWLIST || '');
  const codes = raw
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(c => /^[A-Z]{3}$/.test(c));
  return new Set(['USD', ...codes]);
}

export interface CurrencyPolicyResult {
  /** true → proceed with invoice creation (park=false). */
  allowed: boolean;
  /** true → old behavior: park the file in manual-review. */
  park: boolean;
  /** Currency code the invoice arrived in (normalized). */
  currency: string;
  /** Reason for the decision — used for the exception detail / review note. */
  reason: string;
  /** Whether an exception should be attached to the created invoice. */
  needsException: boolean;
  /** Vendor-specific allowlist matched (null when none). */
  vendorAllowlisted: boolean;
}

/**
 * Decide how the intake pipeline should treat a non-USD invoice.
 * Call only when the extracted currency is known and non-USD; USD callers
 * can skip this entirely.
 */
export function evaluateCurrencyPolicy(
  currency: string | null | undefined,
  vendorName?: string | null,
  opts?: { needsCurrencyConfirmation?: boolean; hasUsdEquivalent?: boolean }
): CurrencyPolicyResult {
  const normalized = String(currency || '').trim().toUpperCase();
  const mode = getIntakeCurrencyMode();

  if (!normalized) {
    return {
      allowed: false,
      park: true,
      currency: '',
      reason: 'Currency is blank — cannot determine settlement',
      needsException: false,
      vendorAllowlisted: false,
    };
  }

  // Vendor allowlist wins first.
  if (vendorName) {
    const vendorMap = getVendorCurrencyMap();
    const vendorSet = vendorMap.get(String(vendorName).trim().toLowerCase());
    if (vendorSet?.has(normalized)) {
      return {
        allowed: true,
        park: false,
        currency: normalized,
        reason: `Vendor ${vendorName} is allowlisted for ${normalized} invoices`,
        needsException: false,
        vendorAllowlisted: true,
      };
    }
  }

  // Global allowlist.
  if (getGlobalCurrencyAllowlist().has(normalized)) {
    return {
      allowed: true,
      park: false,
      currency: normalized,
      reason: `${normalized} is on the global intake allowlist`,
      needsException: false,
      vendorAllowlisted: false,
    };
  }

  // Old behavior.
  if (mode === 'park') {
    return {
      allowed: false,
      park: true,
      currency: normalized,
      reason: `Currency ${normalized} requires manual review before invoice creation`,
      needsException: false,
      vendorAllowlisted: false,
    };
  }

  // exception / auto modes: create the record, flag it.
  // Ambiguous extractions (needs_currency_confirmation) always get the exception,
  // even in auto mode — the converter must not guess.
  const ambiguous = !!opts?.needsCurrencyConfirmation && !opts?.hasUsdEquivalent;
  return {
    allowed: true,
    park: false,
    currency: normalized,
    reason: ambiguous
      ? `Currency ${normalized} needs confirmation before posting (ambiguous extraction)`
      : `Non-USD currency ${normalized} — accounting review before posting`,
    needsException: true,
    vendorAllowlisted: false,
  };
}
