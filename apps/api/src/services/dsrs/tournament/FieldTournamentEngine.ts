/**
 * DSRS v2.5 - Field Tournament Engine
 * 
 * Core scoring and competition engine for field resolution
 * All candidates compete under the same scoring rules
 */

import { Candidate, FieldType, ScoreBreakdown, TournamentResult } from './Candidate';
import { AnchorHierarchy, AnchorTier } from '../AnchorHierarchy';
import { CandidateGraph, GraphNode } from '../CandidateGraphBuilder';

export type { TournamentResult } from './Candidate';

export interface TournamentConfig {
  roleWeight: number;
  graphWeight: number;
  contextWeight: number;
  confidenceWeight: number;
  anchorBoost: number;
  tableRowBoost: number;
  skuRowBoost: number;
  qtyPriceBoost: number;
  bankPenalty: number;
  swiftPenalty: number;
  longNumericPenalty: number;
  poStructureBonus: number;
  vendorHistoricalBonus: number;
}

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  roleWeight: 0.35,
  graphWeight: 0.30,
  contextWeight: 0.20,
  confidenceWeight: 0.15,
  anchorBoost: 0.25,
  tableRowBoost: 0.15,
  skuRowBoost: 0.20,
  qtyPriceBoost: 0.10,
  bankPenalty: -0.50,
  swiftPenalty: -0.60,
  longNumericPenalty: -0.30,
  poStructureBonus: 0.20,
  vendorHistoricalBonus: 0.15
};

export class FieldTournamentEngine {
  private config: TournamentConfig;
  private anchorHierarchy: AnchorHierarchy;

  constructor(config: TournamentConfig = DEFAULT_TOURNAMENT_CONFIG) {
    this.config = config;
    this.anchorHierarchy = new AnchorHierarchy();
  }

  /**
   * Run tournament for a specific field
   */
  resolveField(
    field: FieldType,
    candidates: Candidate[],
    graph?: CandidateGraph
  ): TournamentResult {
    console.log(`\n=== Field Tournament: ${field.toUpperCase()} ===`);
    console.log(`Candidates: ${candidates.length}`);

    if (candidates.length === 0) {
      throw new Error(`No candidates for field: ${field}`);
    }

    // Score all candidates
    const scoredCandidates = candidates.map(candidate =>
      this.scoreCandidate(candidate, graph)
    );

    // Sort by global score descending
    scoredCandidates.sort((a, b) => b.globalScore - a.globalScore);

    const winner = scoredCandidates[0];
    const runnerUps = scoredCandidates.slice(1, 3);

    // Calculate confidence separation
    const confidenceSeparation = runnerUps.length > 0
      ? winner.globalScore - runnerUps[0].globalScore
      : 1.0;

    // Determine if consistency check is needed
    const requiresConsistencyCheck = confidenceSeparation < 0.15;

    // Generate explanation
    const explanation = this.generateExplanation(winner, runnerUps);

    console.log(`Winner: ${winner.value} (score: ${winner.globalScore.toFixed(3)})`);
    console.log(`Confidence separation: ${confidenceSeparation.toFixed(3)}`);
    console.log(`Requires consistency check: ${requiresConsistencyCheck}`);

    return {
      field,
      winner,
      runnerUps,
      scoreBreakdown: this.getScoreBreakdown(winner),
      explanation,
      confidenceSeparation,
      requiresConsistencyCheck
    };
  }

  /**
   * Score a single candidate with tournament rules
   */
  private scoreCandidate(candidate: Candidate, graph?: CandidateGraph): Candidate {
    // Base global score from weighted components
    let globalScore =
      candidate.roleScore * this.config.roleWeight +
      candidate.graphScore * this.config.graphWeight +
      candidate.contextScore * this.config.contextWeight +
      candidate.confidence * this.config.confidenceWeight;

    // Initialize tournament modifiers
    candidate.tournamentModifiers = {
      anchorBoost: 0,
      structuralBoost: 0,
      noisePenalty: 0,
      consistencyBonus: 0
    };

    // Rule 1: Anchor Boost (Tier-0 anchors)
    const anchorBoost = this.applyAnchorBoost(candidate, graph);
    candidate.tournamentModifiers.anchorBoost = anchorBoost;
    globalScore += anchorBoost;

    // Rule 2: Structural Validity Boost
    const structuralBoost = this.applyStructuralBoost(candidate);
    candidate.tournamentModifiers.structuralBoost = structuralBoost;
    globalScore += structuralBoost;

    // Rule 3: Noise Penalties
    const noisePenalty = this.applyNoisePenalty(candidate);
    candidate.tournamentModifiers.noisePenalty = noisePenalty;
    globalScore += noisePenalty;

    // Rule 4: Consistency Bonus (if historical data available)
    const consistencyBonus = this.applyConsistencyBonus(candidate);
    candidate.tournamentModifiers.consistencyBonus = consistencyBonus;
    globalScore += consistencyBonus;

    // Clamp score to [0, 1]
    globalScore = Math.max(0, Math.min(1, globalScore));

    candidate.globalScore = globalScore;
    candidate.explanation = this.generateCandidateExplanation(candidate);

    return candidate;
  }

  /**
   * Rule 1: Anchor Boost for Tier-0 anchors
   */
  private applyAnchorBoost(candidate: Candidate, graph?: CandidateGraph): number {
    if (!graph || !candidate.metadata.position) {
      return 0;
    }

    // Find Tier-0 anchors near candidate
    const allNodes = Array.from(graph.nodes.values());
    const tier0Anchors = this.anchorHierarchy.getAnchorsByTier(allNodes, AnchorTier.TIER_0_ABSOLUTE);

    for (const anchor of tier0Anchors) {
      const distance = Math.abs(anchor.node.position - candidate.metadata.position!);
      if (distance < 200) {
        console.log(`[Tournament] Anchor boost applied: ${candidate.value} near ${anchor.node.value}`);
        return this.config.anchorBoost;
      }
    }

    return 0;
  }

  /**
   * Rule 2: Structural Validity Boost
   */
  private applyStructuralBoost(candidate: Candidate): number {
    let boost = 0;

    // Table row boost
    if (candidate.metadata.isFromTable) {
      boost += this.config.tableRowBoost;
    }

    // SKU row alignment boost
    if (candidate.metadata.isFromLineItem) {
      boost += this.config.skuRowBoost;
    }

    // Qty/Unit Price context boost
    if (candidate.metadata.contextWindow) {
      const context = candidate.metadata.contextWindow.toLowerCase();
      if (context.includes('qty') || context.includes('unit') || context.includes('price')) {
        boost += this.config.qtyPriceBoost;
      }
    }

    return boost;
  }

  /**
   * Rule 3: Noise Penalties
   */
  private applyNoisePenalty(candidate: Candidate): number {
    let penalty = 0;

    // BANK/ADDRESS zone penalty
    if (candidate.metadata.isFromBank || candidate.metadata.isFromAddress) {
      penalty += this.config.bankPenalty;
    }

    // SWIFT/ACCOUNT penalty (check context)
    if (candidate.metadata.contextWindow) {
      const context = candidate.metadata.contextWindow.toLowerCase();
      if (context.includes('swift') || context.includes('account') || context.includes('iban')) {
        penalty += this.config.swiftPenalty;
      }
    }

    // Long numeric string penalty
    if (candidate.metadata.contextWindow) {
      const numbers = (candidate.metadata.contextWindow.match(/\d+/g) || []).length;
      if (numbers > 5) {
        penalty += this.config.longNumericPenalty;
      }
    }

    return penalty;
  }

  /**
   * Rule 4: Consistency Bonus (placeholder for historical data)
   */
  private applyConsistencyBonus(candidate: Candidate): number {
    // TODO: Implement when historical data is available
    // For now, return 0
    return 0;
  }

  /**
   * Generate explanation for a candidate
   */
  private generateCandidateExplanation(candidate: Candidate): string {
    const reasons: string[] = [];

    if ((candidate.tournamentModifiers?.anchorBoost ?? 0) > 0) {
      reasons.push('Tier-0 anchor proximity');
    }
    if ((candidate.tournamentModifiers?.structuralBoost ?? 0) > 0) {
      reasons.push('structural alignment');
    }
    if ((candidate.tournamentModifiers?.noisePenalty ?? 0) < 0) {
      reasons.push('noise zone penalty');
    }
    if ((candidate.tournamentModifiers?.consistencyBonus ?? 0) > 0) {
      reasons.push('historical consistency');
    }

    if (reasons.length === 0) {
      return 'Base score from graph/context/role';
    }

    return reasons.join(', ');
  }

  /**
   * Generate tournament explanation
   */
  private generateExplanation(winner: Candidate, runnerUps: Candidate[]): string {
    const reasons: string[] = [
      `Winner: ${winner.value} (score: ${winner.globalScore.toFixed(3)})`,
      `Reason: ${winner.explanation}`
    ];

    if (runnerUps.length > 0) {
      reasons.push(`Runner-up: ${runnerUps[0].value} (score: ${runnerUps[0].globalScore.toFixed(3)})`);
    }

    return reasons.join('. ');
  }

  /**
   * Get score breakdown for a candidate
   */
  private getScoreBreakdown(candidate: Candidate): ScoreBreakdown {
    return {
      roleScore: candidate.roleScore,
      graphScore: candidate.graphScore,
      contextScore: candidate.contextScore,
      confidence: candidate.confidence,
      anchorBoost: candidate.tournamentModifiers?.anchorBoost || 0,
      structuralBoost: candidate.tournamentModifiers?.structuralBoost || 0,
      noisePenalty: candidate.tournamentModifiers?.noisePenalty || 0,
      consistencyBonus: candidate.tournamentModifiers?.consistencyBonus || 0,
      globalScore: candidate.globalScore
    };
  }

  /**
   * Update tournament configuration
   */
  updateConfig(config: Partial<TournamentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TournamentConfig {
    return { ...this.config };
  }

  /**
   * Log tournament state for debugging
   */
  logTournamentState(field: FieldType, candidates: Candidate[]): void {
    console.log(`\n=== TOURNAMENT STATE: ${field.toUpperCase()} ===`);
    console.log(`Configuration:`, this.config);
    console.log(`Candidates: ${candidates.length}`);
    
    candidates.forEach((candidate, index) => {
      console.log(`\n${index + 1}. Value: ${candidate.value}`);
      console.log(`   Source: ${candidate.source}`);
      console.log(`   Base scores: role=${candidate.roleScore.toFixed(2)} graph=${candidate.graphScore.toFixed(2)} context=${candidate.contextScore.toFixed(2)} conf=${candidate.confidence.toFixed(2)}`);
      console.log(`   Modifiers: anchor=${candidate.tournamentModifiers?.anchorBoost?.toFixed(2) || 0} structural=${candidate.tournamentModifiers?.structuralBoost?.toFixed(2) || 0} noise=${candidate.tournamentModifiers?.noisePenalty?.toFixed(2) || 0} consistency=${candidate.tournamentModifiers?.consistencyBonus?.toFixed(2) || 0}`);
      console.log(`   Global score: ${candidate.globalScore.toFixed(3)}`);
      console.log(`   Explanation: ${candidate.explanation}`);
    });
    
    console.log('\n=== END TOURNAMENT STATE ===\n');
  }
}
