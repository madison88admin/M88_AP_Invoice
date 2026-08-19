import { getFinancePolicy } from './financePolicyService';

export type ApprovalMissingField = { field: string; label: string; lineNumber?: number };

export interface ApprovalReadinessResult {
  ready: boolean;
  missing: ApprovalMissingField[];
  /** Fields that are missing but do not block (Finance advisory mode). */
  advisory: ApprovalMissingField[];
}

const blank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

/** Canonical server-side gate. This must be called by every approval entry point. */
export function getApprovalReadiness(invoice: any): ApprovalReadinessResult {
  const missing: ApprovalMissingField[] = [];
  const required: Array<[string, string]> = [
    ['vendor_id', 'Vendor'], ['invoice_number', 'Invoice Number'], ['invoice_date', 'Invoice Date'],
    ['currency', 'Currency'], ['total_amount', 'Total Amount'], ['brand', 'Brand'], ['season', 'Season'],
  ];
  for (const [field, label] of required) {
    const value = invoice[field];
    if (field === 'total_amount' ? !Number.isFinite(Number(value)) || Number(value) <= 0 : blank(value)) {
      missing.push({ field, label });
    }
  }
  if (blank(invoice.payment_terms) && blank(invoice.due_date)) {
    missing.push({ field: 'payment_terms_or_due_date', label: 'Payment Terms or Due Date' });
  }
  if (blank(invoice.raw_file_url) && blank(invoice.pdf_path)) {
    missing.push({ field: 'original_pdf', label: 'Original PDF' });
  }

  const lines = Array.isArray(invoice.invoice_lines) ? invoice.invoice_lines : [];
  const advisory: ApprovalMissingField[] = [];
  const poBacked = !blank(invoice.mpo_number) || !blank(invoice.mpo_base_number) || lines.length > 0;
  // In Finance advisory mode (default), PO-backed invoices without line items are
  // legacy records that must not be hard-blocked — the missing lines are reported
  // as an advisory so Finance can backfill them without stalling the workflow.
  if (poBacked && lines.length === 0) {
    const field = { field: 'invoice_lines', label: 'Invoice Lines' };
    if (getFinancePolicy().enforcementMode === 'advisory') advisory.push(field);
    else missing.push(field);
  }
  for (const [index, line] of lines.entries()) {
    const lineNumber = Number(line.line_number || index + 1);
    const lineRequired: Array<[string, string]> = [
      ['quantity', 'Quantity'],
      ['unit_price', 'Unit Price'], ['line_amount', 'Line Amount'],
    ];
    for (const [field, label] of lineRequired) {
      const value = line[field];
      const invalidNumber = ['quantity', 'unit_price', 'line_amount'].includes(field)
        && (!Number.isFinite(Number(value)) || Number(value) < 0 || (field === 'quantity' && Number(value) === 0));
      if (blank(value) || invalidNumber) missing.push({ field: `invoice_lines.${lineNumber}.${field}`, label, lineNumber });
    }
    // MPO base: if missing per line but invoice-level mpo_number exists, make it advisory
    if (blank(line.mpo_base_number)) {
      if (!blank(invoice.mpo_number) || !blank(invoice.mpo_base_number)) {
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
