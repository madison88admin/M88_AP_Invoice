import { logger } from '../utils/logger';

export interface FraudCheckResult {
  passed: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  checks: FraudCheck[];
  summary: string;
}

interface FraudCheck {
  check_name: string;
  passed: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detail: string;
}

/**
 * Fraud detection for invoice data.
 * Detects character substitution, vendor name mismatches, and suspicious patterns.
 */
export function detectFraud(input: {
  invoiceVendorName?: string;
  nextGenVendorName?: string;
  invoiceNumber?: string;
  totalAmount?: number;
  poNumber?: string;
  mpoNumber?: string;
  currency?: string;
  existingInvoices?: Array<{
    invoice_number: string;
    vendor_name: string;
    total_amount: number;
    invoice_date: Date;
  }>;
}): FraudCheckResult {
  const checks: FraudCheck[] = [];

  // 1. Character substitution detection (e.g., NOR FLAG vs N0R FLAG)
  if (input.invoiceVendorName && input.nextGenVendorName) {
    const substitution = detectCharacterSubstitution(input.invoiceVendorName, input.nextGenVendorName);
    checks.push({
      check_name: 'vendor_name_character_substitution',
      passed: !substitution.detected,
      severity: substitution.detected ? 'HIGH' : 'LOW',
      detail: substitution.detected
        ? `Possible character substitution: invoice="${input.invoiceVendorName}" vs NextGen="${input.nextGenVendorName}" — ${substitution.details}`
        : 'Vendor name matches NextGen',
    });
  }

  // 2. Vendor name similarity (fuzzy match against NextGen)
  if (input.invoiceVendorName && input.nextGenVendorName) {
    const similarity = calculateSimilarity(input.invoiceVendorName, input.nextGenVendorName);
    if (similarity < 0.85 && similarity > 0.5) {
      checks.push({
        check_name: 'vendor_name_similarity',
        passed: false,
        severity: 'MEDIUM',
        detail: `Vendor name only ${Math.round(similarity * 100)}% similar to NextGen: "${input.invoiceVendorName}" vs "${input.nextGenVendorName}"`,
      });
    } else if (similarity <= 0.5) {
      checks.push({
        check_name: 'vendor_name_similarity',
        passed: false,
        severity: 'CRITICAL',
        detail: `Vendor name completely different from NextGen: "${input.invoiceVendorName}" vs "${input.nextGenVendorName}"`,
      });
    } else {
      checks.push({
        check_name: 'vendor_name_similarity',
        passed: true,
        severity: 'LOW',
        detail: 'Vendor name matches NextGen',
      });
    }
  }

  // 3. Duplicate detection (vendor + amount + date proximity)
  if (input.existingInvoices && input.existingInvoices.length > 0 && input.totalAmount) {
    const duplicates = input.existingInvoices.filter(existing => {
      const sameAmount = Math.abs(existing.total_amount - (input.totalAmount || 0)) < 0.01;
      const sameVendor = existing.vendor_name.toLowerCase() === (input.invoiceVendorName || '').toLowerCase();
      const within30Days = Math.abs(
        Date.now() - existing.invoice_date.getTime()
      ) < 30 * 24 * 60 * 60 * 1000;

      return sameAmount && sameVendor && within30Days;
    });

    checks.push({
      check_name: 'duplicate_invoice',
      passed: duplicates.length === 0,
      severity: duplicates.length > 0 ? 'HIGH' : 'LOW',
      detail: duplicates.length > 0
        ? `Found ${duplicates.length} potential duplicate(s): same vendor + same amount within 30 days`
        : 'No duplicates detected',
    });
  }

  // 4. Invoice number similarity (fuzzy duplicate)
  if (input.existingInvoices && input.existingInvoices.length > 0 && input.invoiceNumber) {
    const similarInvoiceNumbers = input.existingInvoices.filter(existing => {
      const sim = calculateSimilarity(existing.invoice_number, input.invoiceNumber!);
      return sim > 0.85 && sim < 1.0;
    });

    if (similarInvoiceNumbers.length > 0) {
      checks.push({
        check_name: 'invoice_number_similarity',
        passed: false,
        severity: 'MEDIUM',
        detail: `Invoice number "${input.invoiceNumber}" is very similar to existing: ${similarInvoiceNumbers.map(d => d.invoice_number).join(', ')}`,
      });
    }
  }

  // 5. Unusual amount check
  if (input.totalAmount && input.totalAmount > 1000000) {
    checks.push({
      check_name: 'unusual_amount',
      passed: false,
      severity: 'MEDIUM',
      detail: `Very high invoice amount: ${input.totalAmount} — requires additional verification`,
    });
  }

  // 6. Currency mismatch
  if (input.currency && input.nextGenVendorName) {
    // This is a placeholder — in production, check if vendor's expected currency matches
    // For now, just log if currency is unexpected
    const validCurrencies = ['USD', 'HKD', 'EUR', 'IDR', 'PHP', 'JPY', 'CNY', 'GBP', 'AUD', 'CAD', 'SGD', 'VND'];
    if (!validCurrencies.includes(input.currency.toUpperCase())) {
      checks.push({
        check_name: 'invalid_currency',
        passed: false,
        severity: 'HIGH',
        detail: `Unrecognized currency code: "${input.currency}"`,
      });
    }
  }

  // Determine overall result
  const failedChecks = checks.filter(c => !c.passed);
  const criticalCount = failedChecks.filter(c => c.severity === 'CRITICAL').length;
  const highCount = failedChecks.filter(c => c.severity === 'HIGH').length;
  const mediumCount = failedChecks.filter(c => c.severity === 'MEDIUM').length;

  let riskLevel: FraudCheckResult['risk_level'] = 'LOW';
  if (criticalCount > 0) riskLevel = 'CRITICAL';
  else if (highCount > 0) riskLevel = 'HIGH';
  else if (mediumCount > 0) riskLevel = 'MEDIUM';

  const passed = riskLevel === 'LOW';
  const summary = passed
    ? 'All fraud checks passed'
    : `${failedChecks.length} fraud check(s) failed (risk: ${riskLevel})`;

  if (!passed) {
    logger.warn(`[FraudDetection] ${summary}: ${failedChecks.map(c => c.check_name).join(', ')}`);
  }

  return {
    passed,
    risk_level: riskLevel,
    checks,
    summary,
  };
}

/**
 * Detect character substitution that could indicate fraud.
 * Common substitutions: O↔0, I↔1, l↔1, S↔5, B↔8, Z↔2, G↔6
 */
function detectCharacterSubstitution(a: string, b: string): { detected: boolean; details: string } {
  if (!a || !b) return { detected: false, details: '' };

  const substitutionPairs: Array<[string, string]> = [
    ['O', '0'], ['I', '1'], ['l', '1'], ['S', '5'], ['B', '8'], ['Z', '2'], ['G', '6'],
  ];

  function isSubstitution(a: string, b: string): boolean {
    return substitutionPairs.some(
      ([x, y]) => (a === x && b === y) || (a === y && b === x)
    );
  }

  const normA = a.toUpperCase().replace(/\s/g, '');
  const normB = b.toUpperCase().replace(/\s/g, '');

  if (normA === normB) return { detected: false, details: '' };

  // Check if the strings would match if we apply character substitutions
  let substituted = false;
  const diffs: string[] = [];

  const maxLen = Math.max(normA.length, normB.length);
  for (let i = 0; i < maxLen; i++) {
    const charA = normA[i] || '';
    const charB = normB[i] || '';

    if (charA === charB) continue;

    if (isSubstitution(charA, charB)) {
      substituted = true;
      diffs.push(`position ${i + 1}: '${charA}' ↔ '${charB}'`);
    }
  }

  if (substituted && diffs.length <= 2) {
    return {
      detected: true,
      details: `Character substitution detected: ${diffs.join(', ')}`,
    };
  }

  return { detected: false, details: '' };
}

/**
 * Calculate string similarity using Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;

  const distance = levenshtein(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
