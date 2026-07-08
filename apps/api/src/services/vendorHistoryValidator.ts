import prisma from '../config/database';
import { logger } from '../utils/logger';

export interface VendorHistoryCheck {
  check_name: string;
  passed: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detail: string;
}

export interface VendorHistoryResult {
  passed: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  checks: VendorHistoryCheck[];
  summary: string;
}

/**
 * Vendor History Validator
 * 
 * Checks invoice data against historical patterns for the same vendor:
 * - Bank account changes
 * - Currency deviations
 * - Invoice number pattern changes
 * - Amount anomalies
 */
export async function validateAgainstVendorHistory(input: {
  vendorName: string;
  bankName?: string;
  bankAccount?: string;
  swiftCode?: string;
  currency?: string;
  invoiceNumber?: string;
  totalAmount?: number;
}): Promise<VendorHistoryResult> {
  const checks: VendorHistoryCheck[] = [];

  if (!input.vendorName) {
    return {
      passed: true,
      risk_level: 'LOW',
      checks: [],
      summary: 'No vendor name — skipping history validation',
    };
  }

  // Get historical invoices for this vendor
  const historicalInvoices = await prisma.invoice.findMany({
    where: {
      vendor_name_raw: { contains: input.vendorName, mode: 'insensitive' },
      status: { in: ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'] },
    },
    orderBy: { created_at: 'desc' },
    take: 20,
    select: {
      invoice_number: true,
      total_amount: true,
      currency: true,
      invoice_date: true,
      bank_name: true,
      swift_code: true,
      account_number: true,
      created_at: true,
    },
  });

  if (historicalInvoices.length === 0) {
    return {
      passed: true,
      risk_level: 'LOW',
      checks: [],
      summary: 'No historical invoices for this vendor — first-time vendor',
    };
  }

  // 1. Bank Account Validation
  if (input.bankName || input.bankAccount) {
    const bankCheck = checkBankAccountChange(input, historicalInvoices);
    if (bankCheck) checks.push(bankCheck);
  }

  // 2. Currency History
  if (input.currency) {
    const currencyCheck = checkCurrencyHistory(input.currency, historicalInvoices);
    if (currencyCheck) checks.push(currencyCheck);
  }

  // 3. Invoice Number Pattern
  if (input.invoiceNumber) {
    const patternCheck = checkInvoiceNumberPattern(input.invoiceNumber, historicalInvoices);
    if (patternCheck) checks.push(patternCheck);
  }

  // 4. Amount Anomaly
  if (input.totalAmount && input.totalAmount > 0) {
    const amountCheck = checkAmountAnomaly(input.totalAmount, historicalInvoices);
    if (amountCheck) checks.push(amountCheck);
  }

  // Determine overall risk
  const failedChecks = checks.filter(c => !c.passed);
  const criticalCount = failedChecks.filter(c => c.severity === 'CRITICAL').length;
  const highCount = failedChecks.filter(c => c.severity === 'HIGH').length;
  const mediumCount = failedChecks.filter(c => c.severity === 'MEDIUM').length;

  let riskLevel: VendorHistoryResult['risk_level'] = 'LOW';
  if (criticalCount > 0) riskLevel = 'CRITICAL';
  else if (highCount > 0) riskLevel = 'HIGH';
  else if (mediumCount > 0) riskLevel = 'MEDIUM';

  const passed = riskLevel === 'LOW';
  const summary = passed
    ? 'All vendor history checks passed'
    : `${failedChecks.length} vendor history check(s) failed (risk: ${riskLevel})`;

  if (!passed) {
    logger.warn(`[VendorHistory] ${input.vendorName}: ${summary}`);
  }

  return { passed, risk_level: riskLevel, checks, summary };
}

// ============================================================================
// INDIVIDUAL CHECKS
// ============================================================================

function checkBankAccountChange(
  input: { bankName?: string; bankAccount?: string; swiftCode?: string },
  historical: Array<{ bank_name?: string | null; account_number?: string | null; swift_code?: string | null }>
): VendorHistoryCheck | null {
  // Extract historical bank info from direct fields
  const historicalBanks = historical
    .map(h => ({
      bank_name: h.bank_name || undefined,
      account_number: h.account_number || undefined,
      swift_code: h.swift_code || undefined,
    }))
    .filter(b => b.bank_name || b.account_number || b.swift_code);

  if (historicalBanks.length === 0) return null;

  const knownBank = historicalBanks[0];

  // Check bank name change
  if (input.bankName && knownBank.bank_name) {
    if (input.bankName.toLowerCase().trim() !== knownBank.bank_name.toLowerCase().trim()) {
      return {
        check_name: 'bank_account_change',
        passed: false,
        severity: 'HIGH',
        detail: `Bank changed from "${knownBank.bank_name}" to "${input.bankName}" — verify this is legitimate`,
      };
    }
  }

  // Check account number change
  if (input.bankAccount && knownBank.account_number) {
    if (String(input.bankAccount).replace(/\s/g, '') !== String(knownBank.account_number).replace(/\s/g, '')) {
      return {
        check_name: 'bank_account_number_change',
        passed: false,
        severity: 'CRITICAL',
        detail: `Bank account number changed from ${knownBank.account_number} to ${input.bankAccount} — POTENTIAL FRAUD`,
      };
    }
  }

  // Check SWIFT code change
  if (input.swiftCode && knownBank.swift_code) {
    if (input.swiftCode.toUpperCase().trim() !== knownBank.swift_code.toUpperCase().trim()) {
      return {
        check_name: 'swift_code_change',
        passed: false,
        severity: 'HIGH',
        detail: `SWIFT code changed from "${knownBank.swift_code}" to "${input.swiftCode}" — verify this is legitimate`,
      };
    }
  }

  return {
    check_name: 'bank_account_validation',
    passed: true,
    severity: 'LOW',
    detail: 'Bank details match historical records',
  };
}

function checkCurrencyHistory(
  currentCurrency: string,
  historical: Array<{ currency?: string }>
): VendorHistoryCheck | null {
  const historicalCurrencies = historical
    .map(h => h.currency || undefined)
    .filter((c): c is string => c !== undefined && c !== null);

  if (historicalCurrencies.length === 0) return null;

  const currencyCounts = new Map<string, number>();
  for (const c of historicalCurrencies) {
    const key = c.toUpperCase();
    currencyCounts.set(key, (currencyCounts.get(key) || 0) + 1);
  }

  const mostCommonCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const currentUpper = currentCurrency.toUpperCase();

  if (mostCommonCurrency[0] !== currentUpper) {
    const frequency = Math.round((mostCommonCurrency[1] / historicalCurrencies.length) * 100);
    return {
      check_name: 'currency_deviation',
      passed: false,
      severity: 'MEDIUM',
      detail: `Vendor usually pays in ${mostCommonCurrency[0]} (${frequency}% of past invoices) but this invoice uses ${currentUpper}`,
    };
  }

  return {
    check_name: 'currency_history',
    passed: true,
    severity: 'LOW',
    detail: `Currency ${currentUpper} matches vendor history`,
  };
}

function checkInvoiceNumberPattern(
  currentInvoiceNumber: string,
  historical: Array<{ invoice_number: string }>
): VendorHistoryCheck | null {
  const historicalNumbers = historical
    .map(h => h.invoice_number)
    .filter((n): n is string => n !== null && n !== undefined);

  if (historicalNumbers.length < 3) return null; // Need at least 3 to detect a pattern

  // Extract pattern (replace digits with #)
  const toPattern = (s: string) => s.replace(/\d/g, '#');
  const patterns = historicalNumbers.map(toPattern);
  const currentPattern = toPattern(currentInvoiceNumber);

  const patternCounts = new Map<string, number>();
  for (const p of patterns) {
    patternCounts.set(p, (patternCounts.get(p) || 0) + 1);
  }

  const mostCommonPattern = [...patternCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  if (mostCommonPattern[0] !== currentPattern) {
    const frequency = Math.round((mostCommonPattern[1] / patterns.length) * 100);
    return {
      check_name: 'invoice_number_pattern',
      passed: false,
      severity: 'MEDIUM',
      detail: `Invoice number pattern changed. Usually "${mostCommonPattern[0]}" (${frequency}%) but this is "${currentPattern}"`,
    };
  }

  return {
    check_name: 'invoice_number_pattern',
    passed: true,
    severity: 'LOW',
    detail: 'Invoice number pattern matches vendor history',
  };
}

function checkAmountAnomaly(
  currentAmount: number,
  historical: Array<{ total_amount: any }>
): VendorHistoryCheck | null {
  const historicalAmounts = historical
    .map(h => Number(h.total_amount))
    .filter(a => !isNaN(a) && a > 0);

  if (historicalAmounts.length < 3) return null;

  const avg = historicalAmounts.reduce((a, b) => a + b, 0) / historicalAmounts.length;
  const max = Math.max(...historicalAmounts);
  const min = Math.min(...historicalAmounts);

  // Flag if amount is 3x the historical average or outside historical range by 50%
  if (currentAmount > avg * 3) {
    return {
      check_name: 'amount_anomaly',
      passed: false,
      severity: 'MEDIUM',
      detail: `Amount ${currentAmount.toFixed(2)} is 3x the vendor average (${avg.toFixed(2)})`,
    };
  }

  if (currentAmount > max * 1.5) {
    return {
      check_name: 'amount_anomaly',
      passed: false,
      severity: 'LOW',
      detail: `Amount ${currentAmount.toFixed(2)} is significantly higher than vendor's max (${max.toFixed(2)})`,
    };
  }

  return {
    check_name: 'amount_anomaly',
    passed: true,
    severity: 'LOW',
    detail: `Amount ${currentAmount.toFixed(2)} within vendor's historical range (${min.toFixed(2)} - ${max.toFixed(2)})`,
  };
}
