import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Drive extractInvoiceFields' weighted-amount fallback with realistic
// pdf2json-style text (single spaces, no layout columns).
//
// The regression: identical strings can occur multiple times — "2026.09"
// appears both in the invoice date (2026.09.11) and as a stray column
// value on BSN commercial invoices. The old code scored the FIRST
// occurrence via indexOf, so the date's context ("Invoice No. : ...
// Date :") won with an INVOICE +80 bonus while the real "TOTAL AMOUNT"
// context was never evaluated. Amount came out as 2026.09 instead of 1.81.

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const capturedLogs: string[] = [];
const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
  capturedLogs.push(args.join(' '));
});

import { extractInvoiceFields } from './ocrService';

// BSN commercial invoice text as pdf2json flattens it (all runs joined by
// spaces). Key properties: the dotted date appears BEFORE the totals and
// also as a stray "2026.09" in the amounts column; the true total (1.81)
// sits right after the "TOTAL AMOUNT" label.
const BSN_TEXT = [
  'PT. BSN TECHNOLOGIES INDONESIA COMMERCIAL INVOICE',
  'Shipped by : PT. BSN TECHNOLOGIES INDONESIA Bill to : Madison 88, Ltd.',
  'Invoice No. : BSNINVUJI326091101 Date : 2026.09.11 Packing List No, : BSNPLUJI326091101',
  'No. PO# PRODUCT CODE Description NOTE Quantity Unit Unit Price (USD) Amount (USD)',
  '1 CSC_F27_SMS_JULY BUY_MPO016065_CL-2 PD260701485 Columbia Sportswear CSC Logo Label 95 PCS 0.019 1.81',
  'TOTAL 95 1.81',
  'FOC',
  'TOTAL AMOUNT 95 1.81',
  'Remarks : PT. BSN Technologies Indonesia only receives full payment without any deduction',
  'Kendal, 11 September 2026',
  'Beneficiary\'s Bank Information',
  'Bank Name : Bank Central Asia(BCA)',
  'Account Number USD : 009-681-8666 (USD)',
  'Swift Code : CENAIDJA',
].join(' ');

// Mock the PDF text extraction so the test exercises the field-extraction
// logic without a real PDF. vi.mock factories are hoisted above the
// const declarations, so resolve BSN_TEXT lazily at call time.
vi.mock('./openDataLoaderService', () => ({
  extractTextWithOpenDataLoader: vi.fn().mockImplementation(() => Promise.resolve(BSN_TEXT)),
}));

describe('extractInvoiceFields amount extraction (BSN column layout)', () => {
  beforeEach(() => {
    capturedLogs.length = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('extracts 1.81, not the 2026.09 date fragment', async () => {
    const result = await extractInvoiceFields(Buffer.from('fake-pdf'));
    expect(result.amount).toBe(1.81);
  });

  it('skips the date fragment even when no stray duplicate exists (old code picked 2026.09 here)', async () => {
    // Same invoice but WITHOUT the stray "2026.09" column value: the only
    // 2026.09-shaped match is the date itself. Pre-fix, indexOf resolved it
    // to the "Invoice No. / Date" context (+80 INVOICE bonus) and it won.
    vi.mocked((await import('./openDataLoaderService')).extractTextWithOpenDataLoader)
      .mockResolvedValueOnce(BSN_TEXT.replace('TOTAL AMOUNT 95 1.81', 'TOTAL AMOUNT 95'));
    const result = await extractInvoiceFields(Buffer.from('fake-pdf'));
    expect(result.amount).toBe(1.81);
    expect(result.amount).not.toBe(2026.09);
  });
});
