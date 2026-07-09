import { describe, it, expect } from 'vitest';
import {
  detectVendor,
  extractVendorName,
  extractInvoiceNumber,
  extractAmount,
  extractPaymentTerms,
  extractBankDetails,
  extractMPONumber,
  extractQtyShipped,
} from './madisonInvoiceExtractor';
import { extractInvoiceDate, extractDueDate } from './extractors/dates';

// Synthetic invoice samples for regression testing. These approximate the
// structure and wording found in real G&F, Avery, and Paxar invoices.

const gAndFInvoice = `
G & F TRADING CO LTD
Invoice No: GF-2026-001234
Invoice Date: 15 May 2026
BILL TO: Madison 88 Ltd
SHIP TO: Madison 88 Ltd
Due Date: 14 Jun 2026
Payment Terms: NET 30 Days
Currency: USD
Total (USD): 12,345.67
Bank: HSBC Hong Kong
SWIFT: HSBCHKHH
A/C NO: 123456789
MPO 123456
Total Qty: 445 PCS
Line 1: 100 Each @ 50.00 = 5000.00
Line 2: 345 Each @ 21.29 = 7345.67
`;

const averyInvoice = `
Avery Dennison
I/V NO: AVERY-11718-2026
Invoice Date: 08 May 2026
BILL TO: Madison 88 Ltd
SHIP TO: Madison 88 Ltd
Credit Term: 30 Days
Total (USD): 5,250.00
MPO15371
BANK: Citibank N.A.
SWIFT: CITIUS33
A/C NO: 9988776655
TOTAL QTY : 210 PCS
Item 1: 120 Each @ 25.00 = 3000.00
Item 2: 90 Each @ 25.00 = 2250.00
`;

const paxarInvoice = `
PT. PAXAR INDONESIA
Invoice No: PAX-445-2026
Invoice Date: 22 Apr 2026
BILL TO: Madison 88 Ltd
SHIP TO: Madison 88 Ltd
Payment Terms: T.T. REMITTANCE WITHIN 30 DAYS AFTER I/V DATE
Total USD: 8,880.00
BANK: Bank Central Asia
SWIFT: CENAIDJA
A/C NO: 1122334455
MPO 987654
TOTAL QTY : 445 PCS
`;

describe('G&F invoice sample', () => {
  it('detects vendor as UNKNOWN (generic sample)', () => {
    const result = detectVendor(gAndFInvoice);
    expect(result.vendor).toBe('UNKNOWN');
  });

  it('extracts vendor name from G&F sample', () => {
    expect(extractVendorName(gAndFInvoice)).toBe('G & F TRADING CO LTD');
  });

  it('extracts invoice number', () => {
    expect(extractInvoiceNumber(gAndFInvoice)).toBe('GF-2026-001234');
  });

  it('extracts invoice date', () => {
    expect(extractInvoiceDate(gAndFInvoice)).toBe('2026-05-15');
  });

  it('extracts due date', () => {
    expect(extractDueDate(gAndFInvoice)).toBe('2026-06-14');
  });

  it('extracts payment terms', () => {
    expect(extractPaymentTerms(gAndFInvoice)).toBe('NET_30');
  });

  it('extracts MPO number', () => {
    const result = extractMPONumber(gAndFInvoice);
    expect(result.value).toBe('MPO123456');
  });

  it('extracts quantity shipped', () => {
    expect(extractQtyShipped(gAndFInvoice)).toBe(445);
  });

  it('extracts bank details', () => {
    const result = extractBankDetails(gAndFInvoice);
    expect(result.bank_name).toMatch(/HSBC/i);
    expect(result.swift_code).toBe('HSBCHKHH');
    expect(result.account_number).toBe('123456789');
  });
});

describe('Avery Dennison invoice sample', () => {
  it('detects Avery Dennison vendor', () => {
    const result = detectVendor(averyInvoice);
    expect(result.vendor).toBe('AVERY');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('returns Avery Dennison as vendor name', () => {
    expect(extractVendorName(averyInvoice)).toBe('Avery Dennison');
  });

  it('extracts invoice number', () => {
    expect(extractInvoiceNumber(averyInvoice)).toBe('AVERY-11718-2026');
  });

  it('extracts invoice date', () => {
    expect(extractInvoiceDate(averyInvoice)).toBe('2026-05-08');
  });

  it('extracts payment terms', () => {
    expect(extractPaymentTerms(averyInvoice)).toMatch(/30 DAYS/i);
  });

  it('extracts MPO number', () => {
    const result = extractMPONumber(averyInvoice, 'AVERY');
    expect(result.value).toBe('MPO015371');
  });

  it('extracts quantity shipped from line items', () => {
    expect(extractQtyShipped(averyInvoice)).toBe(210);
  });

  it('extracts bank details', () => {
    const result = extractBankDetails(averyInvoice);
    expect(result.bank_name).toMatch(/Citibank/i);
    expect(result.swift_code).toBe('CITIUS33');
    expect(result.account_number).toBe('9988776655');
  });
});

describe('Paxar invoice sample', () => {
  it('detects Paxar vendor', () => {
    const result = detectVendor(paxarInvoice);
    expect(result.vendor).toBe('PAXAR');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('extracts vendor name', () => {
    const name = extractVendorName(paxarInvoice);
    expect(name).toMatch(/PAXAR/i);
  });

  it('extracts invoice number', () => {
    expect(extractInvoiceNumber(paxarInvoice)).toBe('PAX-445-2026');
  });

  it('extracts invoice date', () => {
    expect(extractInvoiceDate(paxarInvoice)).toBe('2026-04-22');
  });

  it('extracts payment terms', () => {
    const terms = extractPaymentTerms(paxarInvoice);
    expect(terms).toMatch(/T\.T\.\s*REMITTANCE/i);
  });

  it('extracts MPO number', () => {
    const result = extractMPONumber(paxarInvoice, 'PAXAR');
    expect(result.value).toBe('MPO987654');
  });

  it('extracts quantity shipped from summary', () => {
    expect(extractQtyShipped(paxarInvoice)).toBe(445);
  });

  it('extracts bank details', () => {
    const result = extractBankDetails(paxarInvoice);
    expect(result.bank_name).toMatch(/Bank Central Asia/i);
    expect(result.swift_code).toBe('CENAIDJA');
    expect(result.account_number).toBe('1122334455');
  });
});

describe('Amount extraction sample', () => {
  it('extracts G&F total amount', () => {
    const result = extractAmount(gAndFInvoice);
    expect(result.amount).toBe(12345.67);
    expect(result.currency).toBe('USD');
  });

  it('extracts Avery total amount', () => {
    const result = extractAmount(averyInvoice);
    expect(result.amount).toBe(5250);
    expect(result.currency).toBe('USD');
  });

  it('extracts Paxar total amount', () => {
    const result = extractAmount(paxarInvoice);
    expect(result.amount).toBe(8880);
    expect(result.currency).toBe('USD');
  });
});
