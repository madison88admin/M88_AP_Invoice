import { describe, expect, it } from 'vitest';
import { fieldDecisionEngine } from './fieldDecisionEngine';

describe('FieldDecisionEngine line-item consensus', () => {
  it('uses per-cell majority instead of the first engine table', async () => {
    const base = { vendor_name: 'Acme', invoice_number: 'INV-1', invoice_date: '2026-07-18', total_amount: 100, currency: 'USD' };
    const result = await fieldDecisionEngine.decide([
      { engine_name: 'gemini', confidence: 80, data: { ...base, line_items: [{ material_code: 'MAT-1', quantity: 11, unit_price: 10, line_amount: 100 }] } },
      { engine_name: 'qwen', confidence: 82, data: { ...base, line_items: [{ material_code: 'MAT-1', quantity: 10, unit_price: 10, line_amount: 100 }] } },
      { engine_name: 'groq', confidence: 78, data: { ...base, line_items: [{ material_code: 'MAT-1', quantity: 10, unit_price: 10, line_amount: 100 }] } },
    ] as any);
    expect(result.final.line_items[0].quantity).toBe(10);
    expect(result.final.line_items[0].field_confidence.quantity.provenance.selection_reason).toContain('Majority');
  });
});
