export type EvidenceState = 'verified' | 'mismatch' | 'unverifiable';
export type CriticalEvidenceField = 'invoice_number' | 'total_amount' | 'invoice_date';

const normalizeEvidence = (value: unknown) => String(value ?? '')
  .normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');

const LABEL_RULES: Record<CriticalEvidenceField, RegExp> = {
  invoice_number: /\b(invoice|inv\.?|bill)\s*(no\.?|number|#)(?:\b|(?=\W|$))/i,
  total_amount: /\b(total|amount\s*due|grand\s*total|invoice\s*total)\b/i,
  invoice_date: /\b(invoice\s*date|date\s*of\s*invoice|dated)\b/i,
};

function valueAppearsInSnippet(field: CriticalEvidenceField, value: unknown, snippet: string) {
  if (field === 'invoice_date') {
    const expected = new Date(String(value));
    if (Number.isNaN(expected.getTime())) return normalizeEvidence(snippet).includes(normalizeEvidence(value));
    const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const expectedDay = /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : dateKey(expected);
    const candidates = snippet.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/ ](?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-/ ]\d{2,4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/ig) || [];
    return candidates.some((candidate) => {
      const normalizedCandidate = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(candidate)
        ? candidate.replace(/\//g, '-')
        : candidate.replace(/-/g, ' ');
      const parsed = new Date(normalizedCandidate);
      return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === expectedDay;
    });
  }
  if (field === 'invoice_number') {
    // Invoice identifiers must match as a complete token. Substring matching
    // incorrectly accepts a truncated OCR value such as "1" for "100791637".
    const parts = String(value).match(/[a-z0-9]+/ig) || [];
    if (!parts.length) return false;
    const escapedParts = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const flexibleSeparators = '[\\s._/#-]*';
    const pattern = escapedParts.join(flexibleSeparators);
    return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, 'i').test(snippet);
  }
  if (field !== 'total_amount') return normalizeEvidence(snippet).includes(normalizeEvidence(value));
  const target = Number(value);
  if (!Number.isFinite(target)) return false;
  const amounts = snippet.match(/(?:\d[\d,.]*\d|\d)/g) || [];
  return amounts.some((raw) => {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    let normalized = raw;
    if (lastComma >= 0 && lastDot >= 0) {
      const decimal = lastComma > lastDot ? ',' : '.';
      const grouping = decimal === ',' ? /\./g : /,/g;
      normalized = raw.replace(grouping, '').replace(decimal, '.');
    } else if (lastComma >= 0) {
      normalized = raw.replace(',', '.');
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && Math.abs(parsed - target) < 0.005;
  });
}

export function verifyCriticalFieldEvidence(input: {
  values: Partial<Record<CriticalEvidenceField, unknown>>;
  evidence?: Partial<Record<CriticalEvidenceField, { page?: number | null; snippet?: string | null; label_seen?: string | null }>> | null;
  pageTexts?: string[] | null;
}) {
  const output = {} as Record<CriticalEvidenceField, { status: EvidenceState; reason_code: string; reason: string }>;
  for (const field of ['invoice_number', 'total_amount', 'invoice_date'] as const) {
    const item = input.evidence?.[field];
    const page = Number(item?.page);
    const snippet = String(item?.snippet || '').trim();
    const label = String(item?.label_seen || '').trim();
    const pageText = Number.isInteger(page) && page > 0 ? input.pageTexts?.[page - 1] : undefined;
    if (!pageText || !snippet || !label || input.values[field] === null || input.values[field] === undefined || input.values[field] === '') {
      const claimedPage = Number.isInteger(page) && page > 0;
      output[field] = { status: 'unverifiable', reason_code: claimedPage && input.pageTexts && page > input.pageTexts.length ? 'EVIDENCE_PAGE_NOT_FOUND' : 'PAGE_OCR_TEXT_UNAVAILABLE', reason: claimedPage && input.pageTexts && page > input.pageTexts.length ? 'Claimed page is not present in the page OCR text' : 'Evidence or page-level OCR text is unavailable' };
      continue;
    }
    const normalizedPage = normalizeEvidence(pageText);
    const normalizedSnippet = normalizeEvidence(snippet);
    if (!normalizedSnippet || !normalizedPage.includes(normalizedSnippet)) {
      output[field] = { status: 'mismatch', reason_code: 'SNIPPET_NOT_ON_CLAIMED_PAGE', reason: 'Evidence snippet does not occur on the claimed OCR page' };
      continue;
    }
    if (!valueAppearsInSnippet(field, input.values[field], snippet)) {
      output[field] = { status: 'mismatch', reason_code: 'VALUE_NOT_IN_EVIDENCE_SNIPPET', reason: 'Extracted value does not occur in its evidence snippet' };
      continue;
    }
    if (!LABEL_RULES[field].test(label)) {
      output[field] = { status: 'mismatch', reason_code: 'LABEL_FIELD_MISMATCH', reason: 'Printed evidence label does not match the extracted field' };
      continue;
    }
    output[field] = { status: 'verified', reason_code: 'EVIDENCE_MATCHED', reason: 'Value and label occur in the claimed page snippet' };
  }
  return output;
}
