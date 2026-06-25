/**
 * DSRS v4.5 - Confidence Elasticity Layer
 * 
 * Dynamic confidence adjustment based on multiple factors
 * Confidence changes during reasoning based on stability, semantic strength, and consistency
 */

import { Candidate, FieldType } from '../../tournament/Candidate';
import { RegionType } from '../LayoutGraphBuilder';

export interface ElasticityFactors {
  baseConfidence: number;
  regionStability: number;
  semanticStrength: number;
  crossFieldConsistency: number;
  ocrQuality: number;
}

export interface ElasticityResult {
  originalConfidence: number;
  adjustedConfidence: number;
  factors: ElasticityFactors;
  explanation: string;
}

export class ConfidenceElasticity {
  private factorWeights = {
    regionStability: 0.30,
    semanticStrength: 0.25,
    crossFieldConsistency: 0.25,
    ocrQuality: 0.20
  };

  /**
   * Calculate adjusted confidence
   */
  calculateAdjustedConfidence(
    candidate: Candidate,
    factors: Partial<ElasticityFactors>
  ): ElasticityResult {
    const baseConfidence = candidate.confidence || 0.5;
    
    const completeFactors: ElasticityFactors = {
      baseConfidence,
      regionStability: factors.regionStability || 0.5,
      semanticStrength: factors.semanticStrength || 0.5,
      crossFieldConsistency: factors.crossFieldConsistency || 0.5,
      ocrQuality: factors.ocrQuality || 0.5
    };

    // Calculate adjustment multiplier
    const adjustmentMultiplier = this.calculateAdjustmentMultiplier(completeFactors);
    
    // Apply adjustment
    const adjustedConfidence = baseConfidence * adjustmentMultiplier;
    
    // Clamp to [0, 1]
    const finalConfidence = Math.max(0, Math.min(1, adjustedConfidence));

    const explanation = this.generateExplanation(completeFactors, adjustmentMultiplier, finalConfidence);

    const result: ElasticityResult = {
      originalConfidence: baseConfidence,
      adjustedConfidence: finalConfidence,
      factors: completeFactors,
      explanation
    };

    console.log(`[ConfidenceElasticity] Adjusted confidence for ${candidate.field}:`, {
      original: baseConfidence.toFixed(3),
      adjusted: finalConfidence.toFixed(3),
      multiplier: adjustmentMultiplier.toFixed(3)
    });

    return result;
  }

  /**
   * Calculate adjustment multiplier based on factors
   */
  private calculateAdjustmentMultiplier(factors: ElasticityFactors): number {
    const {
      regionStability,
      semanticStrength,
      crossFieldConsistency,
      ocrQuality
    } = factors;

    // Weighted average of factors
    const weightedAverage =
      (regionStability * this.factorWeights.regionStability) +
      (semanticStrength * this.factorWeights.semanticStrength) +
      (crossFieldConsistency * this.factorWeights.crossFieldConsistency) +
      (ocrQuality * this.factorWeights.ocrQuality);

    // Convert to multiplier (0.5 to 1.5 range)
    return 0.5 + weightedAverage;
  }

  /**
   * Generate explanation for confidence adjustment
   */
  private generateExplanation(
    factors: ElasticityFactors,
    multiplier: number,
    finalConfidence: number
  ): string {
    const parts: string[] = [];

    if (factors.regionStability < 0.5) {
      parts.push('unstable region');
    } else if (factors.regionStability > 0.8) {
      parts.push('stable region');
    }

    if (factors.semanticStrength < 0.5) {
      parts.push('weak semantic signals');
    } else if (factors.semanticStrength > 0.8) {
      parts.push('strong semantic signals');
    }

    if (factors.crossFieldConsistency < 0.5) {
      parts.push('cross-field conflicts');
    } else if (factors.crossFieldConsistency > 0.8) {
      parts.push('cross-field agreement');
    }

    if (factors.ocrQuality < 0.5) {
      parts.push('low OCR quality');
    } else if (factors.ocrQuality > 0.8) {
      parts.push('high OCR quality');
    }

    let explanation = `Adjusted from ${factors.baseConfidence.toFixed(2)} to ${finalConfidence.toFixed(2)}`;
    
    if (parts.length > 0) {
      explanation += ` due to ${parts.join(', ')}`;
    }

    if (multiplier < 0.8) {
      explanation += ' (significant dampening)';
    } else if (multiplier > 1.2) {
      explanation += ' (significant boost)';
    }

    return explanation;
  }

  /**
   * Batch adjust confidence for multiple candidates
   */
  batchAdjustConfidence(
    candidates: Candidate[],
    factorsMap: Map<string, Partial<ElasticityFactors>>
  ): Map<string, ElasticityResult> {
    const results = new Map<string, ElasticityResult>();

    for (const candidate of candidates) {
      const factors = factorsMap.get(candidate.id) || {};
      const result = this.calculateAdjustedConfidence(candidate, factors);
      results.set(candidate.id, result);

      // Update candidate confidence
      candidate.confidence = result.adjustedConfidence;
    }

    return results;
  }

  /**
   * Estimate OCR quality from metadata
   */
  estimateOCRQuality(candidate: Candidate): number {
    const metadata = candidate.metadata;
    
    let quality = 0.5; // Default

    // Check OCR confidence if available
    if (metadata.ocrConfidence) {
      quality = metadata.ocrConfidence;
    }

    // Adjust based on context window length
    if (metadata.contextWindow && metadata.contextWindow.length > 50) {
      quality += 0.1; // More context = better quality
    }

    // Adjust based on position (earlier in document = usually better)
    if (metadata.position !== undefined && metadata.position < 1000) {
      quality += 0.05;
    }

    return Math.min(1.0, quality);
  }

  /**
   * Estimate semantic strength from candidate
   */
  estimateSemanticStrength(candidate: Candidate, context?: any): number {
    let strength = 0.5; // Default

    const value = String(candidate.value).toUpperCase();
    const contextWindow = context?.contextWindow?.toUpperCase() || '';

    // Check for strong semantic indicators
    if (candidate.field === 'amount') {
      if (/TOTAL|GRAND|DUE|BALANCE/.test(contextWindow)) {
        strength += 0.3;
      }
      if (/[$€£¥]/.test(contextWindow)) {
        strength += 0.2;
      }
    }

    if (candidate.field === 'invoice_number') {
      if (/INVOICE|BILL|NO\.|NUMBER/.test(contextWindow)) {
        strength += 0.3;
      }
    }

    if (candidate.field === 'sku') {
      if (/[A-Z]{2,4}\d{3,6}/.test(value)) {
        strength += 0.2;
      }
    }

    return Math.min(1.0, strength);
  }

  /**
   * Update factor weights
   */
  updateFactorWeights(weights: Partial<typeof this.factorWeights>): void {
    this.factorWeights = { ...this.factorWeights, ...weights };
    console.log('[ConfidenceElasticity] Updated factor weights:', this.factorWeights);
  }

  /**
   * Get current factor weights
   */
  getFactorWeights(): typeof this.factorWeights {
    return { ...this.factorWeights };
  }

  /**
   * Reset to default weights
   */
  resetFactorWeights(): void {
    this.factorWeights = {
      regionStability: 0.30,
      semanticStrength: 0.25,
      crossFieldConsistency: 0.25,
      ocrQuality: 0.20
    };
    console.log('[ConfidenceElasticity] Reset to default factor weights');
  }

  /**
   * Log elasticity results
   */
  logElasticityResults(results: Map<string, ElasticityResult>): void {
    console.log('\n=== CONFIDENCE ELASTICITY RESULTS ===');
    
    for (const [candidateId, result] of results.entries()) {
      console.log(`\n${candidateId}:`);
      console.log(`  Original: ${result.originalConfidence.toFixed(3)}`);
      console.log(`  Adjusted: ${result.adjustedConfidence.toFixed(3)}`);
      console.log(`  Factors:`);
      console.log(`    Region Stability: ${result.factors.regionStability.toFixed(3)}`);
      console.log(`    Semantic Strength: ${result.factors.semanticStrength.toFixed(3)}`);
      console.log(`    Cross-field Consistency: ${result.factors.crossFieldConsistency.toFixed(3)}`);
      console.log(`    OCR Quality: ${result.factors.ocrQuality.toFixed(3)}`);
      console.log(`  Explanation: ${result.explanation}`);
    }
    
    console.log('\n=== END ELASTICITY RESULTS ===\n');
  }
}
