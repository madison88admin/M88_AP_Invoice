import { getFinancePolicy } from './financePolicyService';

export interface MpoControlIssue {
  code: 'MPO_LINE_INCOMPLETE' | 'MPO_LINE_UNMATCHED' | 'UOM_MISMATCH' | 'PO_PRICE_MISMATCH' | 'OVER_CUMULATIVE_QUANTITY' | 'OVER_CUMULATIVE_AMOUNT';
  lineNumber: number;
  mpo?: string;
  detail: string;
}
export interface MpoSubtotal { mpo: string; subtotal: number; quantity: number; lineCount: number }
const norm = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

/** Per-line MPO control; a successful header match can never satisfy this check. */
export function validateMultiMpoAllocations(invoice: any): { issues: MpoControlIssue[]; subtotals: MpoSubtotal[] } {
  const issues: MpoControlIssue[] = [];
  const groups = new Map<string, MpoSubtotal>();
  const tolerance = getFinancePolicy().lineRoundingTolerance;
  const lines = Array.isArray(invoice.invoice_lines) ? invoice.invoice_lines : [];
  for (const [index, line] of lines.entries()) {
    const lineNumber = Number(line.line_number || index + 1);
    const mpo = String(line.mpo_base_number || '').trim();
    if (!mpo || !line.mpo_order_sequence || !line.material_code) issues.push({ code: 'MPO_LINE_INCOMPLETE', lineNumber, mpo, detail: `Line ${lineNumber} requires Base MPO, order sequence, and material code.` });
    if (!line.matched_nextgen_line_id || !['MATCHED', 'WITHIN_TOLERANCE'].includes(String(line.match_status || '').toUpperCase())) issues.push({ code: 'MPO_LINE_UNMATCHED', lineNumber, mpo, detail: `Line ${lineNumber} has no exact current NextGen MPO-line match.` });
    if (line.unit_of_measure && line.nextgen_unit_of_measure && norm(line.unit_of_measure) !== norm(line.nextgen_unit_of_measure)) issues.push({ code: 'UOM_MISMATCH', lineNumber, mpo, detail: `Line ${lineNumber} UOM ${line.unit_of_measure} does not match NextGen ${line.nextgen_unit_of_measure}.` });
    const qty = Number(line.quantity || 0);
    const amount = Number(line.line_amount || 0);
    const poPrice = Number(line.nextgen_unit_price);
    if (line.nextgen_unit_price != null && Number.isFinite(poPrice) && Math.abs(Number(line.unit_price) - poPrice) > tolerance) issues.push({ code: 'PO_PRICE_MISMATCH', lineNumber, mpo, detail: `Line ${lineNumber} unit price ${Number(line.unit_price).toFixed(2)} does not match NextGen ${poPrice.toFixed(2)}.` });
    const remainingQty = Number(line.remaining_receivable_quantity);
    if (line.remaining_receivable_quantity != null && Number.isFinite(remainingQty) && qty - remainingQty > tolerance) issues.push({ code: 'OVER_CUMULATIVE_QUANTITY', lineNumber, mpo, detail: `Line ${lineNumber} quantity ${qty} exceeds cumulative remaining quantity ${remainingQty}.` });
    const remainingAmount = Number(line.remaining_invoiceable_amount);
    if (line.remaining_invoiceable_amount != null && Number.isFinite(remainingAmount) && amount - remainingAmount > tolerance) issues.push({ code: 'OVER_CUMULATIVE_AMOUNT', lineNumber, mpo, detail: `Line ${lineNumber} amount ${amount.toFixed(2)} exceeds cumulative remaining amount ${remainingAmount.toFixed(2)}.` });
    if (mpo) {
      const group = groups.get(mpo) || { mpo, subtotal: 0, quantity: 0, lineCount: 0 };
      group.subtotal += amount; group.quantity += qty; group.lineCount += 1; groups.set(mpo, group);
    }
  }
  return { issues, subtotals: [...groups.values()].sort((a, b) => a.mpo.localeCompare(b.mpo)) };
}
