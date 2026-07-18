import { describe, expect, it } from 'vitest';
import { classifyInvoiceDocument, parseStructuredInvoice } from './structuredInvoiceService';

describe('structuredInvoiceService', () => {
  it('classifies supporting documents as non-payable', () => {
    const result = classifyInvoiceDocument({ fileName: 'packing-list.pdf', text: 'PACKING LIST shipment details' });
    expect(result.document_type).toBe('PACKING_LIST');
    expect(result.payable_candidate).toBe(false);
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
