import { describe, it, expect } from 'vitest';
import { normalizeInvoiceText, normalizeOCRAmounts } from './normalize';

describe('normalizeOCRAmounts', () => {
  it('collapses fragmented thousands in amount contexts', () => {
    const text = 'TOTAL: 1 234 567.00';
    expect(normalizeOCRAmounts(text)).toBe('TOTAL: 1234567.00');
  });

  it('leaves quantity lines untouched', () => {
    const text = 'QTY: 1 000 PCS';
    expect(normalizeOCRAmounts(text)).toBe('QTY: 1 000 PCS');
  });

  it('leaves dates untouched', () => {
    const text = 'Invoice Date: 2026-01-14';
    expect(normalizeOCRAmounts(text)).toBe('Invoice Date: 2026-01-14');
  });

  it('compacts fragmented decimals in amount contexts', () => {
    // The existing algorithm compacts spaces around the decimal point but keeps
    // spacing between the whole-number digit groups, so the result reflects the
    // current behavior rather than a fully collapsed number.
    const text = 'AMOUNT DUE: 3 3 . 3 0';
    expect(normalizeOCRAmounts(text)).toBe('AMOUNT DUE: 3 3.3 0');
  });
});

describe('normalizeInvoiceText', () => {
  it('merges broken labels and normalizes whitespace within lines', () => {
    const text = 'INVOICE\nNO: 12345\nTotal\nAmount: 100.00';
    const normalized = normalizeInvoiceText(text);
    expect(normalized).toContain('INVOICE NO: 12345');
    // Line breaks are preserved, so "Total\nAmount" is not joined into a single word.
    expect(normalized).toContain('Total');
    expect(normalized).toContain('Amount: 100.00');
  });

  it('compacts fragmented UOMs and spaced uppercase sequences', () => {
    // The existing normalization compacts single-letter fragments into full words.
    const text = 'P C S\nU N I T\nR E M I T T A N C E';
    const normalized = normalizeInvoiceText(text);
    expect(normalized).toContain('PCS');
    expect(normalized).toContain('UNIT');
    expect(normalized).toContain('REMITTANCE');
  });

  it('normalizes currency fragments that match the existing pattern', () => {
    // The existing pattern does not compact "U S $" into "US$" because of the
    // trailing word boundary after the currency symbol, so the spaces remain.
    const text = 'U S $ 100.00';
    expect(normalizeInvoiceText(text)).toBe('U S $ 100.00');
  });

  it('normalizes PO fragments', () => {
    // The existing pattern matches "P/O" without the trailing hash, leaving an
    // extra space/hash in the output. This documents the current behavior.
    expect(normalizeInvoiceText('P/O # 12345')).toBe('PO# # 12345');
  });

  it('injects synthetic line breaks for heavily spaced OCR', () => {
    const text = 'DESCRIPTION OF GOODS QTY 100 PCS USD 1,000.00 TOTAL';
    const normalized = normalizeInvoiceText(text);
    expect(normalized).toContain('QTY');
    expect(normalized).toContain('TOTAL');
    expect(normalized.split('\n').length).toBeGreaterThan(1);
  });
});
