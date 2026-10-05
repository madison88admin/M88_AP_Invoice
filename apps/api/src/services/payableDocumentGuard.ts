/**
 * Payable Document Guard
 *
 * Single source of truth for deciding whether a document is a *payable*
 * invoice (can enter the AP workflow as an invoice record).
 *
 * Why this exists:
 * - Non-invoice documents (packing lists, AWBs, statements of account, receipts,
 *   payment advices, layouts) have historically leaked into the invoice table
 *   through the manual upload path — e.g. HKWSO DHL AWBs, ATX Freight Packing
 *   Lists, and HSBC statements all appear as invoice records (2026-08/09).
 * - The file watcher and email intake both had their own ad-hoc checks
 *   (intakeReviewReason / NON_INVOICE_HINTS). The manual upload path (POST
 *   /api/invoices and confirm-ocr) had none — that was the loophole.
 *
 * Usage:
 * - Intake paths (watcher/email): call `getPayableBlockReason(ocrResult, fileName)`
 *   before creating an invoice record.
 * - Validation: `validatePayableDocument(invoice)` is RULE 20 and runs on every
 *   validateInvoice() so even manually-created records get caught.
 * - There is intentionally no override. Even SUPERADMIN cannot turn a
 *   document classified as non-payable into an invoice record.
 */

import { InvoiceType, InvoiceSource } from '@ap-invoice/shared';
import { hasStrongNonInvoiceHeading } from './nonInvoiceSuppression';

/** Document types that can never become an AP invoice record. */
export const NON_PAYABLE_DOCUMENT_TYPES = new Set<string>([
  'PACKING_LIST',
  'PACKING_SLIP',
  'AIRWAY_BILL',
  'AWB',
  'DELIVERY_RECEIPT',
  'DELIVERY_NOTE',
  'SHIPMENT_RECEIPT',
  'GOODS_RECEIPT',
  'BILL_OF_LADING',
  'CARGO_MANIFEST',
  'SHIPPING_DOCUMENT',
  'SHIPMENT_DOCUMENT',
  'PURCHASE_ORDER',
  'PAYMENT_ADVICE',
  'BILL_PAYMENT',
  'PAYMENT_BILL',
  'PAYMENT_RECEIPT',
  'REMITTANCE_ADVICE',
  'RECEIPT',
  'STATEMENT',
  'STATEMENT_OF_ACCOUNT',
  'PROFORMA_INVOICE',
  'PROFORMA',
  'OTHER',
  'UNKNOWN',
  'TECH_PACK',
  'TRIM_RECEIPT',
  'FAKTUR_PAJAK',
  'FORWARDER_BILLING_INVOICE',
  'FORWARDERS_BILLING_INVOICE',
  'EXPEDITOR_BILLING_INVOICE',
  'EXPEDITORS_BILLING_INVOICE',
  'FORWARDER_INVOICE',
  'EXPEDITOR_INVOICE',
  'EXPEDITORS_INVOICE',
]);

/**
 * Filename hints that indicate a non-invoice document. Mirrors the intent of
 * nonInvoiceSuppression.ts but WITHOUT the over-broad "layout" and "quote"
 * terms that caused valid invoices to be parked (see 30d log: 672 parked with
 * "invoice number could not be extracted", many were LAYOUT files that are
 * genuinely non-invoices, but the same rule also caught valid invoices).
 *
 * Generic invoice filenames remain allowed; the explicit excluded document
 * names below are blocked before they can create an AP invoice record.
 */
export const NON_INVOICE_FILENAME_HINTS =
  /(?:^|[^a-z0-9]|packinglist)(statement(?:\s*of\s*account)?|account\s*statement|packing\s*(?:list|slip)|packinglist|p_?list|delivery\s*(?:note|receipt)|goods\s*received?|purchase\s*order|sales\s*order|order\s*confirmation|remittance|payment\s*advice|shipping\s*document|shipment\s*document|air\s*way\s*bill|airway\s*bill|awb|waybill|bill\s*of\s*lading|cargo\s*manifest|do\s*madison|transport\s*label|bill\s*stub|account\s*information|shipment\s*receipt|commercial\s*invoice|faktur\s*pajak|tech\s*pack|trim\s*(?:received|receipt|sample)|forwarder(?:['’]s|s)?\s+billing\s+invoice|expeditors?\s+billing\s+invoice|forwarder(?:['’]s|s)?\s+invoice|expeditors?\s+invoice)/i;

/**
 * The customer-specified exclusions are hard blocks even when an OCR engine
 * incorrectly labels the attachment as a normal INVOICE. This separate check
 * is intentionally narrower than NON_INVOICE_FILENAME_HINTS so generic
 * filename hints can retain their existing payable-document safeguards.
 */
const HARD_EXCLUDED_FILENAME_HINTS =
  /(?:air\s*way\s*bill|airway\s*bill|\bawb\b|waybill|packing\s*(?:list|slip)|packinglist|shipment\s+receipt|shipmentreceipt|bill\s+payment|billpayment|payment\s+bill|paymentbill|payment\s+receipt|paymentreceipt|commercial\s*invoice|faktur\s+pajak|tech\s*pack|techpack|trim\s*(?:received|receipt|sample)|trimreceived|trimreceipt|forwarder(?:['’]s|s)?\s+billing\s+invoice|forwarders?billinginvoice|expeditors?\s+billing\s+invoice|expeditors?billinginvoice|forwarder(?:['’]s|s)?\s+invoice|forwarders?invoice|expeditors?\s+invoice|expeditors?invoice)/i;

/** Strong headings for payment/shipment paperwork, even when OCR labels it INVOICE. */
const NON_PAYABLE_TEXT_HINTS =
  /\b(?:shipment\s+receipt|bill\s+payment|payment\s+bill|payment\s+receipt)\b/i;

/** Commercial Invoice is a payable subtype, but only with core invoice data. */
function isValidCommercialInvoice(doc: PayableCheckInput, docType: string): boolean {
  if (docType !== 'COMMERCIAL' && docType !== 'COMMERCIAL_INVOICE') return false;
  const invoiceNumber = String(doc.invoice_number || '').trim();
  const vendorName = String(doc.vendor_name || '').trim();
  const invoiceDate = String(doc.invoice_date || '').trim();
  const totalAmount = Number(String(doc.total_amount ?? '').replace(/[^0-9.-]/g, ''));
  const hasInvoiceHeading = /\bcommercial\s+invoice\b|\binvoice\b/i.test(
    `${String(doc.raw_text || '')}\n${String(doc.fileName || '')}`
  );
  return Boolean(
    invoiceNumber && vendorName && invoiceDate && Number.isFinite(totalAmount) && totalAmount > 0 && hasInvoiceHeading
  );
}

/** Focused guard used by legacy intake review paths for the newly requested exclusions. */
export function getShipmentBillBlockReason(doc: PayableCheckInput): string | null {
  const classification = doc.document_classification || undefined;
  const docType = String(classification?.document_type || doc.document_type || doc.source_document_type || doc.invoice_type || '').toUpperCase();
  if (classification && classification.payable_candidate === false) {
    return `Document classification ${String(classification.document_type || docType || 'UNKNOWN').toUpperCase()} is not eligible for invoice creation`;
  }
  if (docType === 'SHIPMENT_RECEIPT' || docType === 'BILL_PAYMENT' || docType === 'PAYMENT_BILL' || docType === 'PAYMENT_RECEIPT') {
    return `Document type ${docType} is not eligible for invoice creation`;
  }
  const text = String(doc.raw_text || '');
  if (NON_PAYABLE_TEXT_HINTS.test(text)) {
    return 'Document heading identifies a shipment receipt or bill payment document — not eligible for invoice creation';
  }
  const fileName = String(doc.fileName || '').replace(/[_-]+/g, ' ');
  if (fileName && /\b(?:shipment\s+receipt|bill\s+payment|payment\s+bill|payment\s+receipt)\b/i.test(fileName)) {
    return `Filename identifies a shipment receipt or bill payment document (${doc.fileName}) — not eligible for invoice creation`;
  }
  return null;
}

export function filenameIsHardExcluded(fileName: string): boolean {
  return HARD_EXCLUDED_FILENAME_HINTS.test(String(fileName || '').replace(/[_-]+/g, ' '));
}

/**
 * Substring-level test used by the guard. Compromise between the strict word-
 * boundary regex above (avoids false positives like "recipient") and the need
 * to catch concatenated names like "ATXFreightPackingList_THK.pdf".
 */
export function filenameLooksNonInvoice(fileName: string): boolean {
  const normalized = String(fileName || '').replace(/[_-]+/g, ' ');
  // Fast path: concatenated forms (PackingList, AirwayBill, StatementOfAccount)
  if (/(packinglist|airwaybill|statementofaccount|deliverynote|waybillcopy|commercialinvoice|fakturpajak|techpack|trimreceived|trimreceipt|forwarders?billinginvoice|expeditors?billinginvoice|forwarders?invoice|expeditors?invoice)/i.test(normalized)) return true;
  return NON_INVOICE_FILENAME_HINTS.test(normalized);
}

/** Filename hints that POSITIVELY identify an invoice document. */
const INVOICE_FILENAME_HINTS =
  /\b(?:invoice|inv\b|debit\s*note|credit\s*note|commercial|proforma|sales\s*invoice)\b|\b(?:invp|si|ci|pi)\d{4,}\b/i;

/**
 * Strong text signals from the document body (raw_text) that it is a statement
 * of account rather than a single payable invoice — multiple balance lines.
 */
const STATEMENT_TEXT_HINTS =
  /\b(?:statement\s+of\s+account|account\s+statement|opening\s+balance|closing\s+balance|balance\s+brought\s+forward|balance\s+carried\s+forward)\b/i;

export interface PayableCheckInput {
  document_type?: string | null;
  invoice_type?: string | null;
  source_document_type?: string | null;
  is_non_invoice_document?: boolean | null;
  raw_text?: string | null;
  fileName?: string | null;
  invoice_number?: string | null;
  vendor_name?: string | null;
  total_amount?: unknown;
  invoice_date?: string | Date | null;
  document_classification?: {
    document_type?: string | null;
    payable_candidate?: boolean | null;
    confidence?: number | null;
    reasons?: string[] | null;
  } | null;
}

/**
 * Returns a reason string if the document must NOT be created as an invoice
 * record; null when the document is payable/allowed.
 */
export function getPayableBlockReason(
  doc: PayableCheckInput,
  options?: { skipFilenameHints?: boolean }
): string | null {
  const classification = doc.document_classification || undefined;
  // OCR classification is the strongest signal. Do not let a caller relabel
  // a packing list/AWB as INVOICE after classification has already rejected it.
  const docType = String(
    classification?.document_type || doc.document_type || doc.source_document_type || doc.invoice_type || ''
  ).toUpperCase();

  if (classification && classification.payable_candidate === false) {
    const label = String(classification.document_type || docType || 'UNKNOWN').toUpperCase();
    return `Document classification ${label} is not payable — only actual invoices, debit notes, and credit notes may enter the AP workflow`;
  }

  // 1. Explicit non-invoice flag from OCR (DHL AWB detector etc.)
  if (doc.is_non_invoice_document) {
    return 'Document is a shipping/non-invoice document (OCR detection) — not eligible for invoice creation';
  }

  // 2. Hard-blocked document types
  if (NON_PAYABLE_DOCUMENT_TYPES.has(docType)) {
    return `Document type ${docType} is not eligible for invoice creation`;
  }

  // 3. Statement-of-account text signals (even if type extraction failed)
  const text = String(doc.raw_text || '');
  if (text && hasStrongNonInvoiceHeading(text)) {
    return 'Document heading identifies an excluded non-invoice document';
  }
  if (text && STATEMENT_TEXT_HINTS.test(text)) {
    return 'Document contains statement-of-account markers (opening/closing balance) — not eligible for invoice creation';
  }
  const shipmentBillReason = getShipmentBillBlockReason(doc);
  if (shipmentBillReason) return shipmentBillReason;

  // 4. Filename hints — decisive ONLY when the extracted document type is
  //    missing/unknown (avoid re-parking valid invoices whose filename merely
  //    contains a hint word). When the type is clearly INVOICE/PROFORMA/etc.,
  //    trust the document body over the filename.
  //    Underscores/hyphens are normalized to spaces (same as
  //    nonInvoiceSuppression.ts) so `AWB_543505` and `PackingList_THK` match.
  const fileName = String(doc.fileName || '');
  const validCommercialInvoice = isValidCommercialInvoice(doc, docType);
  if (fileName && filenameIsHardExcluded(fileName) && !validCommercialInvoice) {
    return `Filename identifies an excluded non-invoice document (${fileName}) — not eligible for invoice creation`;
  }
  if (fileName && !options?.skipFilenameHints) {
    const typeLooksPayable =
      docType.startsWith('INVOICE') ||
      docType === 'PROFORMA' ||
      docType === 'PROFORMA_INVOICE' ||
      docType === 'COMMERCIAL' ||
      docType === 'COMMERCIAL_INVOICE' ||
      docType === 'SALES' ||
      docType === 'DEBIT_NOTE' ||
      docType === 'CREDIT_NOTE';

    const normalizedFileName = fileName.replace(/[_-]+/g, ' ');
    if (!typeLooksPayable && filenameLooksNonInvoice(normalizedFileName)) {
      return `Filename indicates a non-invoice document (${fileName}) — not eligible for invoice creation`;
    }
  }

  return null;
}

/**
 * Validation rule (RULE 20) — runs inside validateInvoice() so that even
 * manually-created invoice records are caught. Returns a ValidationResult
 * shape compatible with the validation rules engine.
 */
export function validatePayableDocument(invoice: {
  invoice_number?: string | null;
  vendor_name_raw?: string | null;
  total_amount?: unknown;
  invoice_date?: string | Date | null;
  invoice_type?: string | null;
  source_document_type?: string | null;
  pdf_path?: string | null;
  raw_file_url?: string | null;
  source?: string | null;
  ocr_raw_data?: any;
}): { passed: boolean; message: string; detail?: string } {
  // Reconstruct the filename from the stored PDF path (last segment).
  const pdfRef = invoice.pdf_path || invoice.raw_file_url || '';
  const fileName = pdfRef ? decodeURIComponent(String(pdfRef).split('/').pop() || '') : '';

  const ocrRaw = invoice.ocr_raw_data || {};
  const doc: PayableCheckInput = {
    document_type: ocrRaw.document_type,
    source_document_type: invoice.source_document_type,
    invoice_type: invoice.invoice_type,
    is_non_invoice_document: ocrRaw.is_non_invoice_document,
    raw_text: typeof ocrRaw.raw_text === 'string' ? ocrRaw.raw_text.slice(0, 20000) : '',
    fileName,
    invoice_number: invoice.invoice_number,
    vendor_name: invoice.vendor_name_raw,
    total_amount: invoice.total_amount == null ? null : String(invoice.total_amount),
    invoice_date: invoice.invoice_date,
    document_classification: ocrRaw.document_classification,
  };

  const reason = getPayableBlockReason(doc);

  if (reason) {
    return {
      passed: false,
      message: 'Document is not a payable invoice',
      detail: reason,
    };
  }

  return { passed: true, message: 'Document is a payable invoice type' };
}
