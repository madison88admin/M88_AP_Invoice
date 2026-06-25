/**
 * DSRS v4.5 - Soft Region Model
 * 
 * Replaces hard region binding with probabilistic regions
 * Allows flexibility under ambiguity without breaking structure
 */

import { RegionType } from '../LayoutGraphBuilder';
import { FieldType } from '../../tournament/Candidate';

export interface RegionBelief {
  region: RegionType;
  probability: number; // 0.0 - 1.0, likelihood this is correct region
  confidence: number; // 0.0 - 1.0, OCR + layout quality
  stability: number; // 0.0 - 1.0, how consistent region detection is
}

export interface FieldRegionBeliefs {
  field: FieldType;
  beliefs: Map<RegionType, RegionBelief>;
  dominantRegion: RegionType | null;
  uncertainty: number; // 0.0 - 1.0, how uncertain we are about region assignment
}

export class SoftRegionModel {
  private fieldBeliefs: Map<FieldType, FieldRegionBeliefs>;
  private regionHistory: Map<RegionType, number[]>; // Track confidence over time

  constructor() {
    this.fieldBeliefs = new Map();
    this.regionHistory = new Map();
  }

  /**
   * Initialize field beliefs with default probabilities
   */
  initializeFieldBeliefs(field: FieldType, defaultBeliefs: Map<RegionType, RegionBelief>): void {
    const beliefs = new Map(defaultBeliefs);
    
    // Calculate dominant region and uncertainty
    const dominantRegion = this.calculateDominantRegion(beliefs);
    const uncertainty = this.calculateUncertainty(beliefs);

    this.fieldBeliefs.set(field, {
      field,
      beliefs,
      dominantRegion,
      uncertainty
    });

    console.log(`[SoftRegionModel] Initialized beliefs for ${field}:`, {
      dominantRegion,
      uncertainty,
      beliefs: Array.from(beliefs.entries()).map(([r, b]) => `${r}: ${b.probability.toFixed(2)}`)
    });
  }

  /**
   * Update region belief for a field
   */
  updateBelief(field: FieldType, region: RegionType, belief: Partial<RegionBelief>): void {
    const fieldBelief = this.fieldBeliefs.get(field);
    if (!fieldBelief) {
      console.log(`[SoftRegionModel] Field ${field} not initialized, skipping update`);
      return;
    }

    const existingBelief = fieldBelief.beliefs.get(region);
    if (!existingBelief) {
      console.log(`[SoftRegionModel] Region ${region} not found for field ${field}, skipping update`);
      return;
    }

    // Update belief
    const updatedBelief = { ...existingBelief, ...belief };
    fieldBelief.beliefs.set(region, updatedBelief);

    // Recalculate dominant region and uncertainty
    fieldBelief.dominantRegion = this.calculateDominantRegion(fieldBelief.beliefs);
    fieldBelief.uncertainty = this.calculateUncertainty(fieldBelief.beliefs);

    // Track history
    this.trackRegionHistory(region, updatedBelief.confidence);

    console.log(`[SoftRegionModel] Updated belief for ${field} in ${region}:`, {
      probability: updatedBelief.probability.toFixed(2),
      confidence: updatedBelief.confidence.toFixed(2),
      dominantRegion: fieldBelief.dominantRegion,
      uncertainty: fieldBelief.uncertainty.toFixed(2)
    });
  }

  /**
   * Get beliefs for a field
   */
  getFieldBeliefs(field: FieldType): FieldRegionBeliefs | undefined {
    return this.fieldBeliefs.get(field);
  }

  /**
   * Get belief for a specific field-region pair
   */
  getBelief(field: FieldType, region: RegionType): RegionBelief | undefined {
    const fieldBelief = this.fieldBeliefs.get(field);
    return fieldBelief?.beliefs.get(region);
  }

  /**
   * Get dominant region for a field
   */
  getDominantRegion(field: FieldType): RegionType | null {
    const fieldBelief = this.fieldBeliefs.get(field);
    return fieldBelief?.dominantRegion || null;
  }

  /**
   * Get uncertainty for a field
   */
  getUncertainty(field: FieldType): number {
    const fieldBelief = this.fieldBeliefs.get(field);
    return fieldBelief?.uncertainty || 1.0;
  }

  /**
   * Check if field is uncertain (above threshold)
   */
  isFieldUncertain(field: FieldType, threshold: number = 0.3): boolean {
    return this.getUncertainty(field) > threshold;
  }

  /**
   * Calculate dominant region (highest probability)
   */
  private calculateDominantRegion(beliefs: Map<RegionType, RegionBelief>): RegionType | null {
    let maxProb = 0;
    let dominantRegion: RegionType | null = null;

    for (const [region, belief] of beliefs.entries()) {
      if (belief.probability > maxProb) {
        maxProb = belief.probability;
        dominantRegion = region;
      }
    }

    return dominantRegion;
  }

  /**
   * Calculate uncertainty (entropy of probability distribution)
   */
  private calculateUncertainty(beliefs: Map<RegionType, RegionBelief>): number {
    let entropy = 0;
    let totalProb = 0;

    for (const belief of beliefs.values()) {
      totalProb += belief.probability;
    }

    // Normalize probabilities
    for (const belief of beliefs.values()) {
      if (totalProb > 0) {
        const p = belief.probability / totalProb;
        if (p > 0) {
          entropy -= p * Math.log2(p);
        }
      }
    }

    // Normalize entropy to [0, 1]
    const maxEntropy = Math.log2(beliefs.size);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /**
   * Track region confidence history
   */
  private trackRegionHistory(region: RegionType, confidence: number): void {
    if (!this.regionHistory.has(region)) {
      this.regionHistory.set(region, []);
    }
    
    const history = this.regionHistory.get(region)!;
    history.push(confidence);
    
    // Keep only last 10 values
    if (history.length > 10) {
      history.shift();
    }
  }

  /**
   * Get region stability (variance of confidence history)
   */
  getRegionStability(region: RegionType): number {
    const history = this.regionHistory.get(region);
    if (!history || history.length < 2) return 1.0;

    const mean = history.reduce((sum, val) => sum + val, 0) / history.length;
    const variance = history.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / history.length;
    
    // Convert variance to stability (1 - normalized variance)
    return Math.max(0, 1 - Math.sqrt(variance));
  }

  /**
   * Apply Bayesian update to beliefs
   */
  bayesianUpdate(field: FieldType, evidence: Map<RegionType, number>): void {
    const fieldBelief = this.fieldBeliefs.get(field);
    if (!fieldBelief) return;

    for (const [region, evidenceProb] of evidence.entries()) {
      const belief = fieldBelief.beliefs.get(region);
      if (belief) {
        // Bayesian update: P(H|E) = P(E|H) * P(H) / P(E)
        const prior = belief.probability;
        const likelihood = evidenceProb;
        const posterior = (likelihood * prior) / (likelihood * prior + (1 - likelihood) * (1 - prior));
        
        this.updateBelief(field, region, { probability: posterior });
      }
    }
  }

  /**
   * Get all field beliefs
   */
  getAllFieldBeliefs(): Map<FieldType, FieldRegionBeliefs> {
    return new Map(this.fieldBeliefs);
  }

  /**
   * Reset all beliefs
   */
  reset(): void {
    this.fieldBeliefs.clear();
    this.regionHistory.clear();
  }

  /**
   * Log belief state
   */
  logBeliefState(): void {
    console.log('\n=== SOFT REGION MODEL STATE ===');
    
    for (const [field, fieldBelief] of this.fieldBeliefs.entries()) {
      console.log(`\n${field}:`);
      console.log(`  Dominant Region: ${fieldBelief.dominantRegion}`);
      console.log(`  Uncertainty: ${fieldBelief.uncertainty.toFixed(3)}`);
      console.log(`  Beliefs:`);
      
      for (const [region, belief] of fieldBelief.beliefs.entries()) {
        console.log(`    ${region}:`);
        console.log(`      Probability: ${belief.probability.toFixed(3)}`);
        console.log(`      Confidence: ${belief.confidence.toFixed(3)}`);
        console.log(`      Stability: ${belief.stability.toFixed(3)}`);
      }
    }
    
    console.log('\n=== END BELIEF STATE ===\n');
  }
}
