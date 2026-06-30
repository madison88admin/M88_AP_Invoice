import Anthropic from '@anthropic-ai/sdk';
import { InvoiceType, InvoiceCategory, PaymentTerms, BillToEntity, OrderType, SignatoryRole, SignatureType } from '@ap-invoice/shared';
import { parsePOReference, matchSignerToRole, TOP_10_BRANDS, isTop10Brand } from '@ap-invoice/shared';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function extractInvoiceFields(fileBuffer: Buffer, mimeType: string) {
  const base64File = fileBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: mimeType as 'application/pdf',
              data: base64File
            }
          },
          {
            type: 'text',
            text: `Extract fields from this invoice and return ONLY a valid JSON object, no other text:
{
  "vendor_name": "",
  "invoice_number": "",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "amount": 0.00,
  "currency": "USD",
  "po_reference": "",
  "brand_code": "",
  "mpo_number": "",
  "payment_terms": "",
  "bank_swift": "",
  "bank_account": "",
  "invoice_type": ""
}`
          }
        ]
      }
    ]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const clean = text.replace(/```json|```/g, '').trim();
  const extracted = JSON.parse(clean);

  // Map Anthropic response to OCRResult format
  const poParsed = extracted.po_reference ? parsePOReference(extracted.po_reference) : {};

  return {
    invoice_number: extracted.invoice_number || '',
    invoice_date: extracted.invoice_date ? new Date(extracted.invoice_date) : new Date(),
    due_date: extracted.due_date ? new Date(extracted.due_date) : undefined,
    invoice_received_date: new Date(),
    vendor_name: extracted.vendor_name || '',
    total_amount: extracted.amount || 0,
    currency: extracted.currency || 'USD',
    payment_terms: extracted.payment_terms || PaymentTerms.NET_30,
    incoterm: undefined,
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    invoice_type: extracted.invoice_type || InvoiceType.PROFORMA,
    category: InvoiceCategory.OTHER,
    order_type: poParsed.order_type as OrderType | undefined,
    brand: poParsed.brand_code ? (TOP_10_BRANDS[poParsed.brand_code] || poParsed.brand_code) : undefined,
    brand_code: poParsed.brand_code,
    season: poParsed.season,
    mpo_number: poParsed.mpo_number || extracted.mpo_number,
    customer_po_number: poParsed.po_number,
    bill_to_entity: BillToEntity.MADISON_88_LTD,
    is_handwritten: false,
    is_urgent: false,
    priority_pay_date: undefined,
    ocr_confidence_score: 0.9,
    qb_memo: undefined,
    qb_account_class: undefined,
    bank_info: {
      swift_code: extracted.bank_swift,
      account_usd: extracted.bank_account,
    },
    signatures: [],
    raw_data: extracted,
  };
}
