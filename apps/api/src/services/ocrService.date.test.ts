import { describe, expect, it, vi } from 'vitest';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

vi.spyOn(console, 'log').mockImplementation(() => {});

// Mutable text holder so each test can swap the OCR text; vi.mock factories
// are hoisted above module scope, so they must read through this reference.
const state = vi.hoisted(() => ({ text: '' }));

vi.mock('./openDataLoaderService', () => ({
  extractTextWithOpenDataLoader: vi.fn(() => Promise.resolve(state.text)),
}));

import { extractInvoiceFields } from './ocrService';

// Real flattened pdf2json text from S-27841M-MADISON 88(MN).pdf (Combine
// Products commercial invoice) — the header carries "DATE: 11 SEPT, 2026",
// which no previously supported format matched.
const S27841M = [
  'DATE: 11 SEPT, 2026 INVOICE NO.: S-27841 ORDER NUMBER: AS BELOW P.I. NUMBER: A40565 SHIP MODE: DHL SHIPMENT TERMS: EX-WORKS',
  'USD118.80 USD175.18 AMOUNT: F.O.C. F.O.C. F.O.C. F.O.C. PO# MN-POFW27AMA-MPO16063rev.1 196pcs',
  'COMMERCIAL INVOICE Combine Products International Ltd MADISON 88, LTD USD0.1800/pc',
  'INVOICE RECEIVED DATE: 09/11/2026',
].join(' ');

// Real flattened pdf2json text from Fineline_INV#8637175.pdf — the only date
// on the page is the weekday-prefixed ship/order date "Tuesday, September 8, 2026".
const FINELINE = [
  'Terms: 156 Customer PO: 8637175 Ship To: 2923489 Invoice: $20.00 $4.59 / 1000 Shipping & Handling: $20.00',
  'Customer Id: MIN ORDER CHARGE $17.30 / 1000 Ext Price: Order #: Description: Tuesday, September 8, 2026 MIN ORDER CHARGE',
  'FineLine Technologies 2935 Courier Place Denver, CO 80205 United States Order Placed By: Order Date:',
].join(' ');

// Real flattened pdf2json text from hasanbPCI26036057-PCI26036057.pdf (Avery
// Dennison RBIS / Paxar layout). The labels "INVOICE NO. INVOICE DATE" sit in
// a column far from their values; the only parseable date tokens are the
// floating "14 Sep 2026" / "INVOICE DUE 14 Oct 2026" pair.
const PAXAR = [
  'MADISON LIMITED 2433 CURTIS STREET, 2 FLOOR, DENVER CO 80205 Invoice BILL TO  : PCI-26036057 14 Sep 2026 PT UWU JUMP INDONESIA',
  'INVOICE NO. INVOICE DATE Notes : Please remit your payment to : RBO  :  THE NORTH FACE PSO/26501256 SO NO  :',
  'INVOICE DUE 14 Oct 2026 CREDIT TERM 30 Days P/0 # : TNFF26AUGBUY_MPO016076_MUA8_A8PY6_INDONESIA',
  'VAT TOTAL  USD 0.00 210.01 0.00 210.01 SALE AMOUNT',
].join(' ');

// Scanned (image-only) Combine invoice: no embedded text layer at all.
const SCANNED = '';

describe('extractInvoiceFields date extraction — parked-manual-review regression batch', () => {
  // NOTE: extractInvoiceFields returns invoice_date/due_date. Month-name
  // dates are normalized to ISO YYYY-MM-DD at capture time (glued OCR tokens
  // like "010911" once parsed downstream as year 2001); numeric-only strings
  // pass through for the consensus normalizers.
  it('captures "DATE: 11 SEPT, 2026" (Combine S-27841M) as ISO 2026-09-11', async () => {
    state.text = S27841M;
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026-09-11');
  });

  it('prefers the labeled "DATE: 11 SEPT, 2026" over a later unlabeled "14 Sep 2026"', async () => {
    state.text = S27841M + ' CAD 200.00 issued 14 Sep 2026 for reference';
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026-09-11');
  });

  it('captures weekday-prefixed "Tuesday, September 8, 2026" (FineLine) as ISO 2026-09-08', async () => {
    state.text = FINELINE;
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026-09-08');
  });

  it('uses the unlabeled "14 Sep 2026" (Paxar) — not the 6-digit YYMMDD fallback on PCI-26036057', async () => {
    state.text = PAXAR;
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026-09-14');
    expect(result.due_date).toBe('2026-10-14');
  });

  it('captures the RapidOCR-squashed "DATE:11SEPT,2026" (no space after colon/comma, or day-month)', async () => {
    // Exact RapidOCR token lines from S-27841M: one token per line, spaces
    // after ':' and ',' swallowed by OCR — and across runs the day-month
    // space is swallowed too ("11SEPT"), which once let the 6-digit fallback
    // capture "010911" and parse it as year 2001.
    state.text = ['COMMERCIAL INVOICE', 'DATE:11SEPT,2026', 'INVOICE NO.: S-27841', 'AMOUNT:', 'USD175.18'].join('\n');
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026-09-11');
  });

  it('captures DD-Mon-YY "Invoice Date 11-Sep-26" (Super Dry Marine PI, 2-digit year) as ISO 2026-09-11', async () => {
    // Exact RapidOCR token lines from "PI MADISON 88 TO UWU ARCTERYX DS 2 62 BOX.pdf".
    state.text = [
      'SUPERDRY PTSUPERDRYMARINE',
      'Sales Invoice',
      'Invoice No : SlC260900016',
      'Invoice Date 11-Sep-26',
      'Ship Date',
      '11-Sep-26',
      'Terms',
      'Net 30',
    ].join('\n');
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026-09-11');
  });

  it('skips the bank-account 6-digit fragment and captures the signature stamp 2026.07.20 (A40274/A40355 layout)', async () => {
    // Real RapidOCR shape of the no-printed-date Combine proformas: the only
    // dates are the digital-signature stamp and the bank account whose middle
    // segment (201456) the old 6-digit fallback captured, poisoning the date.
    state.text = [
      'PROFORMA INVOICE',
      'P/I NO.',
      'DATE',
      'ORDER NO.',
      'A40274',
      'USD465.50',
      'BANKCHARGES',
      'USD30.00',
      'ETD-8/10/26',
      'Invoice Received: 7/23/26',
      'Bank Account No.:012-561-9-201456-0',
      '2026.07.20',
      'AMOUNT:',
      'USD2,359.60',
    ].join('\n');
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('2026.07.20');
    const d = new Date(result.invoice_date as string);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
  });

  it('skips the bank-account fragment and captures the slash date (A40285 layout)', async () => {
    state.text = [
      'PROFORMAINVOICE',
      'P/I NO.',
      'DATE',
      'ORDER NO.',
      'A40285',
      '9/7/2026',
      'Bank Account No.:012-561-9-201456-0',
      'RECEIVED:07/09/26',
      'AMOUNT:',
      'USD55.00',
    ].join('\n');
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_date).toBe('9/7/2026');
  });

  it('errors on scanned (image-only) text instead of fabricating a date', async () => {
    // A scanned PDF yields no text layer: OpenDataLoader returns <20 chars,
    // pdf2json cannot parse the raw buffer, and the regex engine fails —
    // production then routes the file to RapidOCR. No date is invented.
    state.text = '';
    await expect(extractInvoiceFields(Buffer.from('fake'))).rejects.toThrow();
  });
});
