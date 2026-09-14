import { describe, expect, it, vi, beforeEach } from 'vitest';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

// Mutable text holder so each test can swap the OCR text; vi.mock factories
// are hoisted above module scope, so they must read through this reference.
const state = vi.hoisted(() => ({ text: '' }));

vi.mock('./openDataLoaderService', () => ({
  extractTextWithOpenDataLoader: vi.fn(() => Promise.resolve(state.text)),
}));

import { extractInvoiceFields } from './ocrService';

// Combine Products International proforma invoices flatten (pdf2json) with
// the P/I number detached from its "P/I NO." / "ORDER NO." labels —
// "P/I NO. UNIT PRICE DENVER CO, 80205 ... A40319 DATE ...". Real text
// taken from COMBINE_A40319T.pdf / COMBINE_A40428M.pdf on the VPS.
const COMBINE_A40319T = [
  'Combine Products International Ltd MADISON 88 Bank Information : Bank Account No.: 012-561-9-201456-0',
  'Bank Address: 1 Garden Road, Hong Kong Bank Swift Code: BKCHHKHHXXX Holder Name: Combine Products International Limited',
  'Bank of China (Hong Kong) Limited USD2.80 AMOUNT: M-DOT 13X19(V-HAT)R QUANTITY AMOUNT DESCRIPTION MARMOT USD0.0280/pc 100pcs',
  'COL: (BLACK/SLEET STORM MARMOT PO03036_MPO015937 ML_INDO TERMS OF SALE USD2.80 PROFORMA INVOICE JAWA BARAT INDONESIA',
  'TEL: 0260-7609110 ATTN: JOANNA MADISON 88 EX-WORKS 2433 CURITS STREET, 2 FLOOR, 15/7/2026 TEL: 843-816-3860 ORDER NO.',
  'GUNUNGSARI KEC PAGADEN KAB SUBANG A40319 DATE PAYMENT TERMS NET 30 DAYS P/I NO. UNIT PRICE DENVER CO, 80205 U.S.A.',
  'Combine Products International Ltd Room 6, 9/F, Block A, Wah Tat Industrial Centre, 8-10 Wah Sing Street, Kwai Chung,',
  'Hong Kong Tel : (852) 2423 4113 Fax: (852) 2494 8596 PT UWU JUMP INDONESIA SHIP TO: BILL TO: KP JATIRAWING RT 13 RW 06',
  'DESA MARMOT PO03036_MPO015937 ML_INDO INVOICE RECEIVED DATE: 09/11/2026',
].join(' ');

const COMBINE_A40428M = [
  '100pcs HEMP STRING -- EA-HSC11 USD0.0130/pc Combine Products International Ltd Room 6, 9/F, Block A, Wah Tat Industrial Centre,',
  '8-10 Wah Sing Street, Kwai Chung, Hong Kong Tel : (852) 2423 4113 Fax: (852) 2494 8596 SHIP TO: PROFORMA INVOICE USD1.30',
  'DESCRIPTION DATE TERMS OF SALE ORDER NO. P/I NO. A40428 QUANTITY NET 30 DAYS EX-WORKS AMOUNT UNIT PRICE BILL TO: AS BELOW',
  '7/8/2026 ATTN: MARICON ALVAREZ MADISON 88, LTD KP. JATIRAWING RT 13 RW 06, DESA GUNUNGSARI, PT. UWU JUMP INDONESIA',
  'PAYMENT TERMS Bank Swift Code: BKCHHKHHXXX USD31.30 KEC. PAGADEN, KAB. SUBANG, JAWA BARAT, INDONESIA',
  'Bank Information : PO# BUR-SMS-MPO16046 DENVER CO, 80205 U.S.A. 2433 CURITS STREET, 2 FLOOR, TEL: 843-816-3860',
  '41252, NPWP:71.009.591.0-439.000 ATTN: TRACY TEL: 0260-7609110 BURTON : BANK CHARGES AMOUNT: Bank Address: 1 Garden Road, Hong Kong',
  'MADISON 88, LTD Bank of China (Hong Kong) Limited Holder Name: Combine Products International Limited USD30.00',
  'Bank Account No.: 012-561-9-201456-0 Combine Products International Ltd BURTON PO02992_MPO016046 HS_INDO INVOICE RECEIVED DATE: 09/09/26',
].join(' ');

describe('extractInvoiceFields invoice-number extraction (proforma layout)', () => {
  it('finds A40319 in the detached Combine proforma layout', async () => {
    state.text = COMBINE_A40319T;
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_number).toBe('A40319');
  });

  it('finds A40428 and never picks PO/MPO tokens', async () => {
    state.text = COMBINE_A40428M;
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_number).toBe('A40428');
    expect(result.invoice_number).not.toMatch(/MPO|PO0/);
  });

  it('extracts A40319 from one-token-per-line RapidOCR-style text', async () => {
    // Production consensus runs on RapidOCR output: one token per line,
    // no spaces, labels far from values.
    state.text = [
      'Combine Products International Ltd',
      'PROFORMAINVOICE',
      'BILL TO:',
      'P/I NO.',
      'ORDER NO.',
      'PAYMENT TERMS',
      'MARMOT',
      'A40319',
      '15/7/2026',
      'PO03036_MPO015937',
      'NET 30 DAYS',
      'INVOICERECEIVEDDATE:09/11/2026',
      'USD2.80',
    ].join('\n');
    const result = await extractInvoiceFields(Buffer.from('fake'));
    expect(result.invoice_number).toBe('A40319');
  });
});
