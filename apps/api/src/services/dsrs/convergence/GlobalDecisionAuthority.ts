/**
 * DSRS v3.5 - Global Decision Authority
 * 
 * Final decision layer that selects winners based on stability-weighted scoring
 * Instead of "best candidate wins", it's "best stable candidate wins"
 */

import { Candidate, FieldType } from '../tournament/Candidate';
import { FieldFlipTracker } from './FieldFlipTracker';
import { CausalConflictModel, ConflictFlag } from './CausalConflictModel';

export interface DecisionAuthorityConfig {
  stabilityWeight: number;
  tournamentWeight: number;
  conflictPenaltyWeight: number;
  minStabilityThreshold: number;
}

export const DEFAULT_DECISION_AUTHORITY_CONFIG: DecisionAuthorityConfig = {
  stabilityWeight: 0.4,
  tournamentWeight: 0.6,
  conflictPenaltyWeight: 0.3,
  minStabilityThreshold: 0.5
};

export interface FinalDecision {
  field: FieldType;
  winner: Candidate;
  stabilityScore: number;
  finalScore: number;
  reasoning: string;
  conflictFlags: ConflictFlag[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class GlobalDecisionAuthority {
  private config: DecisionAuthorityConfig;
  private fieldFlipTracker: FieldFlipTracker;
  private conflictModel: CausalConflictModel;

  constructor(
    config: DecisionAuthorityConfig = DEFAULT_DECISION_AUTHORITY_CONFIG,
    fieldFlipTracker?: FieldFlipTracker,
    conflictModel?: CausalConflictModel
  ) {
    this.config = config;
    this.fieldFlipTracker = fieldFlipTracker || new FieldFlipTracker();
    this.conflictModel = conflictModel || new CausalConflictModel();
  }

  /**
   * Make final decision for a field
   */
  makeFinalDecision(
    field: FieldType,
    candidates: Candidate[],
    conflictFlags: ConflictFlag[]
  ): FinalDecision {
    console.log(`\n[GlobalDecisionAuthority] Making final decision for ${field}`);

    if (candidates.length === 0) {
      throw new Error(`No candidates for field: ${field}`);
    }

    // Calculate stability score for this field
    const stabilityScore = this.fieldFlipTracker.getStabilityFactor(field);

    // Calculate conflict penalty
    const conflictPenalty = this.calculateConflictPenalty(conflictFlags);

    // Score each candidate with stability weighting
    const scoredCandidates = candidates.map(candidate => {
      const tournamentScore = candidate.globalScore;
      const finalScore = this.calculateFinalScore(
        tournamentScore,
        stabilityScore,
        conflictPenalty
      );

      return {
        candidate,
        tournamentScore,
        stabilityScore,
        conflictPenalty,
        finalScore
      };
    });

    // Sort by final score
    scoredCandidates.sort((a, b) => b.finalScore - a.finalScore);

    const winner = scoredCandidates[0];
    const confidence = this.calculateConfidence(winner.finalScore, stabilityScore);

    const reasoning = this.generateReasoning(winner, conflictFlags);

    const decision: FinalDecision = {
      field,
      winner: winner.candidate,
      stabilityScore: winner.stabilityScore,
      finalScore: winner.finalScore,
      reasoning,
      conflictFlags,
      confidence
    };

    console.log(`[GlobalDecisionAuthority] Winner: ${winner.candidate.value}, Final Score: ${winner.finalScore.toFixed(3)}, Confidence: ${confidence}`);

    return decision;
  }

  /**
   * Calculate final score from components
   */
  private calculateFinalScore(
    tournamentScore: number,
    stabilityScore: number,
    conflictPenalty: number
  ): number {
    const finalScore =
      (tournamentScore * this.config.tournamentWeight) +
      (stabilityScore * this.config.stabilityWeight) -
      (conflictPenalty * this.config.conflictPenaltyWeight);

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, finalScore));
  }

  /**
   * Calculate conflict penalty from flags
   */
  private calculateConflictPenalty(conflictFlags: ConflictFlag[]): number {
    if (conflictFlags.length === 0) return 0;

    const combinedWeight = this.conflictModel.calculateCombinedWeight(conflictFlags);
    return combinedWeight;
  }

  /**
   * Calculate confidence level from final score and stability
   */
  private calculateConfidence(finalScore: number, stabilityScore: number): 'HIGH' | 'MEDIUM' | 'LOW' {
    const combinedScore = (finalScore + stabilityScore) / 2;

    if (combinedScore >= 0.8) return 'HIGH';
    if (combinedScore >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate reasoning for the decision
   */
  private generateReasoning(
    winner: { candidate: Candidate; tournamentScore: number; stabilityScore: number; conflictPenalty: number; finalScore: number },
    conflictFlags: ConflictFlag[]
  ): string {
    const reasons: string[] = [];

    reasons.push(`Tournament score: ${winner.tournamentScore.toFixed(3)}`);
    reasons.push(`Stability score: ${winner.stabilityScore.toFixed(3)}`);

    if (winner.conflictPenalty > 0) {
      reasons.push(`Conflict penalty: -${winner.conflictPenalty.toFixed(3)}`);
    }

    reasons.push(`Final score: ${winner.finalScore.toFixed(3)}`);

    if (conflictFlags.length > 0) {
      reasons.push(`Conflicts: ${conflictFlags.join(', ')}`);
    }

    return reasons.join('. ');
  }

  /**
   * Make final decisions for all fields
   */
  makeFinalDecisions(
    fieldCandidates: Map<FieldType, Candidate[]>,
    fieldConflicts: Map<FieldType, ConflictFlag[]>
  ): Map<FieldType, FinalDecision> {
    const decisions = new Map<FieldType, FinalDecision>();

    for (const [field, candidates] of fieldCandidates.entries()) {
      const conflicts = fieldConflicts.get(field) || [];
      const decision = this.makeFinalDecision(field, candidates, conflicts);
      decisions.set(field, decision);
    }

    return decisions;
  }

  /**
   * Set field flip tracker
   */
  setFieldFlipTracker(tracker: FieldFlipTracker): void {
    this.fieldFlipTracker = tracker;
  }

  /**
   * Set conflict model
   */
  setConflictModel(model: CausalConflictModel): void {
    this.conflictModel = model;
  }

  /**
   * Update decision authority configuration
   */
  updateConfig(config: Partial<DecisionAuthorityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DecisionAuthorityConfig {
    return { ...this.config };
  }

  /**
   * Log decision statistics
   */
  logDecisionStats(decisions: Map<FieldType, FinalDecision>): void {
    console.log('\n=== GLOBAL DECISION AUTHORITY STATISTICS ===');
    
    for (const [field, decision] of decisions.entries()) {
      console.log(`\n${field.toUpperCase()}:`);
      console.log(`  Winner: ${decision.winner.value}`);
      console.log(`  Stability Score: ${decision.stabilityScore.toFixed(3)}`);
      console.log(`  Final Score: ${decision.finalScore.toFixed(3)}`);
      console.log(`  Confidence: ${decision.confidence}`);
      console.log(`  Reasoning: ${decision.reasoning}`);
    }
    
    console.log('\n=== END DECISION STATISTICS ===\n');
  }
}
