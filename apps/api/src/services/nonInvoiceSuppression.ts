/**
 * Filename-only suppression for documents that are unambiguously not payable
 * invoices. This is deliberately conservative: terms such as "CI" and
 * "commercial invoice" are not included because they can be valid invoice
 * document types. OCR still decides ambiguous files.
 */
const OBVIOUS_NON_INVOICE_HINTS = /\b(?:statement|packing\s*(?:list|slip)|delivery\s*(?:note|receipt)|purchase\s*order|sales\s*order|order\s*confirmation|quotation|quote|remittance|receipt|shipping\s*document|shipment\s*document|air\s*way\s*bill|airway\s*bill|awb|bill\s*of\s*lading|cargo\s*manifest|waybill|layout|tech\s*pack|bill\s*stub|account\s*information|artwork|care\s*label|hangtag|barcode|rfid\s*sticker|polybag\s*sticker|shipping\s*label|trim\s*(?:received|sample))\b/i;

/**
 * Detect a document title in OCR text before trusting an invoice-like field.
 * Packing lists commonly contain an "Invoice No." reference, so checking for
 * an invoice token alone is not enough to classify the document as payable.
 */
export function hasStrongNonInvoiceHeading(text: unknown): boolean {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return false;

  const firstPage = normalized.slice(0, 1200);
  const marker = firstPage.search(/\b(?:packing\s+(?:list|slip)|shipment\s+airwaybill|air\s*way\s*bill|bill\s+of\s+lading|cargo\s+manifest|shipping\s+document|shipment\s+document|delivery\s+(?:note|receipt))\b/i);
  if (marker < 0) return false;

  // A payable heading before the supporting-document title indicates an
  // invoice that merely references a packing list (for example, "Packing List
  // No."), so keep that invoice eligible.
  const payableHeading = firstPage.search(/(?:^|\n)\s*(?:commercial\s+|proforma\s+|sales\s+)?invoice\b|(?:^|\n)\s*(?:debit|credit)\s+note\b/i);
  return payableHeading < 0 || marker < payableHeading;
}

export function isObviouslyNonInvoiceFilename(fileName: string, subject = ''): boolean {
  // Treat common filename separators as whitespace so `Packing_List` and
  // `AWB-123` are classified the same as their human-readable equivalents.
  const haystack = `${fileName} ${subject}`.replace(/[_-]+/g, ' ');
  return OBVIOUS_NON_INVOICE_HINTS.test(haystack);
}

export function nonInvoiceSuppressionReason(fileName: string, subject = ''): string {
  return `Attachment was suppressed before OCR because its filename/subject matches an obvious non-invoice document pattern (${fileName}${subject ? `; subject: ${subject}` : ''}).`;
}
