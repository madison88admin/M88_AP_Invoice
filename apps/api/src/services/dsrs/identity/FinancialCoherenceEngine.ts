/**
 * DSRS v5 - Financial Coherence Engine
 * 
 * Validates financial consistency across invoice, PO, and line items
 * Fixes the silent bug of treating numbers as independent facts
 */

export interface FinancialStructure {
  lineItems: number;
  subtotal?: number;
  total?: number;
  tax?: number;
  shipping?: number;
  currency: string;
  poTotal?: number;
  poCurrency?: string;
}

export interface CoherenceRule {
  name: string;
  description: string;
  check: (structure: FinancialStructure) => boolean;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
}

export interface CoherenceResult {
  status: 'CONSISTENT' | 'INCONSISTENT' | 'WARNING';
  issues: string[];
  likelyCauses: string[];
  confidence: number;
  ruleResults: Map<string, boolean>;
  recommendations: string[];
}

export class FinancialCoherenceEngine {
  private rules: CoherenceRule[];
  private tolerance: number = 0.05; // 5% tolerance for numerical comparisons

  constructor() {
    this.rules = this.initializeRules();
  }

  /**
   * Initialize coherence rules
   */
  private initializeRules(): CoherenceRule[] {
    const rules: CoherenceRule[] = [];

    // Rule 1: Line integrity - sum(lineItems) ≈ total
    rules.push({
      name: 'LINE_INTEGRITY',
      description: 'Line item sum should match invoice total',
      check: (structure) => {
        if (!structure.total || structure.lineItems === 0) return true;
        const difference = Math.abs(structure.lineItems - structure.total) / structure.total;
        return difference <= this.tolerance;
      },
      severity: 'CRITICAL'
    });

    // Rule 2: Subtotal consistency
    rules.push({
      name: 'SUBTOTAL_CONSISTENCY',
      description: 'Subtotal should be close to line item sum',
      check: (structure) => {
        if (!structure.subtotal || structure.lineItems === 0) return true;
        const difference = Math.abs(structure.lineItems - structure.subtotal) / structure.subtotal;
        return difference <= this.tolerance;
      },
      severity: 'WARNING'
    });

    // Rule 3: PO alignment - invoice total vs PO total
    rules.push({
      name: 'PO_ALIGNMENT',
      description: 'Invoice total should align with PO total',
      check: (structure) => {
        if (!structure.poTotal || !structure.total) return true;
        const difference = Math.abs(structure.total - structure.poTotal) / structure.poTotal;
        return difference <= this.tolerance;
      },
      severity: 'CRITICAL'
    });

    // Rule 4: Currency sanity - currency must match PO or have FX explanation
    rules.push({
      name: 'CURRENCY_SANITY',
      description: 'Currency should match PO currency',
      check: (structure) => {
        if (!structure.poCurrency) return true;
        return structure.currency === structure.poCurrency;
      },
      severity: 'CRITICAL'
    });

    // Rule 5: Tax reasonableness
    rules.push({
      name: 'TAX_REASONABLENESS',
      description: 'Tax should be reasonable percentage of subtotal',
      check: (structure) => {
        if (!structure.tax || !structure.subtotal) return true;
        const taxRate = structure.tax / structure.subtotal;
        return taxRate >= 0 && taxRate <= 0.3; // 0-30% tax rate
      },
      severity: 'WARNING'
    });

    // Rule 6: Shipping reasonableness
    rules.push({
      name: 'SHIPPING_REASONABLENESS',
      description: 'Shipping should be reasonable percentage of total',
      check: (structure) => {
        if (!structure.shipping || !structure.total) return true;
        const shippingRate = structure.shipping / structure.total;
        return shippingRate >= 0 && shippingRate <= 0.2; // 0-20% shipping rate
      },
      severity: 'WARNING'
    });

    return rules;
  }

  /**
   * Check financial coherence
   */
  checkCoherence(structure: FinancialStructure): CoherenceResult {
    console.log('[FinancialCoherenceEngine] Checking financial coherence');

    const ruleResults = new Map<string, boolean>();
    const issues: string[] = [];
    const likelyCauses: string[] = [];

    for (const rule of this.rules) {
      const passed = rule.check(structure);
      ruleResults.set(rule.name, passed);

      if (!passed) {
        issues.push(`${rule.name}: ${rule.description}`);
        
        // Add likely causes based on rule
        if (rule.name === 'LINE_INTEGRITY') {
          likelyCauses.push('Split invoice', 'Missing line items', 'Manual adjustment');
        } else if (rule.name === 'PO_ALIGNMENT') {
          likelyCauses.push('Partial shipment', 'Cross-PO aggregation', 'Rebill scenario');
        } else if (rule.name === 'CURRENCY_SANITY') {
          likelyCauses.push('Currency conversion missing', 'Multi-currency PO', 'FX rate not applied');
        } else if (rule.name === 'TAX_REASONABLENESS') {
          likelyCauses.push('Tax calculation error', 'Tax exemption', 'Different tax jurisdiction');
        }
      }
    }

    // Determine overall status
    const criticalFailures = this.rules.filter(r => r.severity === 'CRITICAL' && !ruleResults.get(r.name));
    const warningFailures = this.rules.filter(r => r.severity === 'WARNING' && !ruleResults.get(r.name));

    let status: 'CONSISTENT' | 'INCONSISTENT' | 'WARNING';
    if (criticalFailures.length > 0) {
      status = 'INCONSISTENT';
    } else if (warningFailures.length > 0) {
      status = 'WARNING';
    } else {
      status = 'CONSISTENT';
    }

    // Calculate confidence
    const passedRules = Array.from(ruleResults.values()).filter(r => r).length;
    const confidence = passedRules / this.rules.length;

    // Generate recommendations
    const recommendations = this.generateRecommendations(ruleResults, structure);

    const result: CoherenceResult = {
      status,
      issues,
      likelyCauses,
      confidence,
      ruleResults,
      recommendations
    };

    console.log('[FinancialCoherenceEngine] Coherence check complete:', {
      status,
      confidence: confidence.toFixed(3),
      issues: issues.length,
      recommendations: recommendations.length
    });

    return result;
  }

  /**
   * Generate recommendations based on rule results
   */
  private generateRecommendations(ruleResults: Map<string, boolean>, structure: FinancialStructure): string[] {
    const recommendations: string[] = [];

    if (!ruleResults.get('LINE_INTEGRITY')) {
      recommendations.push('Verify all line items are captured');
      recommendations.push('Check for manual adjustments or discounts');
    }

    if (!ruleResults.get('PO_ALIGNMENT')) {
      recommendations.push('Verify PO coverage for this invoice');
      recommendations.push('Check if this is a partial or rebill invoice');
    }

    if (!ruleResults.get('CURRENCY_SANITY')) {
      recommendations.push('Verify currency conversion rate');
      recommendations.push('Check if multi-currency PO exists');
    }

    if (!ruleResults.get('TAX_REASONABLENESS')) {
      recommendations.push('Verify tax calculation method');
      recommendations.push('Check for tax exemptions or different jurisdiction');
    }

    if (recommendations.length === 0) {
      recommendations.push('Financial structure appears consistent');
    }

    return recommendations;
  }

  /**
   * Calculate line item sum from array of line items
   */
  calculateLineItemSum(lineItems: { amount: number }[]): number {
    return lineItems.reduce((sum, item) => sum + item.amount, 0);
  }

  /**
   * Detect if this is a partial shipment
   */
  detectPartialShipment(structure: FinancialStructure): boolean {
    if (!structure.poTotal || !structure.total) return false;
    return structure.total < structure.poTotal * 0.9; // Less than 90% of PO
  }

  /**
   * Detect if this is a multi-PO consolidated invoice
   */
  detectMultiPOConsolidation(structure: FinancialStructure): boolean {
    if (!structure.poTotal || !structure.total) return false;
    return structure.total > structure.poTotal * 1.1; // More than 110% of PO
  }

  /**
   * Get rule by name
   */
  getRule(name: string): CoherenceRule | undefined {
    return this.rules.find(r => r.name === name);
  }

  /**
   * Get all rules
   */
  getAllRules(): CoherenceRule[] {
    return [...this.rules];
  }

  /**
   * Add custom rule
   */
  addRule(rule: CoherenceRule): void {
    this.rules.push(rule);
    console.log(`[FinancialCoherenceEngine] Added rule: ${rule.name}`);
  }

  /**
   * Remove rule by name
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
    console.log(`[FinancialCoherenceEngine] Removed rule: ${name}`);
  }

  /**
   * Update tolerance
   */
  updateTolerance(tolerance: number): void {
    this.tolerance = tolerance;
    console.log(`[FinancialCoherenceEngine] Updated tolerance to ${tolerance}`);
  }

  /**
   * Get current tolerance
   */
  getTolerance(): number {
    return this.tolerance;
  }

  /**
   * Log coherence result
   */
  logCoherenceResult(result: CoherenceResult): void {
    console.log('\n=== FINANCIAL COHERENCE RESULT ===');
    console.log(`Status: ${result.status}`);
    console.log(`Confidence: ${result.confidence.toFixed(3)}`);
    
    if (result.issues.length > 0) {
      console.log('\nIssues:');
      result.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
    if (result.likelyCauses.length > 0) {
      console.log('\nLikely Causes:');
      result.likelyCauses.forEach(cause => console.log(`  - ${cause}`));
    }
    
    if (result.recommendations.length > 0) {
      console.log('\nRecommendations:');
      result.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }
    
    console.log('\nRule Results:');
    for (const [ruleName, passed] of result.ruleResults.entries()) {
      console.log(`  ${ruleName}: ${passed ? 'PASS' : 'FAIL'}`);
    }
    
    console.log('\n=== END COHERENCE RESULT ===\n');
  }
}
