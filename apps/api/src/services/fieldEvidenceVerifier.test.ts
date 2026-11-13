import { describe, expect, it } from 'vitest';
import { verifyCriticalFieldEvidence } from './fieldEvidenceVerifier';

const evidence = {
  invoice_number: { page: 1, snippet: 'Invoice No. IA-12345', label_seen: 'Invoice No.' },
  total_amount: { page: 2, snippet: 'Total Amount Due USD 1,250.00', label_seen: 'Total Amount Due' },
  invoice_date: { page: 1, snippet: 'Invoice Date 12-Oct-2026', label_seen: 'Invoice Date' },
};

describe('field evidence verifier (shadow mode)', () => {
  it('verifies exact field value, page snippet, and expected label', () => {
    const result = verifyCriticalFieldEvidence({
      values: { invoice_number: 'IA-12345', total_amount: 1250, invoice_date: '2026-10-12' },
      evidence,
      pageTexts: ['Invoice No. IA-12345\nInvoice Date 12-Oct-2026', 'Total Amount Due USD 1,250.00'],
    });
    expect(result.invoice_number.status).toBe('verified');
    expect(result.total_amount.status).toBe('verified');
    expect(result.invoice_date.status).toBe('verified');
  });

  it('returns mismatch when value, snippet, or field label conflicts', () => {
    const result = verifyCriticalFieldEvidence({
      values: { invoice_number: 'PO-12345', total_amount: 1250, invoice_date: '12-Oct-2026' },
      evidence: { ...evidence, invoice_number: { ...evidence.invoice_number, label_seen: 'PO #' } },
      pageTexts: ['Invoice No. IA-12345\nInvoice Date 12-Oct-2026', 'Total Amount Due USD 1,250.00'],
    });
    expect(result.invoice_number.status).toBe('mismatch');
  });

  it('does not accept a truncated invoice number as a substring match', () => {
    const result = verifyCriticalFieldEvidence({
      values: { invoice_number: '1' },
      evidence: { ...evidence, invoice_number: { ...evidence.invoice_number, snippet: 'Invoice No. 100791637' } },
      pageTexts: ['Invoice No. 100791637', 'Total Amount Due USD 1,250.00'],
    });
    expect(result.invoice_number.status).toBe('mismatch');
    expect(result.invoice_number.reason_code).toBe('VALUE_NOT_IN_EVIDENCE_SNIPPET');
  });

  it('returns unverifiable when page OCR or field evidence is unavailable', () => {
    const result = verifyCriticalFieldEvidence({ values: { invoice_number: 'IA-12345' }, evidence, pageTexts: [] });
    expect(result.invoice_number.status).toBe('unverifiable');
    expect(result.total_amount.status).toBe('unverifiable');
  });
});
