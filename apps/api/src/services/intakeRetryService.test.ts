import { describe, expect, it, vi } from 'vitest';
import { analyzeWithRetry, isRetryableExtractionError, needsExtractionRetry } from './intakeRetryService';

describe('intake retry policy', () => {
  it('does not retry a classified shipping document', () => {
    expect(needsExtractionRetry({ is_non_invoice_document: true })).toBe(false);
    expect(needsExtractionRetry({ invoice_type: 'AIRWAY_BILL' })).toBe(false);
  });

  it('recognizes incomplete invoice extraction as retryable', () => {
    expect(needsExtractionRetry({ invoice_number: '', vendor_name: 'Vendor', total_amount: 10, currency: 'USD', invoice_date: new Date() })).toBe(true);
  });

  it('retries a transient provider error and returns the recovered result', async () => {
    const analyze = vi.fn()
      .mockRejectedValueOnce(new Error('provider returned 503'))
      .mockResolvedValueOnce({ invoice_number: 'INV-1', vendor_name: 'Vendor', total_amount: 10, currency: 'USD', invoice_date: new Date(), invoice_date_extracted: true });
    const onRetry = vi.fn();
    const outcome = await analyzeWithRetry(analyze, { maxAttempts: 2, baseDelayMs: 0, onRetry });
    expect(outcome.result.invoice_number).toBe('INV-1');
    expect(outcome.attempts).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not retry a permanent parsing error', async () => {
    expect(isRetryableExtractionError(new Error('invalid PDF payload'))).toBe(false);
    const analyze = vi.fn().mockRejectedValue(new Error('invalid PDF payload'));
    await expect(analyzeWithRetry(analyze, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toThrow('invalid PDF payload');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});

