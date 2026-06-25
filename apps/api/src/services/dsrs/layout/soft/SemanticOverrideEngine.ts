/**
 * DSRS v4.5 - Semantic Override Engine
 * 
 * Allows exceptions to region rules when justified by stronger evidence
 * Brain override system with trigger-based rules
 */

import { Candidate, FieldType } from '../../tournament/Candidate';
import { RegionType } from '../LayoutGraphBuilder';

export interface OverrideRule {
  id: string;
  name: string;
  trigger: string;
  condition: (candidate: Candidate, context: any) => boolean;
  weightBoost: number;
  explanation: string;
  priority: number; // Higher = more important
  isHardRule: boolean; // If true, cannot be overridden
}

export interface OverrideResult {
  ruleId: string;
  applied: boolean;
  weightBoost: number;
  explanation: string;
  originalScore: number;
  adjustedScore: number;
}

export class SemanticOverrideEngine {
  private rules: Map<string, OverrideRule>;
  private overrideHistory: Map<string, OverrideResult[]>;

  constructor() {
    this.rules = new Map();
    this.overrideHistory = new Map();
    this.initializeDefaultRules();
  }

  /**
   * Initialize default override rules
   */
  private initializeDefaultRules(): void {
    // Rule 1: Strong Total Label Override
    this.addRule({
      id: 'STRONG_TOTAL_LABEL',
      name: 'Strong Total Label Override',
      trigger: 'TOTAL AMOUNT DUE|GRAND TOTAL|SAY TOTAL|TOTAL DUE',
      condition: (candidate, context) => {
        const text = context.contextWindow || '';
        const upperText = text.toUpperCase();
        return /(TOTAL AMOUNT DUE|GRAND TOTAL|SAY TOTAL|TOTAL DUE)/.test(upperText);
      },
      weightBoost: 0.40,
      explanation: 'Strong total label detected, overriding region bias',
      priority: 100,
      isHardRule: false
    });

    // Rule 2: Line-item Dominance Rule
    this.addRule({
      id: 'LINE_ITEM_DOMINANCE',
      name: 'Line-item Dominance Rule',
      trigger: 'line_item_sum_exists',
      condition: (candidate, context) => {
        const lineItemSum = context.lineItemSum;
        const footerTotal = context.footerTotal;
        
        if (!lineItemSum || !footerTotal) return false;
        
        const difference = Math.abs(lineItemSum - footerTotal) / Math.max(lineItemSum, footerTotal);
        return difference < 0.05; // Within 5% threshold
      },
      weightBoost: 0.35,
      explanation: 'Line-item sum matches footer total, preferring line-item sum',
      priority: 90,
      isHardRule: false
    });

    // Rule 3: Bank Exclusion (HARD RULE)
    this.addRule({
      id: 'BANK_EXCLUSION',
      name: 'Bank Exclusion Rule',
      trigger: 'region_is_bank',
      condition: (candidate, context) => {
        return context.region === 'BANK' && candidate.field === 'amount';
      },
      weightBoost: -1.0, // Negative boost = hard exclusion
      explanation: 'Bank region values excluded from amount candidates',
      priority: 200,
      isHardRule: true
    });

    // Rule 4: Invoice Number in HEADER Override
    this.addRule({
      id: 'HEADER_INVOICE_OVERRIDE',
      name: 'Header Invoice Number Override',
      trigger: 'invoice_number_in_header',
      condition: (candidate, context) => {
        return candidate.field === 'invoice_number' && context.region === 'HEADER';
      },
      weightBoost: 0.30,
      explanation: 'Invoice number in header region, boosting confidence',
      priority: 80,
      isHardRule: false
    });

    // Rule 5: SKU in TABLE Override
    this.addRule({
      id: 'SKU_TABLE_OVERRIDE',
      name: 'SKU Table Override',
      trigger: 'sku_in_table',
      condition: (candidate, context) => {
        return candidate.field === 'sku' && context.region === 'TABLE';
      },
      weightBoost: 0.25,
      explanation: 'SKU in table region, boosting confidence',
      priority: 70,
      isHardRule: false
    });

    // Rule 6: Account Number in BANK Override
    this.addRule({
      id: 'ACCOUNT_BANK_OVERRIDE',
      name: 'Account Bank Override',
      trigger: 'account_in_bank',
      condition: (candidate, context) => {
        return candidate.field === 'account_number' && context.region === 'BANK';
      },
      weightBoost: 0.35,
      explanation: 'Account number in bank region, boosting confidence',
      priority: 85,
      isHardRule: false
    });

    // Rule 7: Currency Symbol Proximity
    this.addRule({
      id: 'CURRENCY_PROXIMITY',
      name: 'Currency Symbol Proximity',
      trigger: 'currency_symbol_nearby',
      condition: (candidate, context) => {
        const text = context.contextWindow || '';
        return /[$€£¥]/.test(text) && candidate.field === 'amount';
      },
      weightBoost: 0.20,
      explanation: 'Currency symbol nearby, boosting amount confidence',
      priority: 60,
      isHardRule: false
    });

    // Rule 8: PO Number Reference
    this.addRule({
      id: 'PO_REFERENCE',
      name: 'PO Number Reference',
      trigger: 'po_reference',
      condition: (candidate, context) => {
        const text = context.contextWindow || '';
        return /PO\s*[:#]|PURCHASE\s*ORDER/i.test(text) && candidate.field === 'po_number';
      },
      weightBoost: 0.25,
      explanation: 'PO reference detected, boosting confidence',
      priority: 65,
      isHardRule: false
    });
  }

  /**
   * Add custom override rule
   */
  addRule(rule: OverrideRule): void {
    this.rules.set(rule.id, rule);
    console.log(`[SemanticOverrideEngine] Added rule: ${rule.name} (priority: ${rule.priority})`);
  }

  /**
   * Remove override rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    console.log(`[SemanticOverrideEngine] Removed rule: ${ruleId}`);
  }

  /**
   * Evaluate all rules for a candidate
   */
  evaluateRules(candidate: Candidate, context: any): OverrideResult[] {
    const results: OverrideResult[] = [];
    const originalScore = candidate.globalScore || candidate.confidence;

    // Sort rules by priority (highest first)
    const sortedRules = Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.condition(candidate, context)) {
        const adjustedScore = originalScore + rule.weightBoost;
        
        const result: OverrideResult = {
          ruleId: rule.id,
          applied: true,
          weightBoost: rule.weightBoost,
          explanation: rule.explanation,
          originalScore,
          adjustedScore
        };

        results.push(result);

        // If it's a hard rule with negative boost, stop processing
        if (rule.isHardRule && rule.weightBoost < 0) {
          console.log(`[SemanticOverrideEngine] Hard rule ${rule.id} applied, stopping evaluation`);
          break;
        }
      }
    }

    // Record history
    const candidateId = candidate.id;
    if (!this.overrideHistory.has(candidateId)) {
      this.overrideHistory.set(candidateId, []);
    }
    this.overrideHistory.get(candidateId)!.push(...results);

    return results;
  }

  /**
   * Apply overrides to a candidate
   */
  applyOverrides(candidate: Candidate, context: any): Candidate {
    const results = this.evaluateRules(candidate, context);
    
    if (results.length === 0) {
      return candidate;
    }

    // Apply the last (highest priority) override
    const lastResult = results[results.length - 1];
    
    // If hard exclusion, mark candidate as invalid
    if (lastResult.weightBoost < 0 && this.rules.get(lastResult.ruleId)?.isHardRule) {
      candidate.confidence = 0;
      candidate.globalScore = 0;
      candidate.explanation = `Hard exclusion: ${lastResult.explanation}`;
    } else {
      candidate.globalScore = lastResult.adjustedScore;
      candidate.confidence = Math.min(1.0, lastResult.adjustedScore);
      candidate.explanation = lastResult.explanation;
    }

    console.log(`[SemanticOverrideEngine] Applied ${results.length} overrides to candidate ${candidate.id}:`, {
      originalScore: lastResult.originalScore.toFixed(3),
      adjustedScore: lastResult.adjustedScore.toFixed(3),
      rules: results.map(r => r.ruleId)
    });

    return candidate;
  }

  /**
   * Get override history for a candidate
   */
  getOverrideHistory(candidateId: string): OverrideResult[] {
    return this.overrideHistory.get(candidateId) || [];
  }

  /**
   * Get all rules
   */
  getAllRules(): OverrideRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rule by ID
   */
  getRule(ruleId: string): OverrideRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Clear override history
   */
  clearHistory(): void {
    this.overrideHistory.clear();
  }

  /**
   * Reset all rules to defaults
   */
  resetToDefaults(): void {
    this.rules.clear();
    this.initializeDefaultRules();
  }

  /**
   * Log rule state
   */
  logRuleState(): void {
    console.log('\n=== SEMANTIC OVERRIDE RULES ===');
    
    const sortedRules = Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);
    
    for (const rule of sortedRules) {
      console.log(`\n${rule.id}:`);
      console.log(`  Name: ${rule.name}`);
      console.log(`  Priority: ${rule.priority}`);
      console.log(`  Weight Boost: ${rule.weightBoost.toFixed(3)}`);
      console.log(`  Hard Rule: ${rule.isHardRule}`);
      console.log(`  Trigger: ${rule.trigger}`);
      console.log(`  Explanation: ${rule.explanation}`);
    }
    
    console.log('\n=== END RULE STATE ===\n');
  }
}
