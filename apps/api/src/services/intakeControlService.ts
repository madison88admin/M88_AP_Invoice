import crypto from 'crypto';

export type ReconciliationState = 'PASS' | 'REVIEW' | 'NOT_APPLICABLE';

export interface ReconciliationResult {
  state: ReconciliationState;
  expectedTotal: number | null;
  extractedTotal: number | null;
  difference: number | null;
  tolerance: number;
  missingTerms: string[];
  evidence: Record<string, unknown>;
}

export interface IntakeControlResult {
  reasons: string[];
  reconciliation: ReconciliationResult;
  attachmentReference: boolean;
  normalized: {
    invoiceNumber?: string;
    amount?: number;
    date?: string;
    swift?: string;
    account?: string;
  };
}

/** Stable comparisons for OCR outputs. These do not perform fuzzy matching. */
export function normalizeInvoiceNumber(value: unknown): string {
  return String(value || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeSwift(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '').trim().toUpperCase();
}

export function normalizeBankAccount(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/[\s-]+/g, '').trim().toUpperCase();
}

export function normalizeDate(value: unknown, locale?: 'MDY' | 'DMY' | 'YMD'): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    const numeric = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      const year = Number(numeric[3]);
      // Do not guess for dates such as 01/02/2026. A vendor-specific locale
      // may be supplied explicitly; otherwise this is a manual-review case.
      if (!locale && first <= 12 && second <= 12) return null;
      const month = locale === 'DMY' || (!locale && first > 12) ? second : first;
      const day = locale === 'DMY' || (!locale && first > 12) ? first : second;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const parsedNumeric = new Date(Date.UTC(year, month - 1, day));
      if (parsedNumeric.getUTCFullYear() !== year || parsedNumeric.getUTCMonth() !== month - 1 || parsedNumeric.getUTCDate() !== day) return null;
      return parsedNumeric.toISOString().slice(0, 10);
    }
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Normalize numeric values while rejecting ambiguous locale strings. */
export function normalizeAmount(value: unknown, currency = 'USD'): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  const raw = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!raw) return null;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  let normalized = raw;
  if (comma >= 0 && dot >= 0) {
    // The last separator is the decimal marker; the other separator is grouping.
    const decimal = comma > dot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    normalized = raw.replace(new RegExp(`\\${grouping}`, 'g'), '').replace(decimal, '.');
  } else if (comma >= 0) {
    const digitsAfter = raw.length - comma - 1;
    // A lone 1.234/1,234 is ambiguous without a vendor locale. Refuse it.
    if (digitsAfter === 3 && currency !== 'IDR') return null;
    normalized = raw.replace(',', '.');
  } else if (dot >= 0 && raw.length - dot - 1 === 3) {
    // A lone 1.234 may mean one point two three four or one thousand
    // two-hundred thirty-four. Without the vendor locale, require review.
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function explicitTerm(rawText: string, labels: RegExp): number | null | undefined {
  if (!labels.test(rawText)) return undefined;
  const match = rawText.match(new RegExp(`${labels.source}[^0-9-]*([0-9][0-9,.]*)`, 'i'));
  if (!match) return null;
  const raw = match[1];
  if (/^0(?:[.,]0+)?$/.test(raw)) return 0;
  return normalizeAmount(raw);
}

function configuredTolerance(currency: string): number {
  const overrides = String(process.env.INTAKE_RECONCILIATION_TOLERANCES || '')
    .split(';')
    .map((part) => part.split('='))
    .reduce<Record<string, number>>((acc, [code, value]) => {
      const parsed = Number(value);
      if (code && Number.isFinite(parsed) && parsed >= 0) acc[code.trim().toUpperCase()] = parsed;
      return acc;
    }, {});
  const code = String(currency || 'USD').toUpperCase();
  return overrides[code] ?? (code === 'IDR' ? 1 : 0.01);
}

export function reconcileInvoice(result: any): ReconciliationResult {
  const currency = String(result?.currency || 'USD').toUpperCase();
  const extractedTotal = normalizeAmount(result?.total_amount, currency);
  const rawText = String(result?.raw_text || result?.raw_data?.raw_text || '');
  const terms = [
    ['freight_charges', /freight|shipping\s+charge/i],
    ['bank_charges', /bank\s+charge|bank\s+fee|wire\s+fee/i],
    ['tax_amount', /\b(?:tax|vat|gst)\b/i],
    ['discount_amount', /discount/i],
    ['additional_charges', /additional\s+charge|surcharge/i],
  ] as const;
  const values: Record<string, number | null | undefined> = {};
  const missingTerms: string[] = [];
  for (const [field, label] of terms) {
    const supplied = result?.[field];
    const parsed = supplied !== undefined && supplied !== null ? normalizeAmount(supplied, currency) : explicitTerm(rawText, label);
    values[field] = parsed;
    if (parsed === null) missingTerms.push(field);
  }

  const lineItems = Array.isArray(result?.line_items) ? result.line_items : [];
  const lineSum = lineItems.length > 0
    ? lineItems.reduce((sum: number, line: any) => {
      const amount = normalizeAmount(line?.amount ?? line?.line_total ?? line?.total, currency);
      return amount === null ? sum : sum + amount;
    }, 0)
    : null;
  const subtotal = normalizeAmount(result?.subtotal, currency);
  const expectedBase = subtotal ?? lineSum;
  if (extractedTotal === null || expectedBase === null) {
    return {
      state: missingTerms.length > 0 ? 'REVIEW' : 'NOT_APPLICABLE',
      expectedTotal: expectedBase,
      extractedTotal,
      difference: null,
      tolerance: configuredTolerance(currency),
      missingTerms,
      evidence: { currency, line_sum: lineSum, subtotal, terms: values },
    };
  }

  const additions = ['freight_charges', 'bank_charges', 'tax_amount', 'additional_charges']
    .reduce((sum, field) => sum + (typeof values[field] === 'number' ? values[field] as number : 0), 0);
  const discount = typeof values.discount_amount === 'number' ? values.discount_amount : 0;
  const expectedTotal = Number((expectedBase + additions - discount).toFixed(2));
  const difference = Number((extractedTotal - expectedTotal).toFixed(2));
  const tolerance = configuredTolerance(currency);
  return {
    state: missingTerms.length > 0 || Math.abs(difference) > tolerance ? 'REVIEW' : 'PASS',
    expectedTotal,
    extractedTotal,
    difference,
    tolerance,
    missingTerms,
    evidence: { currency, line_sum: lineSum, subtotal, terms: values },
  };
}

export function hasReferencedAttachment(result: any): boolean {
  const rawText = String(result?.raw_text || result?.raw_data?.raw_text || '');
  return /\b(?:see|refer(?:ence)?|provided|included)\s+(?:the\s+)?(?:attached|attachment|bank\s+advice|debit\s+note|supporting\s+document)|on\s+attachment|account\s+number.*attachment/i.test(rawText);
}

export function buildIntakeIdempotencyKey(messageId: unknown, fileHash: unknown): string {
  return crypto.createHash('sha256').update(`${String(messageId || 'unknown').trim()}|${String(fileHash || '').trim()}`).digest('hex');
}

export function compareEngineFields(primary: any, fallback: any): string[] {
  const fields = ['invoice_number', 'vendor_name', 'total_amount', 'currency', 'invoice_date', 'swift_code', 'account_number'];
  return fields.filter((field) => {
    const a = field === 'invoice_number' ? normalizeInvoiceNumber(primary?.[field]) : field === 'swift_code' ? normalizeSwift(primary?.[field]) : field === 'account_number' ? normalizeBankAccount(primary?.[field]) : field === 'invoice_date' ? normalizeDate(primary?.[field]) : field === 'total_amount' ? normalizeAmount(primary?.[field], primary?.currency) : String(primary?.[field] || '').trim().toUpperCase();
    const b = field === 'invoice_number' ? normalizeInvoiceNumber(fallback?.[field]) : field === 'swift_code' ? normalizeSwift(fallback?.[field]) : field === 'account_number' ? normalizeBankAccount(fallback?.[field]) : field === 'invoice_date' ? normalizeDate(fallback?.[field]) : field === 'total_amount' ? normalizeAmount(fallback?.[field], fallback?.currency) : String(fallback?.[field] || '').trim().toUpperCase();
    return a !== null && b !== null && a !== '' && b !== '' && a !== b;
  });
}

export function evaluateIntakeControls(result: any): IntakeControlResult {
  const reconciliation = reconcileInvoice(result);
  const reasons: string[] = [];
  if (hasReferencedAttachment(result) && result?.supporting_attachment_present !== true) {
    reasons.push('Invoice references an attachment/bank advice/debit note that was not included in the processed job.');
  }
  if (reconciliation.state === 'REVIEW') {
    reasons.push(`Invoice total reconciliation requires review${reconciliation.missingTerms.length ? `; unread terms: ${reconciliation.missingTerms.join(', ')}` : ''}.`);
  }
  const inputPages = Number(result?.input_pages ?? result?.page_count ?? result?.raw_data?.input_pages);
  const processedPages = Number(result?.processed_pages ?? result?.pages_processed ?? result?.raw_data?.processed_pages);
  if (Number.isFinite(inputPages) && Number.isFinite(processedPages) && inputPages > 0 && processedPages >= 0 && inputPages !== processedPages) {
    reasons.push(`Page coverage is incomplete (${processedPages} of ${inputPages} pages processed).`);
  }
  return {
    reasons,
    reconciliation,
    attachmentReference: hasReferencedAttachment(result),
    normalized: {
      invoiceNumber: normalizeInvoiceNumber(result?.invoice_number),
      amount: normalizeAmount(result?.total_amount, result?.currency) ?? undefined,
      date: normalizeDate(result?.invoice_date) || undefined,
      swift: normalizeSwift(result?.swift_code || result?.bank_info?.swift_code) || undefined,
      account: normalizeBankAccount(result?.account_number || result?.bank_info?.account_number || result?.bank_info?.account_usd) || undefined,
    },
  };
}
