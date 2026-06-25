/**
 * DSRS v3.5 - Convergence Controller
 * 
 * Meta-layer above GraphReweightingLoop that decides when to stop iterating
 * Prevents oscillation loops and over-correction bias
 */

import { FieldType } from '../tournament/Candidate';
import { ReweightingIteration, ReweightingResult } from '../coherence/GraphReweightingLoop';

export interface ConvergenceConfig {
  epsilon: number; // Minimum improvement threshold
  stableIterations: number; // Number of iterations with < epsilon improvement to stop
  maxIterations: number; // Absolute maximum iterations
  fieldFlipThreshold: number; // Max flip rate before stopping
  scoreDeltaVarianceThreshold: number; // Max variance before stopping
}

export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  epsilon: 0.01, // 1% minimum improvement
  stableIterations: 2, // Stop if 2 consecutive iterations have < epsilon improvement
  maxIterations: 5, // Absolute maximum
  fieldFlipThreshold: 0.5, // Stop if flip rate > 50%
  scoreDeltaVarianceThreshold: 0.1 // Stop if variance > 0.1
};

export interface StabilityMetrics {
  coherenceTrend: number; // Rate of coherence improvement
  fieldFlipRate: number; // Rate of field winner changes
  scoreDeltaVariance: number; // Variance in score changes
  overallStability: number; // Combined stability score
}

export interface ConvergenceDecision {
  shouldStop: boolean;
  reason: 'STABLE' | 'MAX_ITERATIONS' | 'OSCILLATION' | 'HIGH_FLIP_RATE' | 'HIGH_VARIANCE';
  stabilityMetrics: StabilityMetrics;
  recommendedAction?: string;
}

export class ConvergenceController {
  private config: ConvergenceConfig;
  private coherenceHistory: number[];
  private fieldHistory: Map<FieldType, any[]>;
  private scoreDeltaHistory: number[];

  constructor(config: ConvergenceConfig = DEFAULT_CONVERGENCE_CONFIG) {
    this.config = config;
    this.coherenceHistory = [];
    this.fieldHistory = new Map();
    this.scoreDeltaHistory = [];
  }

  /**
   * Evaluate convergence based on iteration history
   */
  evaluateConvergence(iteration: ReweightingIteration): ConvergenceDecision {
    console.log(`[ConvergenceController] Evaluating convergence for iteration ${iteration.iteration}`);

    // Update history
    this.coherenceHistory.push(iteration.coherenceScore);
    this.scoreDeltaHistory.push(iteration.candidatesAdjusted);

    // Calculate stability metrics
    const stabilityMetrics = this.calculateStabilityMetrics();

    // Check stopping conditions
    const decision = this.makeConvergenceDecision(stabilityMetrics);

    console.log(`[ConvergenceController] Decision: ${decision.reason}, Stability: ${stabilityMetrics.overallStability.toFixed(3)}`);

    return decision;
  }

  /**
   * Calculate stability metrics
   */
  private calculateStabilityMetrics(): StabilityMetrics {
    const coherenceTrend = this.calculateCoherenceTrend();
    const fieldFlipRate = this.calculateFieldFlipRate();
    const scoreDeltaVariance = this.calculateScoreDeltaVariance();
    const overallStability = this.calculateOverallStability(coherenceTrend, fieldFlipRate, scoreDeltaVariance);

    return {
      coherenceTrend,
      fieldFlipRate,
      scoreDeltaVariance,
      overallStability
    };
  }

  /**
   * Calculate coherence trend (rate of improvement)
   */
  private calculateCoherenceTrend(): number {
    if (this.coherenceHistory.length < 2) {
      return 1.0; // High trend if insufficient data
    }

    const recent = this.coherenceHistory.slice(-3); // Last 3 iterations
    let trend = 0;

    for (let i = 1; i < recent.length; i++) {
      trend += recent[i] - recent[i - 1];
    }

    trend /= (recent.length - 1);

    // Normalize to [0, 1]
    return Math.max(0, Math.min(1, trend * 10)); // Scale up for sensitivity
  }

  /**
   * Calculate field flip rate
   */
  private calculateFieldFlipRate(): number {
    if (this.fieldHistory.size === 0) {
      return 0;
    }

    let totalFlips = 0;
    let totalFields = 0;

    for (const [field, history] of this.fieldHistory.entries()) {
      if (history.length < 2) continue;

      let flips = 0;
      for (let i = 1; i < history.length; i++) {
        if (this.valuesDiffer(history[i], history[i - 1])) {
          flips++;
        }
      }

      totalFlips += flips;
      totalFields++;
    }

    if (totalFields === 0) return 0;

    return totalFlips / totalFields;
  }

  /**
   * Calculate score delta variance
   */
  private calculateScoreDeltaVariance(): number {
    if (this.scoreDeltaHistory.length < 2) {
      return 0;
    }

    const deltas = this.scoreDeltaHistory.slice(-3);
    const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    const variance = deltas.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / deltas.length;

    // Normalize to [0, 1]
    return Math.min(1, variance / 100); // Scale down
  }

  /**
   * Calculate overall stability score
   */
  private calculateOverallStability(
    coherenceTrend: number,
    fieldFlipRate: number,
    scoreDeltaVariance: number
  ): number {
    // Higher coherence trend = more stable
    // Lower field flip rate = more stable
    // Lower score variance = more stable

    const stability =
      (coherenceTrend * 0.4) +
      ((1 - fieldFlipRate) * 0.3) +
      ((1 - scoreDeltaVariance) * 0.3);

    return stability;
  }

  /**
   * Make convergence decision
   */
  private makeConvergenceDecision(stabilityMetrics: StabilityMetrics): ConvergenceDecision {
    // Check for stable convergence (epsilon-based)
    if (this.coherenceHistory.length >= this.config.stableIterations) {
      const recent = this.coherenceHistory.slice(-this.config.stableIterations);
      let allBelowEpsilon = true;

      for (let i = 1; i < recent.length; i++) {
        if (recent[i] - recent[i - 1] > this.config.epsilon) {
          allBelowEpsilon = false;
          break;
        }
      }

      if (allBelowEpsilon) {
        return {
          shouldStop: true,
          reason: 'STABLE',
          stabilityMetrics,
          recommendedAction: 'Convergence achieved - stop iteration'
        };
      }
    }

    // Check for oscillation (negative coherence trend)
    if (stabilityMetrics.coherenceTrend < -0.1) {
      return {
        shouldStop: true,
        reason: 'OSCILLATION',
        stabilityMetrics,
        recommendedAction: 'Oscillation detected - stop to prevent ping-pong'
      };
    }

    // Check for high flip rate
    if (stabilityMetrics.fieldFlipRate > this.config.fieldFlipThreshold) {
      return {
        shouldStop: true,
        reason: 'HIGH_FLIP_RATE',
        stabilityMetrics,
        recommendedAction: 'Field flip rate too high - stop iteration'
      };
    }

    // Check for high variance
    if (stabilityMetrics.scoreDeltaVariance > this.config.scoreDeltaVarianceThreshold) {
      return {
        shouldStop: true,
        reason: 'HIGH_VARIANCE',
        stabilityMetrics,
        recommendedAction: 'Score variance too high - stop iteration'
      };
    }

    // Check max iterations
    if (this.coherenceHistory.length >= this.config.maxIterations) {
      return {
        shouldStop: true,
        reason: 'MAX_ITERATIONS',
        stabilityMetrics,
        recommendedAction: 'Maximum iterations reached - force stop'
      };
    }

    // Continue iteration
    return {
      shouldStop: false,
      reason: 'STABLE',
      stabilityMetrics,
      recommendedAction: 'Continue iteration'
    };
  }

  /**
   * Update field history
   */
  updateFieldHistory(field: FieldType, winner: any): void {
    if (!this.fieldHistory.has(field)) {
      this.fieldHistory.set(field, []);
    }
    this.fieldHistory.get(field)!.push(winner);
  }

  /**
   * Check if two values differ
   */
  private valuesDiffer(value1: any, value2: any): boolean {
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      return Math.abs(value1 - value2) > 0.01;
    }
    return value1 !== value2;
  }

  /**
   * Reset controller state
   */
  reset(): void {
    this.coherenceHistory = [];
    this.fieldHistory = new Map();
    this.scoreDeltaHistory = [];
  }

  /**
   * Update convergence configuration
   */
  updateConfig(config: Partial<ConvergenceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ConvergenceConfig {
    return { ...this.config };
  }

  /**
   * Get convergence history
   */
  getHistory() {
    return {
      coherenceHistory: [...this.coherenceHistory],
      fieldHistory: new Map(this.fieldHistory),
      scoreDeltaHistory: [...this.scoreDeltaHistory]
    };
  }

  /**
   * Log convergence state
   */
  logConvergenceState(): void {
    console.log('\n=== CONVERGENCE STATE ===');
    console.log(`Coherence History:`, this.coherenceHistory.map(c => c.toFixed(3)));
    console.log(`Score Delta History:`, this.scoreDeltaHistory);
    console.log(`Field History:`, this.fieldHistory);
    console.log('=== END CONVERGENCE STATE ===\n');
  }
}
