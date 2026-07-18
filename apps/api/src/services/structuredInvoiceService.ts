import crypto from 'crypto';

export type SourceDocumentType =
  | 'INVOICE'
  | 'PROFORMA_INVOICE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'PURCHASE_ORDER'
  | 'PACKING_LIST'
  | 'DELIVERY_RECEIPT'
  | 'STATEMENT'
  | 'PAYMENT_ADVICE'
  | 'UNKNOWN';

export interface DocumentClassification {
  document_type: SourceDocumentType;
  confidence: number;
  payable_candidate: boolean;
  reasons: string[];
  layout_fingerprint: string;
}

const decodeXml = (value: string) => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

function firstTag(xml: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${name}>`, 'i');
    const match = xml.match(pattern);
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  }
  return null;
}

function blocks(xml: string, name: string): string[] {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${name}>`, 'gi');
  return [...xml.matchAll(pattern)].map(match => match[1]);
}

function numeric(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyInvoiceDocument(input: { fileName?: string; mimeType?: string; text?: string }): DocumentClassification {
  const text = `${input.fileName || ''}\n${input.text || ''}`.toUpperCase();
  const matches: Array<{ type: SourceDocumentType; patterns: RegExp[]; payable: boolean }> = [
    { type: 'CREDIT_NOTE', patterns: [/CREDIT\s+(?:NOTE|MEMO)/, /<CREDITNOTE\b/], payable: true },
    { type: 'DEBIT_NOTE', patterns: [/DEBIT\s+(?:NOTE|MEMO)/, /<DEBITNOTE\b/], payable: true },
    { type: 'PROFORMA_INVOICE', patterns: [/PRO[ -]?FORMA\s+INVOICE/], payable: false },
    { type: 'PACKING_LIST', patterns: [/PACKING\s+LIST/, /PACKING\s+SLIP/], payable: false },
    { type: 'DELIVERY_RECEIPT', patterns: [/DELIVERY\s+(?:RECEIPT|NOTE)/, /GOODS\s+RECEIPT/], payable: false },
    { type: 'PURCHASE_ORDER', patterns: [/PURCHASE\s+ORDER/, /<ORDER\b/], payable: false },
    { type: 'PAYMENT_ADVICE', patterns: [/PAYMENT\s+ADVICE/, /REMITTANCE\s+ADVICE/], payable: false },
    { type: 'STATEMENT', patterns: [/STATEMENT\s+OF\s+ACCOUNT/, /ACCOUNT\s+STATEMENT/], payable: false },
    { type: 'INVOICE', patterns: [/\bINVOICE\b/, /<(?:[A-Z0-9_-]+:)?INVOICE\b/], payable: true },
  ];
  for (const candidate of matches) {
    const reasons = candidate.patterns.filter(pattern => pattern.test(text)).map(pattern => `Matched ${pattern.source}`);
    if (reasons.length) {
      return {
        document_type: candidate.type,
        confidence: Math.min(99, 82 + reasons.length * 8),
        payable_candidate: candidate.payable,
        reasons,
        layout_fingerprint: layoutFingerprint(text),
      };
    }
  }
  return {
    document_type: 'UNKNOWN',
    confidence: 30,
    payable_candidate: false,
    reasons: ['No recognized payable-document marker'],
    layout_fingerprint: layoutFingerprint(text),
  };
}

export function layoutFingerprint(text: string): string {
  const normalized = text
    .toUpperCase()
    .replace(/[0-9]+/g, '#')
    .replace(/[^A-Z#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function isStructuredInvoice(fileName: string, mimeType?: string): boolean {
  return /\.(xml|ubl)$/i.test(fileName) || /(?:xml|ubl)/i.test(mimeType || '');
}

export function parseStructuredInvoice(buffer: Buffer, fileName: string) {
  const xml = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!/<(?:[A-Za-z0-9_-]+:)?(?:Invoice|CreditNote)\b/i.test(xml)) {
    throw new Error('The structured document is not a supported UBL invoice or credit note');
  }
  const classification = classifyInvoiceDocument({ fileName, mimeType: 'application/xml', text: xml.slice(0, 12000) });
  const supplierBlock = blocks(xml, 'AccountingSupplierParty')[0] || blocks(xml, 'SellerSupplierParty')[0] || '';
  const orderReference = blocks(xml, 'OrderReference')[0] || '';
  const lineBlocks = [
    ...blocks(xml, 'InvoiceLine'),
    ...blocks(xml, 'CreditNoteLine'),
  ];
  const lineItems = lineBlocks.map((line, index) => ({
    line_number: Number(firstTag(line, ['ID']) || index + 1),
    description: firstTag(line, ['Description', 'Name']),
    material_code: firstTag(blocks(line, 'SellersItemIdentification')[0] || line, ['ID']),
    quantity: numeric(firstTag(line, ['InvoicedQuantity', 'CreditedQuantity', 'Quantity'])),
    unit_price: numeric(firstTag(blocks(line, 'Price')[0] || line, ['PriceAmount'])),
    line_amount: numeric(firstTag(line, ['LineExtensionAmount'])),
    confidence: 99,
    source_evidence: {
      description: { matched_label: 'UBL Item/Description' },
      material_code: { matched_label: 'UBL SellersItemIdentification/ID' },
      quantity: { matched_label: 'UBL InvoicedQuantity' },
      unit_price: { matched_label: 'UBL PriceAmount' },
      line_amount: { matched_label: 'UBL LineExtensionAmount' },
    },
  }));

  return {
    source_format: /CREDITNOTE/i.test(xml.slice(0, 500)) ? 'UBL_CREDIT_NOTE' : 'UBL_INVOICE',
    classification,
    extraction: {
      vendor_name: firstTag(supplierBlock, ['RegistrationName', 'Name']) || '',
      invoice_number: firstTag(xml, ['ID']) || '',
      invoice_date: firstTag(xml, ['IssueDate']) || '',
      due_date: firstTag(xml, ['DueDate']),
      total_amount: numeric(firstTag(xml, ['PayableAmount', 'TaxInclusiveAmount'])) || 0,
      subtotal: numeric(firstTag(xml, ['TaxExclusiveAmount', 'LineExtensionAmount'])),
      tax_amount: numeric(firstTag(xml, ['TaxAmount'])),
      currency: firstTag(xml, ['DocumentCurrencyCode']) || 'USD',
      po_number: firstTag(orderReference, ['ID']),
      mpo_number: firstTag(orderReference, ['ID']),
      payment_terms: firstTag(xml, ['Note', 'PaymentTerms']),
      line_items: lineItems,
      raw_text: xml.slice(0, 50000),
    },
  };
}
