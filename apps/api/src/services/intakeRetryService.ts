import { logger } from '../utils/logger';

export type ExtractionLike = {
  invoice_number?: string;
  vendor_name?: string;
  total_amount?: number;
  currency?: string;
  invoice_date?: unknown;
  invoice_date_extracted?: boolean;
  is_non_invoice_document?: boolean;
  invoice_type?: string;
  document_type?: string;
};

export interface ExtractionRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  label?: string;
  onRetry?: (attempt: number, reason: string) => Promise<void> | void;
}

/**
 * A result is retryable only when it still looks like an invoice but one of
 * the required accounting fields is missing. Shipping documents and other
 * deliberate manual-review classifications are never sent through another
 * AI call.
 */
export function needsExtractionRetry(result: ExtractionLike | null | undefined): boolean {
  if (!result || result.is_non_invoice_document) return false;
  const type = String(result.invoice_type || result.document_type || '').toUpperCase();
  if (['AIRWAY_BILL', 'PACKING_LIST', 'DELIVERY_RECEIPT', 'STATEMENT', 'OTHER'].includes(type)) return false;
  const amount = Number(result.total_amount);
  return !String(result.invoice_number || '').trim()
    || !String(result.vendor_name || '').trim()
    || !Number.isFinite(amount)
    || amount <= 0
    || !String(result.currency || '').trim()
    || result.invoice_date_extracted === false
    || !result.invoice_date;
}

function completenessScore(result: ExtractionLike | null | undefined): number {
  if (!result) return -1;
  return [
    String(result.invoice_number || '').trim(),
    String(result.vendor_name || '').trim(),
    Number.isFinite(Number(result.total_amount)) && Number(result.total_amount) > 0,
    String(result.currency || '').trim(),
    Boolean(result.invoice_date) && result.invoice_date_extracted !== false,
  ].filter(Boolean).length;
}

/** Retry only errors that are commonly transient provider/network failures. */
export function isRetryableExtractionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(timeout|timed out|429|rate limit|5\d\d|503|502|network|socket|fetch failed|econn|temporar|provider|quota|overloaded)/i.test(message);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));

/**
 * Run the complete OCR/fallback stack with bounded retries. The first good
 * result wins; an incomplete result is retained as a safe fallback if later
 * attempts fail. This keeps provider outages from creating zero/placeholder
 * invoices while still allowing transient failures to recover automatically.
 */
export async function analyzeWithRetry<T extends ExtractionLike>(
  analyze: () => Promise<T>,
  options: ExtractionRetryOptions = {},
): Promise<{ result: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts ?? process.env.INTAKE_OCR_RETRY_ATTEMPTS ?? 3)));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? process.env.INTAKE_OCR_RETRY_DELAY_MS ?? 1500));
  const label = options.label || 'OCR extraction';
  let best: T | null = null;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await analyze();
      if (!best || completenessScore(result) > completenessScore(best)) best = result;
      if (!needsExtractionRetry(result)) return { result, attempts: attempt };
      lastError = new Error('Required invoice fields remain incomplete');
      if (attempt < maxAttempts) {
        const reason = 'Required invoice fields remain incomplete';
        await options.onRetry?.(attempt + 1, reason);
        logger.warn(`[IntakeRetry] ${label} attempt ${attempt}/${maxAttempts} incomplete; retrying`);
        await sleep(baseDelayMs * attempt);
      }
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableExtractionError(error)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      await options.onRetry?.(attempt + 1, reason);
      logger.warn(`[IntakeRetry] ${label} attempt ${attempt}/${maxAttempts} failed; retrying: ${reason}`);
      await sleep(baseDelayMs * attempt);
    }
  }

  if (best) return { result: best, attempts: maxAttempts };
  throw lastError instanceof Error ? lastError : new Error(`${label} failed after ${maxAttempts} attempts`);
}
