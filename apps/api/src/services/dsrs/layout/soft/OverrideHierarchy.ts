/**
 * DSRS v4.5 - Override Hierarchy
 * 
 * Strict priority system to prevent chaos while allowing flexibility
 * Safety constraints preserved, flexibility added elsewhere
 */

import { OverrideRule, OverrideResult } from './SemanticOverrideEngine';
import { Candidate } from '../../tournament/Candidate';

export enum OverridePriority {
  HARD_SAFETY = 1000,      // BANK exclusion, ACCOUNT rules - cannot be overridden
  SEMANTIC_OVERRIDE = 500, // TOTAL, SUM logic - high priority
  CROSS_FIELD_COHERENCE = 400, // Field consistency rules
  REGION_PROBABILITY = 300,   // Soft region beliefs
  GRAPH_SCORE = 200,          // Graph traversal scores
  RAW_CONFIDENCE = 100        // Base extractor confidence
}

export interface HierarchyLevel {
  name: string;
  priority: OverridePriority;
  description: string;
  isOverrideable: boolean; // Whether lower priority rules can override this
}

export interface HierarchyDecision {
  appliedRule: OverrideRule | null;
  overriddenRule: OverrideRule | null;
  finalDecision: string;
  confidence: number;
  explanation: string;
}

export class OverrideHierarchy {
  private levels: Map<OverridePriority, HierarchyLevel>;
  private decisionHistory: HierarchyDecision[];

  constructor() {
    this.levels = new Map();
    this.decisionHistory = [];
    this.initializeHierarchy();
  }

  /**
   * Initialize override hierarchy levels
   */
  private initializeHierarchy(): void {
    this.levels.set(OverridePriority.HARD_SAFETY, {
      name: 'HARD SAFETY RULES',
      priority: OverridePriority.HARD_SAFETY,
      description: 'Bank exclusion, account rules - cannot be overridden',
      isOverrideable: false
    });

    this.levels.set(OverridePriority.SEMANTIC_OVERRIDE, {
      name: 'SEMANTIC OVERRIDES',
      priority: OverridePriority.SEMANTIC_OVERRIDE,
      description: 'TOTAL, SUM logic - high priority',
      isOverrideable: false
    });

    this.levels.set(OverridePriority.CROSS_FIELD_COHERENCE, {
      name: 'CROSS-FIELD COHERENCE',
      priority: OverridePriority.CROSS_FIELD_COHERENCE,
      description: 'Field consistency rules',
      isOverrideable: true
    });

    this.levels.set(OverridePriority.REGION_PROBABILITY, {
      name: 'REGION PROBABILITY',
      priority: OverridePriority.REGION_PROBABILITY,
      description: 'Soft region beliefs',
      isOverrideable: true
    });

    this.levels.set(OverridePriority.GRAPH_SCORE, {
      name: 'GRAPH SCORE',
      priority: OverridePriority.GRAPH_SCORE,
      description: 'Graph traversal scores',
      isOverrideable: true
    });

    this.levels.set(OverridePriority.RAW_CONFIDENCE, {
      name: 'RAW CONFIDENCE',
      priority: OverridePriority.RAW_CONFIDENCE,
      description: 'Base extractor confidence',
      isOverrideable: true
    });
  }

  /**
   * Evaluate override hierarchy for a candidate
   */
  evaluateHierarchy(
    candidate: Candidate,
    overrideResults: OverrideResult[],
    context?: any
  ): HierarchyDecision {
    console.log(`[OverrideHierarchy] Evaluating hierarchy for ${candidate.field}`);

    if (overrideResults.length === 0) {
      const decision: HierarchyDecision = {
        appliedRule: null,
        overriddenRule: null,
        finalDecision: 'NO_OVERRIDE',
        confidence: candidate.confidence,
        explanation: 'No override rules triggered'
      };
      this.decisionHistory.push(decision);
      return decision;
    }

    // Sort results by priority (highest first)
    const sortedResults = overrideResults.sort((a, b) => {
      const ruleA = this.getRulePriority(a.ruleId);
      const ruleB = this.getRulePriority(b.ruleId);
      return ruleB - ruleA;
    });

    // Get highest priority result
    const highestResult = sortedResults[0];
    const highestPriority = this.getRulePriority(highestResult.ruleId);
    const highestLevel = this.levels.get(highestPriority);

    // Check if this level can be overridden
    if (highestLevel && !highestLevel.isOverrideable) {
      // Hard rule, cannot be overridden
      const decision: HierarchyDecision = {
        appliedRule: this.getRuleById(highestResult.ruleId),
        overriddenRule: null,
        finalDecision: 'HARD_RULE_APPLIED',
        confidence: highestResult.adjustedScore,
        explanation: `Hard rule applied: ${highestResult.explanation}`
      };
      this.decisionHistory.push(decision);
      return decision;
    }

    // Check if there are higher priority rules that should take precedence
    for (let i = 1; i < sortedResults.length; i++) {
      const currentPriority = this.getRulePriority(sortedResults[i].ruleId);
      const currentLevel = this.levels.get(currentPriority);

      if (currentLevel && !currentLevel.isOverrideable) {
        // Higher priority hard rule found
        const decision: HierarchyDecision = {
          appliedRule: this.getRuleById(sortedResults[i].ruleId),
          overriddenRule: this.getRuleById(highestResult.ruleId),
          finalDecision: 'HARD_RULE_OVERRIDES',
          confidence: sortedResults[i].adjustedScore,
          explanation: `Hard rule overrides: ${sortedResults[i].explanation}`
        };
        this.decisionHistory.push(decision);
        return decision;
      }
    }

    // No hard rules, apply highest priority override
    const decision: HierarchyDecision = {
      appliedRule: this.getRuleById(highestResult.ruleId),
      overriddenRule: null,
      finalDecision: 'OVERRIDE_APPLIED',
      confidence: highestResult.adjustedScore,
      explanation: highestResult.explanation
    };
    this.decisionHistory.push(decision);
    return decision;
  }

  /**
   * Get priority for a rule ID
   */
  private getRulePriority(ruleId: string): OverridePriority {
    // Map rule IDs to priorities
    const priorityMap: Record<string, OverridePriority> = {
      'BANK_EXCLUSION': OverridePriority.HARD_SAFETY,
      'STRONG_TOTAL_LABEL': OverridePriority.SEMANTIC_OVERRIDE,
      'LINE_ITEM_DOMINANCE': OverridePriority.SEMANTIC_OVERRIDE,
      'HEADER_INVOICE_OVERRIDE': OverridePriority.SEMANTIC_OVERRIDE,
      'SKU_TABLE_OVERRIDE': OverridePriority.REGION_PROBABILITY,
      'ACCOUNT_BANK_OVERRIDE': OverridePriority.SEMANTIC_OVERRIDE,
      'CURRENCY_PROXIMITY': OverridePriority.GRAPH_SCORE,
      'PO_REFERENCE': OverridePriority.GRAPH_SCORE
    };

    return priorityMap[ruleId] || OverridePriority.RAW_CONFIDENCE;
  }

  /**
   * Get rule by ID (placeholder - would need access to rule registry)
   */
  private getRuleById(ruleId: string): OverrideRule | null {
    // This would typically access the SemanticOverrideEngine's rules
    // For now, return a placeholder
    return {
      id: ruleId,
      name: ruleId,
      trigger: '',
      condition: () => false,
      weightBoost: 0,
      explanation: '',
      priority: this.getRulePriority(ruleId),
      isHardRule: this.getRulePriority(ruleId) >= OverridePriority.HARD_SAFETY
    };
  }

  /**
   * Check if a rule at given priority can be overridden
   */
  canOverride(priority: OverridePriority): boolean {
    const level = this.levels.get(priority);
    return level?.isOverrideable || false;
  }

  /**
   * Get hierarchy level
   */
  getLevel(priority: OverridePriority): HierarchyLevel | undefined {
    return this.levels.get(priority);
  }

  /**
   * Get all hierarchy levels
   */
  getAllLevels(): HierarchyLevel[] {
    return Array.from(this.levels.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get decision history
   */
  getDecisionHistory(): HierarchyDecision[] {
    return [...this.decisionHistory];
  }

  /**
   * Clear decision history
   */
  clearHistory(): void {
    this.decisionHistory = [];
  }

  /**
   * Add custom hierarchy level
   */
  addLevel(level: HierarchyLevel): void {
    this.levels.set(level.priority, level);
    console.log(`[OverrideHierarchy] Added level: ${level.name} (priority: ${level.priority})`);
  }

  /**
   * Remove hierarchy level
   */
  removeLevel(priority: OverridePriority): void {
    this.levels.delete(priority);
    console.log(`[OverrideHierarchy] Removed level with priority: ${priority}`);
  }

  /**
   * Log hierarchy state
   */
  logHierarchyState(): void {
    console.log('\n=== OVERRIDE HIERARCHY ===');
    
    const sortedLevels = Array.from(this.levels.values()).sort((a, b) => b.priority - a.priority);
    
    for (const level of sortedLevels) {
      console.log(`\n${level.name}:`);
      console.log(`  Priority: ${level.priority}`);
      console.log(`  Description: ${level.description}`);
      console.log(`  Overrideable: ${level.isOverrideable}`);
    }
    
    console.log('\n=== END HIERARCHY ===\n');
  }

  /**
   * Log decision history
   */
  logDecisionHistory(): void {
    console.log('\n=== HIERARCHY DECISION HISTORY ===');
    
    for (let i = 0; i < this.decisionHistory.length; i++) {
      const decision = this.decisionHistory[i];
      console.log(`\nDecision ${i + 1}:`);
      console.log(`  Final Decision: ${decision.finalDecision}`);
      console.log(`  Confidence: ${decision.confidence.toFixed(3)}`);
      console.log(`  Explanation: ${decision.explanation}`);
      if (decision.appliedRule) {
        console.log(`  Applied Rule: ${decision.appliedRule.name}`);
      }
      if (decision.overriddenRule) {
        console.log(`  Overridden Rule: ${decision.overriddenRule.name}`);
      }
    }
    
    console.log('\n=== END HISTORY ===\n');
  }
}
