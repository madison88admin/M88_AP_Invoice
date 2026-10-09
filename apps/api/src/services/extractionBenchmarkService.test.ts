import { describe, expect, it } from 'vitest';
import { compareExtractionBenchmarks, evaluateExtractionBenchmark } from './extractionBenchmarkService';

describe('evaluateExtractionBenchmark', () => {
  it('reports measured accuracy and line-level mismatches', () => {
    const result = evaluateExtractionBenchmark([{
      vendor_name: 'Acme',
      expected: { invoice_number: 'INV-1', total_amount: 100, line_items: [{ material_code: 'MAT-1', quantity: 4, unit_price: 25, line_amount: 100 }] },
      actual: { invoice_number: 'INV-1', total_amount: 100, line_items: [{ material_code: 'MAT-1', quantity: 5, unit_price: 25, line_amount: 100 }] },
    }]);
    expect(result.overall_accuracy).toBeLessThan(100);
    expect(result.straight_through_rate).toBe(0);
    expect(result.cases[0].mismatches.some(item => item.field.includes('quantity'))).toBe(true);
  });

  it('reports precision, recall, F1, missing-field coverage, and split metrics', () => {
    const result = evaluateExtractionBenchmark([{
      id: 'mixed-1', expected_document_type: 'COMMERCIAL_INVOICE', actual_document_type: 'PROFORMA',
      expected_pages: [{ start: 1, end: 1 }, { start: 2, end: 3 }], actual_pages: [{ start: 1, end: 1 }],
      expected_invoice_count: 2, actual_invoice_count: 1,
      expected: { vendor_name: 'Micro-Pak', invoice_number: '254070', invoice_date: '10/06/2026', total_amount: 100, currency: 'USD', po_number: 'PO-1' },
      actual: { vendor_name: 'Micro-Pak', invoice_number: '254070', invoice_date: '2026-10-06', total_amount: 100.004, currency: 'USD' },
    }]);
    const invoiceNumber = result.per_field.find(field => field.field === 'invoice_number');
    const po = result.per_field.find(field => field.field === 'po_number');
    expect(invoiceNumber?.f1).toBe(100);
    expect(po?.recall).toBe(0);
    expect(result.document_classification.f1).toBe(0);
    expect(result.page_split.page_recall).toBe(50);
    expect(result.confidence_coverage).toBeLessThan(100);
  });

  it('compares a challenger engine without requiring a provider call', () => {
    const base = evaluateExtractionBenchmark([{ expected: { invoice_number: 'A', total_amount: 10 }, actual: { invoice_number: 'B', total_amount: 10 } }]);
    const challenger = evaluateExtractionBenchmark([{ expected: { invoice_number: 'A', total_amount: 10 }, actual: { invoice_number: 'A', total_amount: 10 } }]);
    const comparison = compareExtractionBenchmarks(base, challenger);
    expect(comparison.challenger.f1).toBeGreaterThan(comparison.baseline.f1);
    expect(comparison.per_field.find(field => field.field === 'invoice_number')?.delta_f1).toBeGreaterThan(0);
  });
});
