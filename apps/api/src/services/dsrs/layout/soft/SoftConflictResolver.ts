/**
 * DSRS v4.5 - Soft Conflict Resolver
 * 
 * Replaces winner-takes-all with weighted dominance scoring
 * Computes weighted dominance instead of hard rules
 */

import { Candidate, FieldType } from '../../tournament/Candidate';
import { RegionType } from '../LayoutGraphBuilder';
import { HybridScoreResult } from './HybridScoringEngine';

export interface ConflictWeights {
  region: number;
  semantic: number;
  graph: number;
  coherence: number;
}

export interface ConflictResolution {
  candidates: Candidate[];
  weights: ConflictWeights;
  dominanceScores: Map<string, number>;
  winner: Candidate | null;
  confidence: number;
  explanation: string;
}

export class SoftConflictResolver {
  private defaultWeights: ConflictWeights = {
    region: 0.30,
    semantic: 0.25,
    graph: 0.25,
    coherence: 0.20
  };

  private weights: ConflictWeights;

  constructor(customWeights?: Partial<ConflictWeights>) {
    this.weights = { ...this.defaultWeights, ...customWeights };
  }

  /**
   * Resolve conflicts using weighted dominance
   */
  resolveConflicts(
    candidates: Candidate[],
    scoringResults: HybridScoreResult[],
    context?: any
  ): ConflictResolution {
    console.log(`[SoftConflictResolver] Resolving conflicts for ${candidates.length} candidates`);

    if (candidates.length === 0) {
      return {
        candidates: [],
        weights: this.weights,
        dominanceScores: new Map(),
        winner: null,
        confidence: 0,
        explanation: 'No candidates to resolve'
      };
    }

    if (candidates.length === 1) {
      const dominanceScore = this.calculateDominanceScore(
        scoringResults[0],
        this.weights
      );
      
      return {
        candidates,
        weights: this.weights,
        dominanceScores: new Map([[candidates[0].id, dominanceScore]]),
        winner: candidates[0],
        confidence: dominanceScore,
        explanation: 'Single candidate, no conflict'
      };
    }

    // Calculate dominance scores for all candidates
    const dominanceScores = new Map<string, number>();
    
    for (let i = 0; i < candidates.length; i++) {
      const score = this.calculateDominanceScore(scoringResults[i], this.weights);
      dominanceScores.set(candidates[i].id, score);
    }

    // Find winner (highest dominance score)
    let winner: Candidate | null = null;
    let maxScore = -1;

    for (const [candidateId, score] of dominanceScores.entries()) {
      if (score > maxScore) {
        maxScore = score;
        winner = candidates.find(c => c.id === candidateId) || null;
      }
    }

    // Calculate confidence (difference between winner and runner-up)
    const scores = Array.from(dominanceScores.values()).sort((a, b) => b - a);
    const confidence = scores.length > 1 ? scores[0] - scores[1] : scores[0];

    // Generate explanation
    const explanation = this.generateExplanation(
      candidates,
      dominanceScores,
      winner,
      confidence
    );

    const resolution: ConflictResolution = {
      candidates,
      weights: this.weights,
      dominanceScores,
      winner,
      confidence: Math.max(0, Math.min(1, confidence)),
      explanation
    };

    console.log(`[SoftConflictResolver] Resolution complete:`, {
      winner: winner?.value,
      confidence: confidence.toFixed(3),
      explanation
    });

    return resolution;
  }

  /**
   * Calculate dominance score for a candidate
   */
  private calculateDominanceScore(
    scoringResult: HybridScoreResult,
    weights: ConflictWeights
  ): number {
    return (
      (scoringResult.regionLikelihood * weights.region) +
      (scoringResult.semanticScore * weights.semantic) +
      (scoringResult.graphScore * weights.graph) +
      (scoringResult.coherenceScore * weights.coherence)
    );
  }

  /**
   * Generate explanation for resolution
   */
  private generateExplanation(
    candidates: Candidate[],
    dominanceScores: Map<string, number>,
    winner: Candidate | null,
    confidence: number
  ): string {
    if (!winner) return 'No winner determined';

    const winnerScore = dominanceScores.get(winner.id) || 0;
    
    let explanation = `Winner: ${winner.value} (dominance: ${winnerScore.toFixed(3)})`;
    
    if (confidence < 0.1) {
      explanation += ' - Low confidence, candidates are very close';
    } else if (confidence < 0.3) {
      explanation += ' - Medium confidence, consider manual review';
    } else {
      explanation += ' - High confidence';
    }

    // Add runner-up info
    const sortedCandidates = Array.from(dominanceScores.entries())
      .sort((a, b) => b[1] - a[1]);
    
    if (sortedCandidates.length > 1) {
      const runnerUpId = sortedCandidates[1][0];
      const runnerUp = candidates.find(c => c.id === runnerUpId);
      if (runnerUp) {
        explanation += `, Runner-up: ${runnerUp.value} (${sortedCandidates[1][1].toFixed(3)})`;
      }
    }

    return explanation;
  }

  /**
   * Resolve conflicts with region uncertainty consideration
   */
  resolveWithUncertainty(
    candidates: Candidate[],
    scoringResults: HybridScoreResult[],
    regionUncertainty: number,
    context?: any
  ): ConflictResolution {
    console.log(`[SoftConflictResolver] Resolving with region uncertainty: ${regionUncertainty.toFixed(3)}`);

    // If region uncertainty is high, reduce region weight
    const adjustedWeights = { ...this.weights };
    
    if (regionUncertainty > 0.5) {
      const reduction = (regionUncertainty - 0.5) * 0.5; // Reduce by up to 25%
      adjustedWeights.region -= reduction;
      adjustedWeights.semantic += reduction * 0.5;
      adjustedWeights.graph += reduction * 0.5;
      
      console.log(`[SoftConflictResolver] Adjusted weights due to high uncertainty:`, adjustedWeights);
    }

    return this.resolveConflicts(candidates, scoringResults, context);
  }

  /**
   * Update conflict weights
   */
  updateWeights(newWeights: Partial<ConflictWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
    console.log('[SoftConflictResolver] Updated weights:', this.weights);
  }

  /**
   * Get current weights
   */
  getWeights(): ConflictWeights {
    return { ...this.weights };
  }

  /**
   * Reset to default weights
   */
  resetWeights(): void {
    this.weights = { ...this.defaultWeights };
    console.log('[SoftConflictResolver] Reset to default weights');
  }

  /**
   * Log resolution details
   */
  logResolution(resolution: ConflictResolution): void {
    console.log('\n=== SOFT CONFLICT RESOLUTION ===');
    console.log(`Candidates: ${resolution.candidates.length}`);
    console.log(`Weights:`, resolution.weights);
    console.log(`\nDominance Scores:`);
    
    for (const [candidateId, score] of resolution.dominanceScores.entries()) {
      const candidate = resolution.candidates.find(c => c.id === candidateId);
      console.log(`  ${candidate?.value || candidateId}: ${score.toFixed(3)}`);
    }
    
    console.log(`\nWinner: ${resolution.winner?.value || 'none'}`);
    console.log(`Confidence: ${resolution.confidence.toFixed(3)}`);
    console.log(`Explanation: ${resolution.explanation}`);
    console.log('=== END RESOLUTION ===\n');
  }
}
