import { describe, expect, it } from 'vitest';
import { classifyInvoiceDocument, parseStructuredInvoice } from './structuredInvoiceService';

describe('structuredInvoiceService', () => {
  it('classifies supporting documents as non-payable', () => {
    const result = classifyInvoiceDocument({ fileName: 'packing-list.pdf', text: 'PACKING LIST shipment details' });
    expect(result.document_type).toBe('PACKING_LIST');
    expect(result.payable_candidate).toBe(false);
  });

  it.each([
    ['airway-bill.pdf', 'AIR WAYBILL AWB NO 123-456'],
    ['shipment.pdf', 'SHIPMENT DOCUMENT CARGO MANIFEST'],
    ['delivery.pdf', 'BILL OF LADING delivery details'],
  ])('parks shipment documents (%s) as non-payable', (fileName, text) => {
    const result = classifyInvoiceDocument({ fileName, text });
    expect(result.payable_candidate).toBe(false);
    expect(['AIRWAY_BILL', 'DELIVERY_RECEIPT']).toContain(result.document_type);
  });

  it('keeps a commercial invoice eligible for payable review', () => {
    const result = classifyInvoiceDocument({ fileName: 'commercial-invoice.pdf', text: 'COMMERCIAL INVOICE INV-42 TOTAL USD 100.00' });
    expect(result.document_type).toBe('INVOICE');
    expect(result.payable_candidate).toBe(true);
  });

  it('parses UBL header and line values without OCR', () => {
    const xml = `<?xml version="1.0"?>
      <Invoice xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
        <cbc:ID>INV-1001</cbc:ID><cbc:IssueDate>2026-07-18</cbc:IssueDate>
        <cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>
        <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Acme Textiles</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
        <cac:OrderReference><cbc:ID>MPO012121-3</cbc:ID></cac:OrderReference>
        <cac:LegalMonetaryTotal><cbc:PayableAmount>125.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
        <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity>5</cbc:InvoicedQuantity><cbc:LineExtensionAmount>125</cbc:LineExtensionAmount>
          <cac:Item><cbc:Description>ZVT material</cbc:Description><cac:SellersItemIdentification><cbc:ID>ZVT000123</cbc:ID></cac:SellersItemIdentification></cac:Item>
          <cac:Price><cbc:PriceAmount>25</cbc:PriceAmount></cac:Price>
        </cac:InvoiceLine>
      </Invoice>`;
    const result = parseStructuredInvoice(Buffer.from(xml), 'invoice.xml');
    expect(result.extraction.invoice_number).toBe('INV-1001');
    expect(result.extraction.vendor_name).toBe('Acme Textiles');
    expect(result.extraction.total_amount).toBe(125);
    expect(result.extraction.line_items[0]).toMatchObject({ material_code: 'ZVT000123', quantity: 5, unit_price: 25, line_amount: 125 });
  });
});
