import { describe, expect, it } from 'vitest';
import { extractFieldConfidence } from './analyticsService';

describe('analytics field confidence extraction', () => {
  it('reads current field-decision confidence values', () => {
    expect(extractFieldConfidence({ field_decision: { fields: { invoice_number: { final_confidence: 92 } } } }, 'invoice_number')).toBe(92);
  });

  it('supports legacy extraction confidence wrappers and aliases', () => {
    expect(extractFieldConfidence({ extraction: { field_confidence: { purchase_order_number: { confidence: 0.81 } } } }, 'po_number')).toBe(81);
  });

  it('uses the overall OCR score only when the field has a persisted value', () => {
    expect(extractFieldConfidence({}, 'vendor_name', 0.88)).toBe(88);
    expect(extractFieldConfidence({}, 'vendor_name')).toBeNull();
  });
});
