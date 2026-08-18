export type FinanceControlIssueCode = 'LINE_INCOMPLETE' | 'LINE_ARITHMETIC' | 'OVER_RECEIVED' | 'OVER_REMAINING' | 'TOTAL_ARITHMETIC' | 'MPO_CONTROL';

export interface FinanceControlIssue {
  code: FinanceControlIssueCode;
  lineNumber?: number;
  detail: string;
}

/**
 * Decides whether a finance-control issue hard-blocks the workflow.
 * - strict mode: every issue blocks (Finance has confirmed the data is trustworthy).
 * - advisory mode (default): only invoice-internal arithmetic errors block. Issues that
 *   depend on reference data that may be unpopulated in production (NextGen line matches,
 *   received/remaining quantities, MPO-line completeness) warn but do not block.
 */
export function financeIssueIsBlocking(issue: FinanceControlIssue, mode: 'advisory' | 'strict' = 'advisory'): boolean {
  if (mode === 'strict') return true;
  return issue.code === 'LINE_ARITHMETIC' || issue.code === 'TOTAL_ARITHMETIC';
}

const money = (value: unknown) => Number(value || 0);
const closeEnough = (left: number, right: number, tolerance: number) =>
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;

/** Pure deterministic finance checks. AI/OCR confidence never changes these results. */
export function validateFinanceArithmetic(invoice: any): FinanceControlIssue[] {
  const policy = getFinancePolicy();
  const issues: FinanceControlIssue[] = [];
  const lines = Array.isArray(invoice.invoice_lines) ? invoice.invoice_lines : [];
  const isStatement = invoice.invoice_type === 'STATEMENT';

  if (!isStatement && lines.length > 0) {
    for (const issue of validateMultiMpoAllocations(invoice).issues) {
      issues.push({ code: 'MPO_CONTROL', lineNumber: issue.lineNumber, detail: issue.detail });
    }
  }

  if (!isStatement && invoice.mpo_number && lines.length === 0) {
    issues.push({ code: 'LINE_INCOMPLETE', detail: 'PO-backed invoice has no invoice lines to reconcile.' });
    return issues;
  }

  let lineSum = 0;
  for (const [index, line] of lines.entries()) {
    const lineNumber = Number(line.line_number || index + 1);
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unit_price);
    const lineAmount = Number(line.line_amount);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(lineAmount) || lineAmount < 0) {
      issues.push({ code: 'LINE_INCOMPLETE', lineNumber, detail: `Line ${lineNumber} requires valid quantity, unit price, and line amount.` });
      continue;
    }

    const expected = quantity * unitPrice;
    if (!closeEnough(expected, lineAmount, policy.lineRoundingTolerance)) {
      issues.push({
        code: 'LINE_ARITHMETIC',
        lineNumber,
        detail: `Line ${lineNumber}: quantity × unit price is ${expected.toFixed(2)}, but line amount is ${lineAmount.toFixed(2)}.`,
      });
    }
    lineSum += lineAmount;

    const received = line.accepted_quantity ?? line.received_quantity;
    if (received !== null && received !== undefined && quantity > Number(received)) {
      issues.push({ code: 'OVER_RECEIVED', lineNumber, detail: `Line ${lineNumber}: invoiced quantity ${quantity} exceeds received/accepted quantity ${Number(received)}.` });
    }
    if (line.remaining_receivable_quantity !== null && line.remaining_receivable_quantity !== undefined
      && quantity > Number(line.remaining_receivable_quantity)) {
      issues.push({ code: 'OVER_REMAINING', lineNumber, detail: `Line ${lineNumber}: invoiced quantity ${quantity} exceeds remaining invoiceable quantity ${Number(line.remaining_receivable_quantity)}.` });
    }
  }

  if (lines.length > 0) {
    const subtotal = invoice.subtotal === null || invoice.subtotal === undefined ? lineSum : money(invoice.subtotal);
    if (!closeEnough(lineSum, subtotal, policy.lineRoundingTolerance)) {
      issues.push({ code: 'TOTAL_ARITHMETIC', detail: `Invoice lines total ${lineSum.toFixed(2)}, but subtotal is ${subtotal.toFixed(2)}.` });
    }

    const charges = money(invoice.tax_amount) + money(invoice.bank_charges) + money(invoice.freight_charges)
      + money(invoice.additional_charges) + money(invoice.courier_charges) + money(invoice.handling_fee)
      + money(invoice.tt_charge) + money(invoice.setup_charge) + money(invoice.sample_charge)
      + money(invoice.min_order_charge) + money(invoice.finance_surcharge);
    const calculatedTotal = subtotal - money(invoice.discount_amount) + charges;
    const statedTotal = money(invoice.total_amount);
    if (!closeEnough(calculatedTotal, statedTotal, policy.invoiceRoundingTolerance)) {
      issues.push({ code: 'TOTAL_ARITHMETIC', detail: `Calculated invoice total is ${calculatedTotal.toFixed(2)}, but stated total is ${statedTotal.toFixed(2)}.` });
    }
  }

  return issues;
}
import { getFinancePolicy } from './financePolicyService';
import { validateMultiMpoAllocations } from './multiMpoControlService';
