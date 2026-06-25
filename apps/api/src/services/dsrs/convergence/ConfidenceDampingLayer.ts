/**
 * DSRS v3.5 - Confidence Damping Layer
 * 
 * Reduces reweighting impact on unstable fields
 * Prevents system from aggressively forcing decisions on noisy OCR fields
 */

import { FieldType } from '../tournament/Candidate';
import { FieldFlipTracker } from './FieldFlipTracker';

export interface DampingConfig {
  stableFactor: number;
  unstableFactor: number;
  highlyUnstableFactor: number;
  minAdjustment: number;
  maxAdjustment: number;
}

export const DEFAULT_DAMPING_CONFIG: DampingConfig = {
  stableFactor: 1.0,
  unstableFactor: 0.5,
  highlyUnstableFactor: 0.2,
  minAdjustment: 0.01,
  maxAdjustment: 0.3
};

export class ConfidenceDampingLayer {
  private config: DampingConfig;
  private fieldFlipTracker: FieldFlipTracker;

  constructor(config: DampingConfig = DEFAULT_DAMPING_CONFIG) {
    this.config = config;
    this.fieldFlipTracker = new FieldFlipTracker();
  }

  /**
   * Apply damping to a reweighting adjustment
   */
  applyDamping(
    field: FieldType,
    adjustment: number,
    baseConfidence: number
  ): number {
    const stabilityFactor = this.fieldFlipTracker.getStabilityFactor(field);
    const confidenceFactor = this.calculateConfidenceFactor(baseConfidence);
    
    // Combine stability and confidence factors
    const dampingFactor = stabilityFactor * confidenceFactor;
    
    // Apply damping
    const dampedAdjustment = adjustment * dampingFactor;
    
    // Clamp to configured bounds
    const clampedAdjustment = Math.max(
      this.config.minAdjustment,
      Math.min(this.config.maxAdjustment, Math.abs(dampedAdjustment))
    ) * Math.sign(dampedAdjustment);
    
    console.log(`[DampingLayer] Field: ${field}, Original: ${adjustment.toFixed(3)}, Damped: ${clampedAdjustment.toFixed(3)}, Factor: ${dampingFactor.toFixed(2)}`);
    
    return clampedAdjustment;
  }

  /**
   * Calculate confidence factor from base confidence
   */
  private calculateConfidenceFactor(baseConfidence: number): number {
    // Lower base confidence = more damping
    if (baseConfidence >= 0.8) return 1.0;
    if (baseConfidence >= 0.5) return 0.7;
    return 0.4;
  }

  /**
   * Record field winner for flip tracking
   */
  recordWinner(field: FieldType, winner: any): void {
    this.fieldFlipTracker.recordWinner(field, winner);
  }

  /**
   * Get field flip tracker
   */
  getFieldFlipTracker(): FieldFlipTracker {
    return this.fieldFlipTracker;
  }

  /**
   * Update damping configuration
   */
  updateConfig(config: Partial<DampingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DampingConfig {
    return { ...this.config };
  }

  /**
   * Reset damping layer
   */
  reset(): void {
    this.fieldFlipTracker.reset();
  }

  /**
   * Log damping statistics
   */
  logDampingStats(): void {
    console.log('\n=== DAMPING LAYER STATISTICS ===');
    console.log('Configuration:', this.config);
    this.fieldFlipTracker.logFlipStats();
    console.log('=== END DAMPING STATISTICS ===\n');
  }
}
