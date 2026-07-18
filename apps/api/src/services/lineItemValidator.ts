import { logger } from '../utils/logger';

export interface LineItemValidation {
  line_index: number;
  description?: string;
  quantity: number;
  unit_price: number;
  expected_amount: number;
  actual_amount: number;
  difference: number;
  status: 'PASS' | 'FAIL' | 'WARNING';
  reason?: string;
}

export interface LineItemValidationResult {
  items: LineItemValidation[];
  all_pass: boolean;
  failing_count: number;
  warning_count: number;
  total_expected: number;
  total_actual: number;
  total_difference: number;
}

/**
 * Validates line items by computing qty × unit_price and comparing to the stated total.
 * Also validates that line items sum up to the invoice total.
 */
export function validateLineItems(
  lineItems: Array<{
    description?: string;
    quantity: number;
    unit_price: number;
    total_amount?: number;
    line_amount?: number;
  }>,
  invoiceTotal?: number
): LineItemValidationResult {
  const validations: LineItemValidation[] = [];
  let failingCount = 0;
  let warningCount = 0;
  let totalExpected = 0;
  let totalActual = 0;

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    const expected = Number(item.quantity) * Number(item.unit_price);
    const actual = Number(item.line_amount ?? item.total_amount);
    const difference = Math.abs(expected - actual);
    const tolerance = Math.max(0.01, expected * 0.001); // 0.1% tolerance or minimum 1 cent

    totalExpected += expected;
    totalActual += actual;

    let status: 'PASS' | 'FAIL' | 'WARNING' = 'PASS';
    let reason: string | undefined;

    if (difference > tolerance) {
      const pctDiff = expected > 0 ? (difference / expected) * 100 : 0;

      if (pctDiff > 5) {
        status = 'FAIL';
        reason = `Qty×Price=${expected.toFixed(2)} but stated amount=${actual.toFixed(2)} (${pctDiff.toFixed(1)}% diff)`;
        failingCount++;
      } else {
        status = 'WARNING';
        reason = `Qty×Price=${expected.toFixed(2)} vs stated=${actual.toFixed(2)} (${pctDiff.toFixed(1)}% diff, possible rounding)`;
        warningCount++;
      }
    }

    validations.push({
      line_index: i,
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      expected_amount: expected,
      actual_amount: actual,
      difference,
      status,
      reason,
    });
  }

  // Check if line items sum to invoice total
  if (invoiceTotal && invoiceTotal > 0 && validations.length > 0) {
    const sumDiff = Math.abs(totalActual - invoiceTotal);
    const sumTolerance = Math.max(0.01, invoiceTotal * 0.005); // 0.5% tolerance

    if (sumDiff > sumTolerance) {
      const pctDiff = (sumDiff / invoiceTotal) * 100;
      logger.warn(
        `[LineItemValidator] Line items sum (${totalActual.toFixed(2)}) != invoice total (${invoiceTotal.toFixed(2)}), ` +
        `${pctDiff.toFixed(1)}% difference`
      );
    }
  }

  const result: LineItemValidationResult = {
    items: validations,
    all_pass: failingCount === 0,
    failing_count: failingCount,
    warning_count: warningCount,
    total_expected: totalExpected,
    total_actual: totalActual,
    total_difference: Math.abs(totalExpected - totalActual),
  };

  if (failingCount > 0) {
    logger.warn(`[LineItemValidator] ${failingCount} line items failed computation check`);
  }

  return result;
}

/**
 * Format line item validation results for display in extraction trace.
 */
export function formatLineItemValidation(result: LineItemValidationResult): string {
  const lines: string[] = [];

  for (const item of result.items) {
    const icon = item.status === 'PASS' ? '✓' : item.status === 'WARNING' ? '⚠' : '✗';
    lines.push(
      `${icon} Line ${item.line_index + 1}: ${item.quantity} × ${item.unit_price} = ${item.expected_amount.toFixed(2)} ` +
      `(stated: ${item.actual_amount.toFixed(2)}) ${item.status}` +
      (item.reason ? ` — ${item.reason}` : '')
    );
  }

  lines.push(`\nSum: ${result.total_actual.toFixed(2)} (expected: ${result.total_expected.toFixed(2)})`);
  lines.push(`Result: ${result.failing_count} failed, ${result.warning_count} warnings`);

  return lines.join('\n');
}
