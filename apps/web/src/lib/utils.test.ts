import { describe, expect, it } from 'vitest';
import { formatCurrency, normalizeCurrencyCode } from './utils';

describe('currency formatting', () => {
  it('normalizes composite OCR currency values to the primary ISO code', () => {
    expect(normalizeCurrencyCode('USD/CAD')).toBe('USD');
    expect(formatCurrency(12.5, 'USD/CAD')).toContain('$12.50');
  });

  it('falls back safely when an imported currency is invalid', () => {
    expect(normalizeCurrencyCode('ZZZ')).toBe('USD');
    expect(formatCurrency(12.5, 'ZZZ')).toContain('$12.50');
  });
});
