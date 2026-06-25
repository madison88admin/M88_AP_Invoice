/**
 * DSRS v3.5 - Causal Conflict Model
 * 
 * Classifies conflicts by severity (HARD/SOFT/NOISE)
 * Applies conflict severity to reweighting instead of treating all conflicts equally
 */

import { ConflictFlag } from '../coherence/CrossFieldCoherenceEngine';

export type { ConflictFlag } from '../coherence/CrossFieldCoherenceEngine';

export type ConflictSeverity = 'HARD' | 'SOFT' | 'NOISE';

export interface ConflictClassification {
  flag: ConflictFlag;
  severity: ConflictSeverity;
  reweightingWeight: number; // How much this conflict should affect reweighting
  description: string;
}

export interface ConflictModelConfig {
  hardConflictWeight: number;
  softConflictWeight: number;
  noiseConflictWeight: number;
}

export const DEFAULT_CONFLICT_MODEL_CONFIG: ConflictModelConfig = {
  hardConflictWeight: 1.0, // Full reweighting impact
  softConflictWeight: 0.5, // Reduced impact
  noiseConflictWeight: 0.1 // Minimal impact
};

export class CausalConflictModel {
  private config: ConflictModelConfig;
  private conflictRules: Map<ConflictFlag, ConflictClassification>;

  constructor(config: ConflictModelConfig = DEFAULT_CONFLICT_MODEL_CONFIG) {
    this.config = config;
    this.conflictRules = this.initializeConflictRules();
  }

  /**
   * Initialize conflict classification rules
   */
  private initializeConflictRules(): Map<ConflictFlag, ConflictClassification> {
    const rules = new Map<ConflictFlag, ConflictClassification>();

    // HARD CONFLICTS (must override)
    rules.set('AMOUNT_PO_MISMATCH', {
      flag: 'AMOUNT_PO_MISMATCH',
      severity: 'HARD',
      reweightingWeight: this.config.hardConflictWeight,
      description: 'Amount significantly deviates from PO - high priority correction'
    });

    rules.set('VENDOR_MISMATCH', {
      flag: 'VENDOR_MISMATCH',
      severity: 'HARD',
      reweightingWeight: this.config.hardConflictWeight,
      description: 'Vendor does not match PO - high priority correction'
    });

    rules.set('AMOUNT_LINEITEM_MISMATCH', {
      flag: 'AMOUNT_LINEITEM_MISMATCH',
      severity: 'HARD',
      reweightingWeight: this.config.hardConflictWeight,
      description: 'Amount does not match line item total - high priority correction'
    });

    // SOFT CONFLICTS (informational)
    rules.set('CURRENCY_MISMATCH_MINOR', {
      flag: 'CURRENCY_MISMATCH_MINOR',
      severity: 'SOFT',
      reweightingWeight: this.config.softConflictWeight,
      description: 'Minor currency mismatch with FX context - informational'
    });

    rules.set('QTY_MISMATCH', {
      flag: 'QTY_MISMATCH',
      severity: 'SOFT',
      reweightingWeight: this.config.softConflictWeight,
      description: 'Quantity exceeds PO expected - informational'
    });

    // NOISE CONFLICTS (OCR ambiguity)
    rules.set('VENDOR_MISSING', {
      flag: 'VENDOR_MISSING',
      severity: 'NOISE',
      reweightingWeight: this.config.noiseConflictWeight,
      description: 'Vendor not detected - likely OCR issue, low priority'
    });

    rules.set('STRUCTURAL_INTEGRITY_LOW', {
      flag: 'STRUCTURAL_INTEGRITY_LOW',
      severity: 'NOISE',
      reweightingWeight: this.config.noiseConflictWeight,
      description: 'Poor structural integrity - likely OCR issue, low priority'
    });

    rules.set('CURRENCY_MISMATCH', {
      flag: 'CURRENCY_MISMATCH',
      severity: 'SOFT',
      reweightingWeight: this.config.softConflictWeight,
      description: 'Currency mismatch without FX context - informational'
    });

    return rules;
  }

  /**
   * Classify a conflict by severity
   */
  classifyConflict(flag: ConflictFlag): ConflictClassification {
    return this.conflictRules.get(flag) || {
      flag,
      severity: 'NOISE',
      reweightingWeight: this.config.noiseConflictWeight,
      description: 'Unknown conflict - treated as noise'
    };
  }

  /**
   * Get reweighting weight for a conflict
   */
  getReweightingWeight(flag: ConflictFlag): number {
    const classification = this.classifyConflict(flag);
    return classification.reweightingWeight;
  }

  /**
   * Classify multiple conflicts
   */
  classifyConflicts(flags: ConflictFlag[]): ConflictClassification[] {
    return flags.map(flag => this.classifyConflict(flag));
  }

  /**
   * Calculate combined reweighting weight for multiple conflicts
   */
  calculateCombinedWeight(flags: ConflictFlag[]): number {
    if (flags.length === 0) return 0;

    let totalWeight = 0;
    let hardConflictCount = 0;

    for (const flag of flags) {
      const classification = this.classifyConflict(flag);
      totalWeight += classification.reweightingWeight;

      if (classification.severity === 'HARD') {
        hardConflictCount++;
      }
    }

    // If there are multiple hard conflicts, amplify the weight
    if (hardConflictCount > 1) {
      totalWeight *= 1.2;
    }

    // Normalize to [0, 1]
    return Math.min(1.0, totalWeight);
  }

  /**
   * Check if any conflict is HARD severity
   */
  hasHardConflict(flags: ConflictFlag[]): boolean {
    for (const flag of flags) {
      const classification = this.classifyConflict(flag);
      if (classification.severity === 'HARD') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get conflicts by severity
   */
  getConflictsBySeverity(flags: ConflictFlag[], severity: ConflictSeverity): ConflictFlag[] {
    return flags.filter(flag => {
      const classification = this.classifyConflict(flag);
      return classification.severity === severity;
    });
  }

  /**
   * Add custom conflict rule
   */
  addConflictRule(
    flag: ConflictFlag,
    severity: ConflictSeverity,
    description: string
  ): void {
    let weight: number;
    switch (severity) {
      case 'HARD':
        weight = this.config.hardConflictWeight;
        break;
      case 'SOFT':
        weight = this.config.softConflictWeight;
        break;
      case 'NOISE':
        weight = this.config.noiseConflictWeight;
        break;
    }

    this.conflictRules.set(flag, {
      flag,
      severity,
      reweightingWeight: weight,
      description
    });
  }

  /**
   * Update conflict model configuration
   */
  updateConfig(config: Partial<ConflictModelConfig>): void {
    this.config = { ...this.config, ...config };
    // Reinitialize rules with new config
    this.conflictRules = this.initializeConflictRules();
  }

  /**
   * Get current configuration
   */
  getConfig(): ConflictModelConfig {
    return { ...this.config };
  }

  /**
   * Log conflict classification
   */
  logConflictClassification(flags: ConflictFlag[]): void {
    console.log('\n=== CONFLICT CLASSIFICATION ===');
    
    const classifications = this.classifyConflicts(flags);
    
    for (const classification of classifications) {
      console.log(`\n${classification.flag}:`);
      console.log(`  Severity: ${classification.severity}`);
      console.log(`  Reweighting Weight: ${classification.reweightingWeight.toFixed(2)}`);
      console.log(`  Description: ${classification.description}`);
    }
    
    const combinedWeight = this.calculateCombinedWeight(flags);
    const hasHard = this.hasHardConflict(flags);
    
    console.log(`\nCombined Weight: ${combinedWeight.toFixed(3)}`);
    console.log(`Has Hard Conflict: ${hasHard}`);
    console.log('=== END CONFLICT CLASSIFICATION ===\n');
  }
}
