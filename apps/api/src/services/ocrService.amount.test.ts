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

  it('extracts 175.18 when the currency token sits on its own line after AMOUNT: (Combine RapidOCR layout)', async () => {
    vi.mocked((await import('./openDataLoaderService')).extractTextWithOpenDataLoader)
      .mockResolvedValueOnce([
        'COMMERCIAL INVOICE',
        'DATE:11 SEPT,2026 INVOICE NO.: S-27841',
        'MELINSALTYDOGBEANIECLIPLABEL 360pcs USD0.3300/pc USD118.80',
        'F.O.C.',
        'AMOUNT:',
        'USD175.18',
      ].join('\n'));
    const result = await extractInvoiceFields(Buffer.from('fake-pdf'));
    expect(result.amount).toBe(175.18);
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

  // Paxar/PCI per-1000 pricing, as RapidOCR actually reads it: total labels
  // are mangled ("SALE AMDUNT", "TOTALQTY", "TOTAL SHPPING"), the unit price
  // (per 1000 PCS) prints before the extended total, and the total appears
  // twice (SALE AMOUNT block + extended-price column). Pre-fix, every labeled
  // pattern missed and the fallback scored ALL candidates 0, so text order
  // picked the unit price: PCI-26036057 came out 32.61 instead of 210.01.
  const PAXAR_TEXT = [
    'Invoice',
    'INWOICE NO.',
    'PCI-26036057',
    'INWOICE DATE',
    '14 Sep 2026',
    'Unit Price calam 1000 Pcs',
    'UNTPRICE QTY SHPPED ITEMCODE DESCRIPTIONA UOM EXTENDED PRICE',
    '(PER1000PCS)',
    '6,440 MUA8 WHT F25 P/0#: PCS 32.61 210.01',
    'TOTALQTY:6,440 PCS',
    'SALE AMDUNT',
    '210.01',
    'TOTAL SHPPING',
    '0.00',
  ].join('\n');

  it('extracts 210.01 on per-1000 pricing even when every total label is OCR-mangled (Paxar/PCI)', async () => {
    vi.mocked((await import('./openDataLoaderService')).extractTextWithOpenDataLoader)
      .mockResolvedValueOnce(PAXAR_TEXT);
    const result = await extractInvoiceFields(Buffer.from('fake-pdf'));
    expect(result.amount).toBe(210.01);
  });

  it('extracts 3348.00 instead of the 0.03 unit price when the labeled USD pattern hits "USD0.027/pc" (per-PC pricing)', async () => {
    // SIC260900016 leaked 0.03 because the generic /USD\s*(…)/ labeled pattern
    // matched the unit price "USD0.027/pc" (124,000 pcs × 0.027/pc = 3,348.00)
    // before any fallback ran. Labeled patterns must skip per-unit prices.
    vi.mocked((await import('./openDataLoaderService')).extractTextWithOpenDataLoader)
      .mockResolvedValueOnce([
        'Invoice',
        'INVOICE NO. SIC260900016',
        'Unit Price: USD0.027/pc',
        '124,000 PCS 0.027 3,348.00',
        'TOTALQTY:124,000 PCS',
        'SALE AMOUNT',
        '3,348.00',
      ].join('\n'));
    const result = await extractInvoiceFields(Buffer.from('fake-pdf'));
    expect(result.amount).toBe(3348);
  });
});
