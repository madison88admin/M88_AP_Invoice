import { describe, it, expect } from 'vitest';
import {
  filenameIsHardExcluded,
  getPayableBlockReason,
  validatePayableDocument,
} from './payableDocumentGuard';

describe('payableDocumentGuard — getPayableBlockReason', () => {
  it('allows a plain INVOICE', () => {
    expect(getPayableBlockReason({ document_type: 'INVOICE' })).toBeNull();
  });

  it('allows SALES / DEBIT_NOTE but blocks proforma documents', () => {
    expect(getPayableBlockReason({ document_type: 'PROFORMA_INVOICE' })).toMatch(/PROFORMA_INVOICE/);
    expect(getPayableBlockReason({ document_type: 'SALES' })).toBeNull();
    expect(getPayableBlockReason({ document_type: 'DEBIT_NOTE' })).toBeNull();
    expect(getPayableBlockReason({ document_type: 'COMMERCIAL' })).toMatch(/COMMERCIAL/);
    expect(getPayableBlockReason({ document_type: 'TECH_PACK' })).toMatch(/TECH_PACK/);
    expect(getPayableBlockReason({ document_type: 'TRIM_RECEIPT' })).toMatch(/TRIM_RECEIPT/);
    expect(getPayableBlockReason({ document_type: 'FAKTUR_PAJAK' })).toMatch(/FAKTUR_PAJAK/);
    expect(getPayableBlockReason({ document_type: 'FORWARDER_BILLING_INVOICE' })).toMatch(/FORWARDER_BILLING_INVOICE/);
    expect(getPayableBlockReason({ document_type: 'EXPEDITORS_BILLING_INVOICE' })).toMatch(/EXPEDITORS_BILLING_INVOICE/);
  });

  it('blocks packing lists, AWBs, statements, payment advices', () => {
    expect(getPayableBlockReason({ document_type: 'PACKING_LIST' })).toMatch(/PACKING_LIST/);
    expect(getPayableBlockReason({ document_type: 'AIRWAY_BILL' })).toMatch(/AIRWAY_BILL/);
    expect(getPayableBlockReason({ document_type: 'STATEMENT' })).toMatch(/STATEMENT/);
    expect(getPayableBlockReason({ document_type: 'PAYMENT_ADVICE' })).toMatch(/PAYMENT_ADVICE/);
    expect(getPayableBlockReason({ document_type: 'SHIPMENT_RECEIPT' })).toMatch(/SHIPMENT_RECEIPT/);
    expect(getPayableBlockReason({ document_type: 'BILL_PAYMENT' })).toMatch(/BILL_PAYMENT/);
    expect(getPayableBlockReason({ document_type: 'UNKNOWN' })).toMatch(/UNKNOWN/);
  });

  it('blocks when OCR flags is_non_invoice_document', () => {
    const reason = getPayableBlockReason({ document_type: 'INVOICE', is_non_invoice_document: true });
    expect(reason).toMatch(/shipping\/non-invoice/);
  });

  it('trusts the OCR document classification over a relabeled INVOICE type', () => {
    expect(getPayableBlockReason({
      document_type: 'INVOICE',
      document_classification: {
        document_type: 'PACKING_LIST',
        payable_candidate: false,
        confidence: 0.99,
      },
    })).toMatch(/classification PACKING_LIST/);
  });

  it('blocks an unknown classification before an invoice record can be created', () => {
    expect(getPayableBlockReason({
      document_type: 'INVOICE',
      document_classification: {
        document_type: 'UNKNOWN',
        payable_candidate: false,
        confidence: 0.30,
      },
    })).toMatch(/classification UNKNOWN/);
  });

  it('blocks statement-of-account text markers even when type extraction failed', () => {
    const reason = getPayableBlockReason({
      document_type: '',
      raw_text: 'ACME Corp\nStatement of Account\nOpening Balance 1,000\nClosing Balance 2,000',
    });
    expect(reason).toMatch(/statement-of-account/);
  });

  it('hard-excluded filename blocks even when document type is clearly payable', () => {
    // Type unknown + AWB filename → blocked
    expect(
      getPayableBlockReason({ document_type: '', fileName: 'HKWSO1233291_DHL_AWB.pdf' })
    ).toMatch(/non-invoice document/);

    // The customer-specified AWB exclusion remains blocked even if OCR says INVOICE.
    expect(
      getPayableBlockReason({ document_type: 'INVOICE', fileName: 'HKWSO1233291_DHL_AWB.pdf' })
    ).toMatch(/excluded non-invoice/);
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
    expect(getPayableBlockReason({ fileName: 'Commercial_Invoice_2026-01.pdf' })).toMatch(/non-invoice/);
    expect(getPayableBlockReason({ fileName: 'Faktur_Pajak_E832798169.pdf' })).toMatch(/non-invoice/);
    expect(getPayableBlockReason({ fileName: 'TechPack_SS27.pdf' })).toMatch(/non-invoice/);
    expect(getPayableBlockReason({ fileName: 'Trim_Receipt_PO-123.pdf' })).toMatch(/non-invoice/);
  });

  it('hard-blocks all customer-specified filenames even when OCR says INVOICE', () => {
    const fileNames = [
      'Air_Way_Bill_123.pdf',
      'Packing_List_123.pdf',
      'Commercial_Invoice_2026-01.pdf',
      'TechPack_SS27.pdf',
      'Trim_Receipt_PO-123.pdf',
      'FAKTUR_PAJAK_E832798169.pdf',
      "Forwarder's_Billing_Invoice_Expeditors_123.pdf",
      'EXPEDITORS_BILLING_INVOICE_123.pdf',
    ];
    for (const fileName of fileNames) {
      expect(filenameIsHardExcluded(fileName)).toBe(true);
      expect(getPayableBlockReason({ document_type: 'INVOICE', fileName }, { skipFilenameHints: true })).toMatch(/excluded non-invoice/);
    }
  });

  it('hard-blocks forwarder billing invoices even when OCR says INVOICE', () => {
    const fileNames = [
      "Forwarder's Billing Invoice.pdf",
      'Forwarders_Billing_Invoice_Expeditors.pdf',
      'EXPEDITOR_BILLING_INVOICE_123.pdf',
    ];
    for (const fileName of fileNames) {
      expect(filenameIsHardExcluded(fileName)).toBe(true);
      expect(getPayableBlockReason({ document_type: 'INVOICE', fileName }, { skipFilenameHints: true })).toMatch(/excluded non-invoice/);
    }
  });

  it('blocks forwarder billing invoice headings even when OCR labels the type as invoice', () => {
    const reason = getPayableBlockReason({
      document_type: 'INVOICE',
      raw_text: "FORWARDER'S BILLING INVOICE\nInvoice No: FWD-123\nTOTAL USD 100.00",
    });
    expect(reason).toMatch(/excluded non-invoice/);
  });

  it('blocks shipment receipt and bill payment headings even when OCR labels them as invoices', () => {
    expect(getPayableBlockReason({ document_type: 'INVOICE', raw_text: 'SHIPMENT RECEIPT\nOrder: PO-123' })).toMatch(/shipment receipt/i);
    expect(getPayableBlockReason({ document_type: 'INVOICE', raw_text: 'BILL PAYMENT\nPayment Reference: BP-123' })).toMatch(/bill payment/i);
    expect(getPayableBlockReason({ document_type: 'INVOICE', fileName: 'Shipment_Receipt_123.pdf' }, { skipFilenameHints: true })).toMatch(/shipment receipt/i);
    expect(getPayableBlockReason({ document_type: 'INVOICE', fileName: 'Bill_Payment_123.pdf' }, { skipFilenameHints: true })).toMatch(/bill payment/i);
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

  it('blocks excluded headings even when OCR calls the document an invoice', () => {
    const result = validatePayableDocument({
      invoice_type: 'INVOICE',
      raw_file_url: 'invoices/2026/09/commercial-invoice.pdf',
      ocr_raw_data: { raw_text: 'COMMERCIAL INVOICE\nInvoice No: CI-123\nTOTAL 10.00' },
    });
    expect(result.passed).toBe(false);
  });
});
