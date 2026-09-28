import { describe, it, expect } from 'vitest';
import {
  getPayableBlockReason,
  validatePayableDocument,
} from './payableDocumentGuard';

describe('payableDocumentGuard — getPayableBlockReason', () => {
  it('allows a plain INVOICE', () => {
    expect(getPayableBlockReason({ document_type: 'INVOICE' })).toBeNull();
  });

  it('allows PROFORMA / COMMERCIAL / SALES / DEBIT_NOTE', () => {
    expect(getPayableBlockReason({ document_type: 'PROFORMA_INVOICE' })).toBeNull();
    expect(getPayableBlockReason({ document_type: 'COMMERCIAL' })).toBeNull();
    expect(getPayableBlockReason({ document_type: 'SALES' })).toBeNull();
    expect(getPayableBlockReason({ document_type: 'DEBIT_NOTE' })).toBeNull();
  });

  it('blocks packing lists, AWBs, statements, payment advices', () => {
    expect(getPayableBlockReason({ document_type: 'PACKING_LIST' })).toMatch(/PACKING_LIST/);
    expect(getPayableBlockReason({ document_type: 'AIRWAY_BILL' })).toMatch(/AIRWAY_BILL/);
    expect(getPayableBlockReason({ document_type: 'STATEMENT' })).toMatch(/STATEMENT/);
    expect(getPayableBlockReason({ document_type: 'PAYMENT_ADVICE' })).toMatch(/PAYMENT_ADVICE/);
    expect(getPayableBlockReason({ document_type: 'UNKNOWN' })).toMatch(/UNKNOWN/);
  });

  it('blocks when OCR flags is_non_invoice_document', () => {
    const reason = getPayableBlockReason({ document_type: 'INVOICE', is_non_invoice_document: true });
    expect(reason).toMatch(/shipping\/non-invoice/);
  });

  it('blocks statement-of-account text markers even when type extraction failed', () => {
    const reason = getPayableBlockReason({
      document_type: '',
      raw_text: 'ACME Corp\nStatement of Account\nOpening Balance 1,000\nClosing Balance 2,000',
    });
    expect(reason).toMatch(/statement-of-account/);
  });

  it('filename hint blocks only when document type is NOT clearly payable', () => {
    // Type unknown + AWB filename → blocked
    expect(
      getPayableBlockReason({ document_type: '', fileName: 'HKWSO1233291_DHL_AWB.pdf' })
    ).toMatch(/non-invoice document/);

    // Same AWB filename but the body clearly says INVOICE → allowed (trust the body)
    expect(
      getPayableBlockReason({ document_type: 'INVOICE', fileName: 'HKWSO1233291_DHL_AWB.pdf' })
    ).toBeNull();
  });

  it('does not re-park valid invoices whose filename merely contains hint words', () => {
    // These were over-blocked by the old NON_INVOICE_HINTS regex
    expect(
      getPayableBlockReason({ document_type: 'INVOICE', fileName: 'INV MADISON88 TO UWU - HELLY HANSEN 6 BOX DS 2.pdf' })
    ).toBeNull();
    expect(
      getPayableBlockReason({ document_type: 'INVOICE', fileName: 'Layout approval sheet with INV-100.pdf' })
    ).toBeNull();
  });

  it('blocks classic non-invoice filenames with unknown type', () => {
    expect(getPayableBlockReason({ fileName: 'ATXFreightPackingList_THK-164107.pdf' })).toMatch(/non-invoice/);
    expect(getPayableBlockReason({ fileName: 'statement_of_account_sep.pdf' })).toMatch(/non-invoice/);
    expect(getPayableBlockReason({ fileName: 'WAYBILL_18_8168_2423.pdf' })).toMatch(/non-invoice/);
  });
});

describe('payableDocumentGuard — validatePayableDocument (RULE 20 input shape)', () => {
  it('passes a normal invoice record', () => {
    const result = validatePayableDocument({
      invoice_type: 'INVOICE',
      source_document_type: 'INVOICE',
      pdf_path: 'invoices/2026/09/123_INV-100.pdf',
      ocr_raw_data: {},
    });
    expect(result.passed).toBe(true);
  });

  it('fails a record whose source document type is PACKING_LIST', () => {
    const result = validatePayableDocument({
      invoice_type: 'INVOICE',
      source_document_type: 'PACKING_LIST',
      pdf_path: 'invoices/2026/08/123_ATXFreightPackingList.pdf',
      ocr_raw_data: {},
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/PACKING_LIST/);
  });

  it('fails a record with ocr_raw_data.is_non_invoice_document set', () => {
    const result = validatePayableDocument({
      invoice_type: 'INVOICE',
      pdf_path: 'invoices/2026/08/123.pdf',
      ocr_raw_data: { is_non_invoice_document: true },
    });
    expect(result.passed).toBe(false);
  });

  it('uses invoice_type when source_document_type is absent', () => {
    const result = validatePayableDocument({
      invoice_type: 'STATEMENT',
      pdf_path: 'invoices/2026/08/123_HSBC_statement.pdf',
      ocr_raw_data: {},
    });
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/STATEMENT/);
  });
});
