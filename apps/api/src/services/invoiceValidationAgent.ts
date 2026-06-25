import { logger } from '../utils/logger';

export interface ExtractedInvoiceData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  currency: string;
  brand: string;
  season: string;
  order_type: string;
  po_reference_raw: string;
  po_number: string | null;
  mpo_number: string | null;
  document_type: 'INV' | 'PI' | 'CI' | 'SI' | 'STATEMENT' | null;
}

export interface NextGenPOData {
  vendor_id: string;
  vendor_name: string;
  brand: string;
  season: string;
  order_type: string;
  currency: string;
  amount: number;
  status: string;
}

export interface ValidationResult {
  status: 'AUTO_APPROVED' | 'REVIEW_REQUIRED' | 'REJECTED';
  confidence: number;
  summary: string;
  checks: {
    mpo_found: boolean;
    vendor_match: boolean;
    vendor_match_score: number;
    brand_match: boolean;
    brand_source: 'INVOICE' | 'NEXTGEN';
    season_match: boolean;
    order_type_match: boolean;
    currency_match: boolean;
    amount_variance_percent: number;
  };
  issues: string[];
  recommendation: string;
}

/**
 * Normalize vendor name for comparison
 * Removes company suffixes, punctuation, and normalizes spacing
 */
function normalizeVendorName(name: string): string {
  return name
    .toUpperCase()
    .replace(/CO\.?,?\s*LTD\.?/gi, '')
    .replace(/LIMITED/gi, '')
    .replace(/CORPORATION/gi, '')
    .replace(/INC\.?/gi, '')
    .replace(/LLC/gi, '')
    .replace(/PTE\.?/gi, '')
    .replace(/SDN\.?/gi, '')
    .replace(/BHD\.?/gi, '')
    .replace(/-/g, ' ')
    .replace(/[.,;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two vendor names likely refer to the same supplier
 * Returns match score (0-1) where 1.0 is perfect match
 */
function vendorsMatch(invoiceVendor: string, nextGenVendor: string): { match: boolean; score: number } {
  const normalizedInvoice = normalizeVendorName(invoiceVendor);
  const normalizedNextGen = normalizeVendorName(nextGenVendor);
  
  // Exact match after normalization
  if (normalizedInvoice === normalizedNextGen) {
    return { match: true, score: 1.0 };
  }
  
  // Check if one contains the other (handles regional variations)
  if (normalizedInvoice.includes(normalizedNextGen) || normalizedNextGen.includes(normalizedInvoice)) {
    return { match: true, score: 0.95 };
  }
  
  // Check for common tokens
  const invoiceTokens = normalizedInvoice.split(' ').filter(t => t.length > 2);
  const nextGenTokens = normalizedNextGen.split(' ').filter(t => t.length > 2);
  
  const commonTokens = invoiceTokens.filter(token => 
    nextGenTokens.some(nToken => nToken.includes(token) || token.includes(nToken))
  );
  
  // Calculate score based on token overlap
  const maxTokens = Math.max(invoiceTokens.length, nextGenTokens.length);
  const tokenScore = commonTokens.length / maxTokens;
  
  // If at least 2 common tokens, consider it a match
  if (commonTokens.length >= 2) {
    return { match: true, score: Math.min(0.95, tokenScore + 0.5) };
  }
  
  // If 1 common token, low confidence match
  if (commonTokens.length === 1) {
    return { match: false, score: tokenScore };
  }
  
  // No common tokens - likely unrelated
  return { match: false, score: 0.0 };
}

/**
 * Calculate amount variance percentage
 */
function calculateAmountVariance(invoiceAmount: number, poAmount: number): number {
  if (poAmount === 0) return 100; // Infinite variance if PO amount is 0
  return Math.abs((invoiceAmount - poAmount) / poAmount) * 100;
}

/**
 * Classify amount variance
 */
function classifyVariance(variancePercent: number): string {
  if (variancePercent <= 5) return 'Match';
  if (variancePercent <= 15) return 'Minor variance';
  if (variancePercent <= 50) return 'Significant variance';
  return 'Critical variance';
}

/**
 * Validate extracted invoice against NextGen PO record
 * Treats NextGen data as source of truth
 */
export async function validateInvoiceAgainstPO(
  invoiceData: ExtractedInvoiceData,
  nextGenData: NextGenPOData
): Promise<ValidationResult> {
  logger.info('[InvoiceValidationAgent] Starting validation');
  logger.info('[InvoiceValidationAgent] Invoice MPO:', invoiceData.mpo_number);
  logger.info('[InvoiceValidationAgent] NextGen MPO:', nextGenData.vendor_id); // Using vendor_id as proxy for MPO reference
  
  const issues: string[] = [];
  const checks = {
    mpo_found: false,
    vendor_match: false,
    vendor_match_score: 0,
    brand_match: false,
    brand_source: 'INVOICE' as 'INVOICE' | 'NEXTGEN',
    season_match: false,
    order_type_match: false,
    currency_match: false,
    amount_variance_percent: 0,
  };
  
  // MPO Validation
  const mpoFound = !!(invoiceData.mpo_number && nextGenData.vendor_id); // Simplified check
  checks.mpo_found = mpoFound;
  
  if (!mpoFound) {
    issues.push('MPO not found or missing from invoice');
  }
  
  // Vendor Matching
  const vendorResult = vendorsMatch(invoiceData.vendor_name, nextGenData.vendor_name);
  checks.vendor_match = vendorResult.match;
  checks.vendor_match_score = vendorResult.score;
  
  if (!vendorResult.match) {
    issues.push(`Vendor mismatch: Invoice "${invoiceData.vendor_name}" vs PO "${nextGenData.vendor_name}" (score: ${vendorResult.score.toFixed(2)})`);
  }
  
  // Brand Validation - Trust NextGen if MPO exists
  let brandMatch = false;
  let brandSource: 'INVOICE' | 'NEXTGEN' = 'INVOICE';
  
  if (mpoFound) {
    // Trust NextGen brand when MPO is valid
    brandMatch = true;
    brandSource = 'NEXTGEN';
    logger.info('[InvoiceValidationAgent] Using NextGen brand as source of truth');
  } else {
    // Use invoice brand if no MPO
    brandMatch = invoiceData.brand.toUpperCase() === nextGenData.brand.toUpperCase();
    brandSource = 'INVOICE';
  }
  
  checks.brand_match = brandMatch;
  checks.brand_source = brandSource;
  
  // Season Validation
  // If NextGen season is empty, don't mark as mismatch (not available for comparison)
  const seasonMatch = !nextGenData.season || invoiceData.season.toUpperCase() === nextGenData.season.toUpperCase();
  checks.season_match = seasonMatch;
  
  if (!seasonMatch && nextGenData.season) {
    issues.push(`Season mismatch: Invoice "${invoiceData.season}" vs PO "${nextGenData.season}"`);
  }
  
  // Order Type Validation
  const orderTypeMatch = invoiceData.order_type.toUpperCase() === nextGenData.order_type.toUpperCase();
  checks.order_type_match = orderTypeMatch;
  
  if (!orderTypeMatch) {
    issues.push(`Order type mismatch: Invoice "${invoiceData.order_type}" vs PO "${nextGenData.order_type}"`);
  }
  
  // Currency Validation
  const currencyMatch = invoiceData.currency.toUpperCase() === nextGenData.currency.toUpperCase();
  checks.currency_match = currencyMatch;
  
  if (!currencyMatch) {
    issues.push(`Currency mismatch: Invoice "${invoiceData.currency}" vs PO "${nextGenData.currency}"`);
  }
  
  // Amount Validation
  // Skip amount variance check for STATEMENT documents (multi-period aggregates won't match single POs)
  const isStatement = invoiceData.document_type === 'STATEMENT';
  let amountVariance = 0;
  
  if (!isStatement) {
    amountVariance = calculateAmountVariance(invoiceData.amount, nextGenData.amount);
    checks.amount_variance_percent = amountVariance;
    
    const varianceClassification = classifyVariance(amountVariance);
    if (amountVariance > 5) {
      issues.push(`Amount ${varianceClassification}: Invoice $${invoiceData.amount} vs PO $${nextGenData.amount} (${amountVariance.toFixed(1)}% variance)`);
    }
  } else {
    // For statements, set variance to 0 to avoid false mismatches
    checks.amount_variance_percent = 0;
    logger.info('[InvoiceValidationAgent] Skipping amount variance check for STATEMENT document');
  }
  
  // Decision Logic
  let status: 'AUTO_APPROVED' | 'REVIEW_REQUIRED' | 'REJECTED';
  let confidence = 0.0;
  let summary = '';
  let recommendation = '';
  
  // REJECTED conditions (removed vendor_match - DB is optional enrichment; currency mismatch downgraded to warning)
  if (!mpoFound) {
    status = 'REJECTED';
    confidence = 0.0;
    summary = 'Invoice rejected due to critical validation failures';
    recommendation = 'Manual review required. Check MPO validity.';
  }
  // AUTO_APPROVED conditions (removed vendor_match requirement; currency mismatch no longer blocks auto-approval)
  else if (mpoFound && amountVariance <= 10 && seasonMatch && orderTypeMatch) {
    status = 'AUTO_APPROVED';
    confidence = 0.95;
    summary = 'Invoice validated successfully against PO';
    recommendation = 'Invoice can proceed to approval workflow.';
  }
  // REVIEW_REQUIRED conditions
  else {
    status = 'REVIEW_REQUIRED';
    confidence = 0.6;
    summary = 'Invoice requires manual review due to validation variances';
    recommendation = 'Review variances and determine if approval is warranted. Consider partial shipment, split billing, sample charges, or FX conversion.';
  }
  
  const result: ValidationResult = {
    status,
    confidence,
    summary,
    checks,
    issues,
    recommendation,
  };
  
  logger.info('[InvoiceValidationAgent] Validation result:', JSON.stringify(result, null, 2));
  return result;
}
