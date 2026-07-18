import { describe, expect, it } from 'vitest';
import { evaluateExtractionBenchmark } from './extractionBenchmarkService';

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
});
