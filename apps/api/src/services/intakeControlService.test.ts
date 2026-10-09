import { describe, expect, it } from 'vitest';
import {
  buildIntakeIdempotencyKey,
  compareEngineFields,
  evaluateIntakeControls,
  normalizeAmount,
  normalizeDate,
  normalizeInvoiceNumber,
  normalizeSwift,
  reconcileInvoice,
  validateInvoiceDateOrder,
} from './intakeControlService';
import { classifySameNumberMatch } from './duplicateDetectionService';

describe('intake controls', () => {
  it('normalizes exact duplicate keys without fuzzy matching', () => {
    expect(normalizeInvoiceNumber('  sc-26-01977 ')).toBe('SC-26-01977');
    expect(normalizeSwift(' abcd hk hh  ')).toBe('ABCDHKHH');
    expect(buildIntakeIdempotencyKey('message-1', 'hash-1')).toBe(buildIntakeIdempotencyKey('message-1', 'hash-1'));
    expect(buildIntakeIdempotencyKey('message-1', 'hash-1')).not.toBe(buildIntakeIdempotencyKey('message-2', 'hash-1'));
  });

  it('does not guess ambiguous invoice dates', () => {
    expect(normalizeDate('01/02/2026')).toBeNull();
    expect(normalizeDate('01/02/2026', 'MDY')).toBe('2026-01-02');
    expect(normalizeDate('01/02/2026', 'DMY')).toBe('2026-02-01');
  });

  it('flags due dates that precede invoice dates', () => {
    expect(validateInvoiceDateOrder('2026-10-06', '2026-05-11').valid).toBe(false);
    const result = evaluateIntakeControls({ invoice_date: '2026-10-06', due_date: '2026-05-11', total_amount: 10, subtotal: 10, tax_amount: 0, raw_text: '' });
    expect(result.reasons.some(reason => reason.includes('precedes invoice date'))).toBe(true);
  });

  it('rejects ambiguous grouped amounts and preserves explicit currency rules', () => {
    expect(normalizeAmount('1.234', 'USD')).toBeNull();
    expect(normalizeAmount('1.234', 'IDR')).toBeNull();
  });

  it('flags a 0.02 USD reconciliation gap', () => {
    const result = reconcileInvoice({
      currency: 'USD',
      subtotal: 100,
      tax_amount: 0,
      freight_charges: 0,
      bank_charges: 0,
      additional_charges: 0,
      discount_amount: 0,
      total_amount: 100.02,
    });
    expect(result.state).toBe('REVIEW');
    expect(result.difference).toBe(0.02);
  });

  it('distinguishes null/unread terms from explicit zero', () => {
    const unread = reconcileInvoice({ currency: 'USD', subtotal: 100, total_amount: 100, raw_text: 'Subtotal 100 Tax' });
    expect(unread.state).toBe('REVIEW');
    expect(unread.missingTerms).toContain('tax_amount');
    const explicitZero = reconcileInvoice({ currency: 'USD', subtotal: 100, total_amount: 100, tax_amount: 0 });
    expect(explicitZero.state).toBe('PASS');
    expect(explicitZero.missingTerms).not.toContain('tax_amount');
  });

  it('flags missing referenced attachments and incomplete page coverage', () => {
    const result = evaluateIntakeControls({
      currency: 'USD',
      subtotal: 100,
      total_amount: 100,
      raw_text: 'Please see attached bank advice.',
      supporting_attachment_present: false,
      input_pages: 3,
      processed_pages: 2,
    });
    expect(result.reasons.some((reason) => reason.includes('attachment'))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('Page coverage'))).toBe(true);
  });

  it('reports normalized disagreement for changed SWIFT and amount', () => {
    const differences = compareEngineFields(
      { swift_code: 'ABCDHKHH', total_amount: '100.00', currency: 'USD' },
      { swift_code: 'EFGHSGSG', total_amount: '100.02', currency: 'USD' },
    );
    expect(differences).toEqual(expect.arrayContaining(['swift_code', 'total_amount']));
  });

  it('routes same-number amount/date changes to manual review instead of silent duplicate acceptance', () => {
    expect(classifySameNumberMatch({
      existingAmount: 100,
      incomingAmount: 100.02,
      existingDate: new Date('2026-09-01T00:00:00Z'),
      incomingDate: new Date('2026-09-01T00:00:00Z'),
    }).duplicateType).toBe('SAME_NUMBER_DIFFERENT_AMOUNT');
    expect(classifySameNumberMatch({
      existingAmount: 100,
      incomingAmount: 100,
      existingDate: new Date('2026-09-01T00:00:00Z'),
      incomingDate: new Date('2026-09-02T00:00:00Z'),
    }).duplicateType).toBe('SAME_NUMBER_DIFFERENT_DATE');
  });
});
