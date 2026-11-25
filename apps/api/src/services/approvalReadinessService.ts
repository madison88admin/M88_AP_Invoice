import { resolveInvoiceSubtotal } from './financialDetailsService';

export type ApprovalMissingField = { field: string; label: string; lineNumber?: number };

export interface ApprovalReadinessResult {
  ready: boolean;
  missing: ApprovalMissingField[];
  /** Fields that are missing but do not block (Finance advisory mode). */
  advisory: ApprovalMissingField[];
}

const blank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

/** Charge rows carry an amount but no product quantity or unit price. */
export function isInvoiceChargeLine(line: any): boolean {
  const explicitType = String(line?.line_type || line?.charge_type || '').trim().toUpperCase();
  if (explicitType === 'CHARGE' || explicitType === 'FEE' || explicitType === 'TAX') return true;
  const description = String(line?.description || line?.material_name || '').trim();
  if (!description) return false;
  // Some supplier invoices label a fixed bank fee simply as "Bank Admin"
  // without the words charge/fee. Treat that exact label (and its common
  // expanded form) as a charge so approval does not require product quantity
  // or unit price for a non-product financial line.
  if (/^bank\s+admin(?:istration)?(?:\s+(?:charge|fee|cost|surcharge))?$/i.test(description)
    || /\badministrative\s+(?:charge|fee)\b/i.test(description)
    || /\badmin(?:istration)?\s+(?:charge|fee)\b/i.test(description)) return true;
  return /^(?:bank|wire|remittance|transfer|delivery|shipping|freight|courier|handling|setup|sample|finance|service|customs)\s+(?:charge|fee|cost|surcharge)|^(?:tax|vat|gst|ppn)(?:\s|$)|\b(?:bank|wire|remittance|transfer|delivery|shipping|freight|courier|handling|setup|sample|finance)\s+(?:charge|fee|cost|surcharge)\b/i.test(description);
}

/** Canonical server-side gate. This must be called by every approval entry point. */
export function getApprovalReadiness(invoice: any): ApprovalReadinessResult {
  const missing: ApprovalMissingField[] = [];
  const subtotalResolution = resolveInvoiceSubtotal(invoice);
  const readinessInvoice = blank(invoice?.subtotal) && subtotalResolution.subtotal !== null
    ? { ...invoice, subtotal: subtotalResolution.subtotal }
    : invoice;
  const required: Array<[string, string]> = [
    ['vendor_id', 'Vendor'], ['invoice_number', 'Invoice Number'], ['invoice_date', 'Invoice Date'],
    ['currency', 'Currency'], ['total_amount', 'Total Amount'], ['subtotal', 'Invoice Subtotal (excludes bank charges)'], ['brand', 'Brand'], ['season', 'Season'],
  ];
  for (const [field, label] of required) {
    const value = readinessInvoice[field];
    if (field === 'total_amount' || field === 'subtotal'
      ? !Number.isFinite(Number(value)) || Number(value) <= 0
      : blank(value)) {
      missing.push({ field, label });
    }
  }
  if (blank(readinessInvoice.payment_terms) && blank(readinessInvoice.due_date)) {
    missing.push({ field: 'payment_terms_or_due_date', label: 'Payment Terms or Due Date' });
  }
  if (blank(readinessInvoice.raw_file_url) && blank(readinessInvoice.pdf_path)) {
    missing.push({ field: 'original_pdf', label: 'Original PDF' });
  }

  const lines = Array.isArray(readinessInvoice.invoice_lines) ? readinessInvoice.invoice_lines : [];
  const advisory: ApprovalMissingField[] = [];
  // Financial Details line breakdown is informative when available, but is no
  // longer a hard approval prerequisite. Legacy invoices and charge-only or
  // header-only supplier documents may legitimately have no normalized lines;
  // the core invoice fields above remain mandatory. Any lines that are present
  // are still validated below so incomplete extracted lines cannot silently pass.
  for (const [index, line] of lines.entries()) {
    const lineNumber = Number(line.line_number || index + 1);
    const chargeLine = isInvoiceChargeLine(line);
    const lineRequired: Array<[string, string]> = [
      ...(chargeLine ? [] : [['quantity', 'Quantity'], ['unit_price', 'Unit Price']] as Array<[string, string]>),
      ['line_amount', 'Line Amount'],
    ];
    for (const [field, label] of lineRequired) {
      const value = line[field];
      const invalidNumber = ['quantity', 'unit_price', 'line_amount'].includes(field)
        && (!Number.isFinite(Number(value)) || Number(value) < 0 || (field === 'quantity' && Number(value) === 0));
      if (blank(value) || invalidNumber) missing.push({ field: `invoice_lines.${lineNumber}.${field}`, label, lineNumber });
    }
    if (chargeLine) continue;
    // MPO base: if missing per line but invoice-level mpo_number exists, make it advisory
    if (blank(line.mpo_base_number)) {
      if (!blank(readinessInvoice.mpo_number) || !blank(readinessInvoice.mpo_base_number)) {
        advisory.push({ field: `invoice_lines.${lineNumber}.mpo_base_number`, label: 'Base MPO', lineNumber });
      } else {
        missing.push({ field: `invoice_lines.${lineNumber}.mpo_base_number`, label: 'Base MPO', lineNumber });
      }
    }
    // Material: require either material_code OR material_name (OCR often extracts
    // only the descriptive name; the code can be auto-filled from NextGen MPO match)
    if (blank(line.material_code) && blank(line.material_name)) {
      missing.push({ field: `invoice_lines.${lineNumber}.material_code`, label: 'Material', lineNumber });
    } else if (blank(line.material_code) && !blank(line.material_name)) {
      // material_code missing but material_name present — advisory, not blocking
      advisory.push({ field: `invoice_lines.${lineNumber}.material_code`, label: 'Material Code', lineNumber });
    }
  }
  return { ready: missing.length === 0, missing, advisory };
}
