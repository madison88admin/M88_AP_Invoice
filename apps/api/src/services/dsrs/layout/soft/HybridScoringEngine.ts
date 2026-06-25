/**
 * DSRS v4.5 - Hybrid Scoring Engine
 * 
 * Replaces deterministic scoring with multi-signal weighted scoring
 * Region is just one signal among many
 */

import { Candidate, FieldType } from '../../tournament/Candidate';
import { RegionType } from '../LayoutGraphBuilder';
import { RegionBelief, FieldRegionBeliefs } from './RegionBelief';

export interface ScoringWeights {
  regionLikelihood: number;
  graphScore: number;
  semanticScore: number;
  confidenceScore: number;
  coherenceScore: number;
}

export interface HybridScoreResult {
  candidate: Candidate;
  regionLikelihood: number;
  graphScore: number;
  semanticScore: number;
  confidenceScore: number;
  coherenceScore: number;
  finalScore: number;
  breakdown: string;
}

export class HybridScoringEngine {
  private weights: ScoringWeights;
  private defaultWeights: ScoringWeights = {
    regionLikelihood: 0.25,
    graphScore: 0.25,
    semanticScore: 0.20,
    confidenceScore: 0.15,
    coherenceScore: 0.15
  };

  constructor(customWeights?: Partial<ScoringWeights>) {
    this.weights = { ...this.defaultWeights, ...customWeights };
  }

  /**
   * Calculate hybrid score for a candidate
   */
  calculateScore(
    candidate: Candidate,
    regionBeliefs?: FieldRegionBeliefs,
    region?: RegionType,
    context?: any
  ): HybridScoreResult {
    // Get region likelihood
    const regionLikelihood = this.getRegionLikelihood(candidate.field, regionBeliefs, region);
    
    // Get graph score
    const graphScore = candidate.graphScore || 0.5;
    
    // Get semantic score (from override engine or context)
    const semanticScore = this.getSemanticScore(candidate, context);
    
    // Get confidence score
    const confidenceScore = candidate.confidence || 0.5;
    
    // Get coherence score (from cross-field coherence)
    const coherenceScore = this.getCoherenceScore(candidate, context);

    // Calculate final weighted score
    const finalScore =
      (regionLikelihood * this.weights.regionLikelihood) +
      (graphScore * this.weights.graphScore) +
      (semanticScore * this.weights.semanticScore) +
      (confidenceScore * this.weights.confidenceScore) +
      (coherenceScore * this.weights.coherenceScore);

    // Generate breakdown
    const breakdown = this.generateBreakdown({
      regionLikelihood,
      graphScore,
      semanticScore,
      confidenceScore,
      coherenceScore,
      finalScore
    });

    const result: HybridScoreResult = {
      candidate,
      regionLikelihood,
      graphScore,
      semanticScore,
      confidenceScore,
      coherenceScore,
      finalScore,
      breakdown
    };

    console.log(`[HybridScoringEngine] Calculated score for ${candidate.field}:`, {
      finalScore: finalScore.toFixed(3),
      breakdown
    });

    return result;
  }

  /**
   * Get region likelihood for a candidate
   */
  private getRegionLikelihood(
    field: FieldType,
    regionBeliefs?: FieldRegionBeliefs,
    region?: RegionType
  ): number {
    if (!regionBeliefs || !region) {
      return 0.5; // Default if no region info
    }

    const belief = regionBeliefs.beliefs.get(region);
    return belief?.probability || 0.5;
  }

  /**
   * Get semantic score from context or override engine
   */
  private getSemanticScore(candidate: Candidate, context?: any): number {
    if (context?.semanticOverrideApplied) {
      return context.semanticScore || 0.5;
    }
    
    // Check for semantic indicators in context window
    const contextWindow = context?.contextWindow || '';
    const upperWindow = contextWindow.toUpperCase();
    
    let semanticScore = 0.5;

    // Boost for strong semantic indicators
    if (candidate.field === 'amount') {
      if (/TOTAL|GRAND|DUE|BALANCE/.test(upperWindow)) {
        semanticScore += 0.3;
      }
      if (/[$€£¥]/.test(contextWindow)) {
        semanticScore += 0.2;
      }
    }

    if (candidate.field === 'invoice_number') {
      if (/INVOICE|BILL|NO\.|NUMBER/.test(upperWindow)) {
        semanticScore += 0.3;
      }
    }

    if (candidate.field === 'sku') {
      if (/[A-Z]{2,4}\d{3,6}/.test(candidate.value)) {
        semanticScore += 0.2;
      }
    }

    return Math.min(1.0, semanticScore);
  }

  /**
   * Get coherence score from cross-field coherence
   */
  private getCoherenceScore(candidate: Candidate, context?: any): number {
    if (context?.coherenceScore) {
      return context.coherenceScore;
    }
    
    // Default coherence based on field consistency
    return 0.5;
  }

  /**
   * Generate score breakdown string
   */
  private generateBreakdown(scores: any): string {
    return `Region: ${(scores.regionLikelihood * this.weights.regionLikelihood).toFixed(3)} + ` +
           `Graph: ${(scores.graphScore * this.weights.graphScore).toFixed(3)} + ` +
           `Semantic: ${(scores.semanticScore * this.weights.semanticScore).toFixed(3)} + ` +
           `Confidence: ${(scores.confidenceScore * this.weights.confidenceScore).toFixed(3)} + ` +
           `Coherence: ${(scores.coherenceScore * this.weights.coherenceScore).toFixed(3)} = ` +
           `${scores.finalScore.toFixed(3)}`;
  }

  /**
   * Calculate scores for multiple candidates
   */
  calculateScores(
    candidates: Candidate[],
    regionBeliefs?: Map<FieldType, FieldRegionBeliefs>,
    context?: any
  ): HybridScoreResult[] {
    return candidates.map(candidate => {
      const fieldBeliefs = regionBeliefs?.get(candidate.field);
      const region = context?.region;
      return this.calculateScore(candidate, fieldBeliefs, region, context);
    });
  }

  /**
   * Get best candidate by hybrid score
   */
  getBestCandidate(results: HybridScoreResult[]): HybridScoreResult | null {
    if (results.length === 0) return null;

    return results.reduce((best, current) => 
      current.finalScore > best.finalScore ? current : best
    );
  }

  /**
   * Update scoring weights
   */
  updateWeights(newWeights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
    console.log('[HybridScoringEngine] Updated weights:', this.weights);
  }

  /**
   * Get current weights
   */
  getWeights(): ScoringWeights {
    return { ...this.weights };
  }

  /**
   * Reset to default weights
   */
  resetWeights(): void {
    this.weights = { ...this.defaultWeights };
    console.log('[HybridScoringEngine] Reset to default weights');
  }

  /**
   * Log scoring results
   */
  logScoringResults(results: HybridScoreResult[]): void {
    console.log('\n=== HYBRID SCORING RESULTS ===');
    
    for (const result of results) {
      console.log(`\n${result.candidate.id} (${result.candidate.field}):`);
      console.log(`  Value: ${result.candidate.value}`);
      console.log(`  Region Likelihood: ${result.regionLikelihood.toFixed(3)}`);
      console.log(`  Graph Score: ${result.graphScore.toFixed(3)}`);
      console.log(`  Semantic Score: ${result.semanticScore.toFixed(3)}`);
      console.log(`  Confidence Score: ${result.confidenceScore.toFixed(3)}`);
      console.log(`  Coherence Score: ${result.coherenceScore.toFixed(3)}`);
      console.log(`  Final Score: ${result.finalScore.toFixed(3)}`);
      console.log(`  Breakdown: ${result.breakdown}`);
    }
    
    console.log('\n=== END SCORING RESULTS ===\n');
  }
}
