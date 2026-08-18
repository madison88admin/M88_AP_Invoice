import { describe, expect, it } from 'vitest';
import { validateMultiMpoAllocations } from './multiMpoControlService';

describe('validateMultiMpoAllocations', () => {
  it('reconciles separate subtotals for multiple MPOs', () => {
    const result = validateMultiMpoAllocations({ invoice_lines: [
      { line_number: 1, mpo_base_number: 'MPO001', mpo_order_sequence: '1', material_code: 'A', matched_nextgen_line_id: 'ng1', match_status: 'MATCHED', quantity: 2, unit_price: 10, nextgen_unit_price: 10, line_amount: 20 },
      { line_number: 2, mpo_base_number: 'MPO002', mpo_order_sequence: '1', material_code: 'B', matched_nextgen_line_id: 'ng2', match_status: 'MATCHED', quantity: 3, unit_price: 5, nextgen_unit_price: 5, line_amount: 15 },
    ] });
    expect(result.issues).toEqual([]);
    expect(result.subtotals).toEqual([
      { mpo: 'MPO001', subtotal: 20, quantity: 2, lineCount: 1 },
      { mpo: 'MPO002', subtotal: 15, quantity: 3, lineCount: 1 },
    ]);
  });

  it('blocks unmatched, UOM-mismatched and cumulative over-invoiced lines', () => {
    const result = validateMultiMpoAllocations({ invoice_lines: [{
      line_number: 1, mpo_base_number: 'MPO001', mpo_order_sequence: '1', material_code: 'A',
      quantity: 11, unit_price: 10, nextgen_unit_price: 9, line_amount: 110,
      unit_of_measure: 'PCS', nextgen_unit_of_measure: 'KG', remaining_receivable_quantity: 10,
      remaining_invoiceable_amount: 100,
    }] });
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'MPO_LINE_UNMATCHED', 'UOM_MISMATCH', 'PO_PRICE_MISMATCH', 'OVER_CUMULATIVE_QUANTITY', 'OVER_CUMULATIVE_AMOUNT',
    ]));
  });
});
