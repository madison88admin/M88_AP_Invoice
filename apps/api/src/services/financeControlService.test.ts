import { describe, expect, it } from 'vitest';
import { validateFinanceArithmetic, financeIssueIsBlocking } from './financeControlService';

const invoice = (overrides: any = {}) => ({
  invoice_type: 'INVOICE', mpo_number: 'MPO1', subtotal: 20, total_amount: 20,
  invoice_lines: [{ line_number: 1, mpo_base_number: 'MPO1', mpo_order_sequence: '1', material_code: 'MAT1', matched_nextgen_line_id: 'NG1', match_status: 'MATCHED', quantity: 2, unit_price: 10, nextgen_unit_price: 10, line_amount: 20, received_quantity: 2, remaining_receivable_quantity: 2 }],
  ...overrides,
});

describe('validateFinanceArithmetic', () => {
  it('accepts an exactly reconciled invoice', () => expect(validateFinanceArithmetic(invoice())).toEqual([]));

  it('blocks line arithmetic differences', () => {
    const issues = validateFinanceArithmetic(invoice({ invoice_lines: [{ line_number: 1, quantity: 2, unit_price: 10, line_amount: 21 }] }));
    expect(issues.some(issue => issue.code === 'LINE_ARITHMETIC')).toBe(true);
  });

  it('blocks quantities above the received and remaining balance', () => {
    const issues = validateFinanceArithmetic(invoice({ invoice_lines: [{ line_number: 1, quantity: 3, unit_price: 10, line_amount: 30, received_quantity: 2, remaining_receivable_quantity: 1 }], subtotal: 30, total_amount: 30 }));
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['OVER_RECEIVED', 'OVER_REMAINING']));
  });

  it('reconciles discounts and classified charges to the stated total', () => {
    expect(validateFinanceArithmetic(invoice({ discount_amount: 2, freight_charges: 5, tax_amount: 1, total_amount: 24 }))).toEqual([]);
  });

  it('requires line-level data for a PO-backed invoice', () => {
    expect(validateFinanceArithmetic(invoice({ invoice_lines: [] }))).toContainEqual(expect.objectContaining({ code: 'LINE_INCOMPLETE' }));
  });
});

describe('financeIssueIsBlocking', () => {
  it('blocks only invoice-internal arithmetic errors in advisory mode (default)', () => {
    expect(financeIssueIsBlocking({ code: 'LINE_ARITHMETIC', detail: 'x' })).toBe(true);
    expect(financeIssueIsBlocking({ code: 'TOTAL_ARITHMETIC', detail: 'x' })).toBe(true);
    expect(financeIssueIsBlocking({ code: 'LINE_INCOMPLETE', detail: 'x' })).toBe(false);
    expect(financeIssueIsBlocking({ code: 'OVER_RECEIVED', detail: 'x' })).toBe(false);
    expect(financeIssueIsBlocking({ code: 'OVER_REMAINING', detail: 'x' })).toBe(false);
    expect(financeIssueIsBlocking({ code: 'MPO_CONTROL', detail: 'x' })).toBe(false);
  });

  it('blocks every finance issue in strict mode', () => {
    expect(financeIssueIsBlocking({ code: 'LINE_INCOMPLETE', detail: 'x' }, 'strict')).toBe(true);
    expect(financeIssueIsBlocking({ code: 'MPO_CONTROL', detail: 'x' }, 'strict')).toBe(true);
  });
});
