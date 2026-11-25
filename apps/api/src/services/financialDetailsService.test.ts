import { describe, expect, it } from 'vitest';
import { resolveInvoiceSubtotal } from './financialDetailsService';

describe('resolveInvoiceSubtotal', () => {
  it('keeps an extracted subtotal', () => {
    expect(resolveInvoiceSubtotal({ subtotal: 1950, total_amount: 1962, bank_charges: 12 })).toMatchObject({
      subtotal: 1950, source: 'EXTRACTED', reviewRecommended: false,
    });
  });

  it('uses total when a supplier has no separate subtotal or non-bank charges', () => {
    expect(resolveInvoiceSubtotal({ total_amount: 41.16, bank_charges: 30 })).toMatchObject({
      subtotal: 41.16, source: 'DERIVED_FROM_TOTAL', reviewRecommended: false,
    });
  });

  it('uses reconciled line amounts as the subtotal', () => {
    expect(resolveInvoiceSubtotal({ total_amount: 110, tax_amount: 10, line_items: [
      { line_amount: 100 },
    ] })).toMatchObject({ subtotal: 100, source: 'DERIVED_FROM_LINES', reviewRecommended: false });
  });

  it('derives a subtotal from known non-bank components and keeps a review signal', () => {
    expect(resolveInvoiceSubtotal({ total_amount: 110, tax_amount: 10 })).toMatchObject({
      subtotal: 100, source: 'DERIVED_FROM_TOTAL', reviewRecommended: true,
    });
  });

  it('does not invent a subtotal when line evidence conflicts', () => {
    const result = resolveInvoiceSubtotal({
      total_amount: 110,
      tax_amount: 10,
      line_items: [{ line_amount: 80 }],
    });
    expect(result).toMatchObject({ subtotal: null, source: 'UNRESOLVED', reviewRecommended: true });
  });
});
