/**
 * Filename-only suppression for documents that are unambiguously not payable
 * invoices. This is deliberately conservative: terms such as "CI" and
 * "commercial invoice" are not included because they can be valid invoice
 * document types. OCR still decides ambiguous files.
 */
const OBVIOUS_NON_INVOICE_HINTS = /\b(?:statement|packing\s*(?:list|slip)|delivery\s*(?:note|receipt)|purchase\s*order|sales\s*order|order\s*confirmation|quotation|quote|remittance|receipt|shipping\s*document|shipment\s*document|air\s*way\s*bill|airway\s*bill|awb|bill\s*of\s*lading|cargo\s*manifest|waybill|layout|tech\s*pack|bill\s*stub|account\s*information|artwork|care\s*label|hangtag|barcode|trim\s*(?:received|sample))\b/i;

export function isObviouslyNonInvoiceFilename(fileName: string, subject = ''): boolean {
  // Treat common filename separators as whitespace so `Packing_List` and
  // `AWB-123` are classified the same as their human-readable equivalents.
  const haystack = `${fileName} ${subject}`.replace(/[_-]+/g, ' ');
  return OBVIOUS_NON_INVOICE_HINTS.test(haystack);
}

export function nonInvoiceSuppressionReason(fileName: string, subject = ''): string {
  return `Attachment was suppressed before OCR because its filename/subject matches an obvious non-invoice document pattern (${fileName}${subject ? `; subject: ${subject}` : ''}).`;
}
