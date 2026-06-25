/**
 * DSRS v3 - Graph Re-weighting Loop
 * 
 * Self-correcting system that propagates feedback signals back into the graph
 * Allows correction after conflict detection
 */

import { Candidate, FieldType } from '../tournament/Candidate';
import { InvoiceState, ConflictFlag } from './CrossFieldCoherenceEngine';
import { CandidateGraph, GraphNode } from '../CandidateGraphBuilder';

export interface ReweightingConfig {
  maxIterations: number;
  stabilityThreshold: number;
  weightAdjustmentFactor: number;
  minCandidateScore: number;
  boostFactor: number;
  penaltyFactor: number;
}

export const DEFAULT_REWEIGHTING_CONFIG: ReweightingConfig = {
  maxIterations: 3,
  stabilityThreshold: 0.85,
  weightAdjustmentFactor: 0.2,
  minCandidateScore: 0.1,
  boostFactor: 1.3,
  penaltyFactor: 0.7
};

export interface ReweightingIteration {
  iteration: number;
  coherenceScore: number;
  status: 'STABLE' | 'UNSTABLE' | 'CONFLICT';
  adjustments: Map<string, number>;
  candidatesAdjusted: number;
}

export interface ReweightingResult {
  finalCoherenceScore: number;
  finalStatus: 'STABLE' | 'UNSTABLE' | 'CONFLICT';
  iterations: ReweightingIteration[];
  totalIterations: number;
  converged: boolean;
  finalCandidates: Map<FieldType, Candidate[]>;
}

export class GraphReweightingLoop {
  private config: ReweightingConfig;

  constructor(config: ReweightingConfig = DEFAULT_REWEIGHTING_CONFIG) {
    this.config = config;
  }

  /**
   * Run re-weighting loop until stable or max iterations
   */
  async runReweightingLoop(
    initialCandidates: Map<FieldType, Candidate[]>,
    graph: CandidateGraph,
    coherenceEngine: any,
    poData?: any,
    lineItemData?: any
  ): Promise<ReweightingResult> {
    console.log('[GraphReweightingLoop] Starting re-weighting loop');
    
    const iterations: ReweightingIteration[] = [];
    let currentCandidates = new Map(initialCandidates);
    let converged = false;
    let iteration = 0;

    while (iteration < this.config.maxIterations && !converged) {
      console.log(`\n[GraphReweightingLoop] Iteration ${iteration + 1}/${this.config.maxIterations}`);

      // Build field states from current candidates
      const fieldStates = this.buildFieldStates(currentCandidates);

      // Evaluate coherence
      const invoiceState = coherenceEngine.evaluateCoherence(fieldStates, poData, lineItemData);

      // Check if stable
      if (invoiceState.coherenceScore >= this.config.stabilityThreshold) {
        console.log(`[GraphReweightingLoop] Converged at iteration ${iteration + 1}`);
        converged = true;
        iterations.push({
          iteration: iteration + 1,
          coherenceScore: invoiceState.coherenceScore,
          status: invoiceState.status,
          adjustments: new Map(),
          candidatesAdjusted: 0
        });
        break;
      }

      // Generate feedback signals
      const feedbackSignals = coherenceEngine.generateFeedbackSignals(invoiceState);

      // Apply re-weighting
      const reweightingResult = this.applyReweighting(currentCandidates, graph, feedbackSignals, invoiceState.conflicts);

      // Record iteration
      iterations.push({
        iteration: iteration + 1,
        coherenceScore: invoiceState.coherenceScore,
        status: invoiceState.status,
        adjustments: reweightingResult.adjustments,
        candidatesAdjusted: reweightingResult.candidatesAdjusted
      });

      // Update candidates for next iteration
      currentCandidates = reweightingResult.updatedCandidates;

      iteration++;
    }

    // Final coherence check
    const finalFieldStates = this.buildFieldStates(currentCandidates);
    const finalInvoiceState = coherenceEngine.evaluateCoherence(finalFieldStates, poData, lineItemData);

    const result: ReweightingResult = {
      finalCoherenceScore: finalInvoiceState.coherenceScore,
      finalStatus: finalInvoiceState.status,
      iterations,
      totalIterations: iteration,
      converged,
      finalCandidates: currentCandidates
    };

    console.log(`[GraphReweightingLoop] Loop complete: ${result.totalIterations} iterations, converged: ${converged}`);
    console.log(`[GraphReweightingLoop] Final coherence: ${result.finalCoherenceScore.toFixed(3)}, Status: ${result.finalStatus}`);

    return result;
  }

  /**
   * Build field states from candidates
   */
  private buildFieldStates(candidates: Map<FieldType, Candidate[]>): Map<FieldType, any> {
    const fieldStates = new Map();

    for (const [field, fieldCandidates] of candidates.entries()) {
      if (fieldCandidates.length > 0) {
        const winner = fieldCandidates[0]; // Assume sorted by score
        fieldStates.set(field, {
          value: winner.value,
          confidence: winner.globalScore,
          stability: this.calculateStability(winner.globalScore),
          conflictScore: 0,
          dependencyLinks: []
        });
      }
    }

    return fieldStates;
  }

  /**
   * Calculate stability from confidence
   */
  private calculateStability(confidence: number): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (confidence >= 0.8) return 'HIGH';
    if (confidence >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Apply re-weighting to candidates based on feedback signals
   */
  private applyReweighting(
    candidates: Map<FieldType, Candidate[]>,
    graph: CandidateGraph,
    feedbackSignals: Map<string, number>,
    conflicts: ConflictFlag[]
  ): { updatedCandidates: Map<FieldType, Candidate[]>; adjustments: Map<string, number>; candidatesAdjusted: number } {
    const updatedCandidates = new Map<FieldType, Candidate[]>();
    const adjustments = new Map<string, number>();
    let candidatesAdjusted = 0;

    for (const [field, fieldCandidates] of candidates.entries()) {
      const adjustedFieldCandidates: Candidate[] = [];

      for (const candidate of fieldCandidates) {
        let adjustment = 0;
        const originalScore = candidate.globalScore;

        // Apply feedback signal adjustments
        for (const [signal, value] of feedbackSignals.entries()) {
          if (this.shouldApplySignal(signal, field, candidate, graph)) {
            adjustment += value * this.config.weightAdjustmentFactor;
          }
        }

        // Apply conflict-specific adjustments
        for (const conflict of conflicts) {
          adjustment += this.applyConflictAdjustment(conflict, field, candidate, graph);
        }

        // Apply adjustment to global score
        if (adjustment !== 0) {
          candidate.globalScore = Math.max(
            this.config.minCandidateScore,
            Math.min(1.0, candidate.globalScore + adjustment)
          );
          candidatesAdjusted++;
          adjustments.set(`${field}_${candidate.id}`, adjustment);
        }

        adjustedFieldCandidates.push(candidate);
      }

      // Re-sort by global score
      adjustedFieldCandidates.sort((a, b) => b.globalScore - a.globalScore);
      updatedCandidates.set(field, adjustedFieldCandidates);
    }

    return { updatedCandidates, adjustments, candidatesAdjusted };
  }

  /**
   * Determine if a feedback signal should be applied to a candidate
   */
  private shouldApplySignal(
    signal: string,
    field: FieldType,
    candidate: Candidate,
    graph: CandidateGraph
  ): boolean {
    switch (signal) {
      case 'AMOUNT_PO_MISMATCH':
        if (field === 'amount') {
          // Reduce score of candidates that don't match PO structure
          return !this.matchesPOStructure(candidate, graph);
        }
        break;

      case 'VENDOR_MISMATCH':
        if (field === 'vendor') {
          // Boost candidates in bill-to/header region
          return this.isInBillToRegion(candidate, graph);
        }
        break;

      case 'VENDOR_MISSING':
        if (field === 'vendor') {
          // Boost all vendor candidates
          return true;
        }
        break;

      case 'CURRENCY_MISMATCH':
        if (field === 'currency') {
          // Boost candidates that match PO currency
          return this.matchesPOCurrency(candidate, graph);
        }
        break;

      case 'QTY_MISMATCH':
        if (field === 'qty') {
          // Boost summary row candidates
          return this.isSummaryRow(candidate, graph);
        }
        break;

      case 'STRUCTURAL_INTEGRITY_LOW':
        // Boost candidates in structured regions
        return this.isInStructuredRegion(candidate, graph);
    }

    return false;
  }

  /**
   * Apply conflict-specific adjustments
   */
  private applyConflictAdjustment(
    conflict: ConflictFlag,
    field: FieldType,
    candidate: Candidate,
    graph: CandidateGraph
  ): number {
    let adjustment = 0;

    switch (conflict) {
      case 'AMOUNT_PO_MISMATCH':
        if (field === 'amount' && this.matchesPOStructure(candidate, graph)) {
          adjustment += 0.1 * this.config.boostFactor;
        }
        break;

      case 'VENDOR_MISMATCH':
        if (field === 'vendor' && this.isInHeaderRegion(candidate, graph)) {
          adjustment += 0.15 * this.config.boostFactor;
        }
        break;

      case 'CURRENCY_MISMATCH':
        if (field === 'currency' && this.hasFxContext(candidate, graph)) {
          adjustment += 0.1 * this.config.boostFactor;
        }
        break;
    }

    return adjustment;
  }

  /**
   * Check if candidate matches PO structure
   */
  private matchesPOStructure(candidate: Candidate, graph: CandidateGraph): boolean {
    // Placeholder: check if candidate aligns with PO amount structure
    return false;
  }

  /**
   * Check if candidate is in bill-to region
   */
  private isInBillToRegion(candidate: Candidate, graph: CandidateGraph): boolean {
    if (!candidate.metadata.contextWindow) return false;
    const context = candidate.metadata.contextWindow.toUpperCase();
    return context.includes('BILL TO') || context.includes('SHIP TO');
  }

  /**
   * Check if candidate is in header region
   */
  private isInHeaderRegion(candidate: Candidate, graph: CandidateGraph): boolean {
    if (!candidate.metadata.position) return false;
    // Assume header is in first 20% of document
    // This is a placeholder - would need document length
    return false;
  }

  /**
   * Check if candidate matches PO currency
   */
  private matchesPOCurrency(candidate: Candidate, graph: CandidateGraph): boolean {
    // Placeholder: check against PO currency
    return false;
  }

  /**
   * Check if candidate is in summary row
   */
  private isSummaryRow(candidate: Candidate, graph: CandidateGraph): boolean {
    if (!candidate.metadata.contextWindow) return false;
    const context = candidate.metadata.contextWindow.toUpperCase();
    return context.includes('TOTAL') || context.includes('SUMMARY');
  }

  /**
   * Check if candidate is in structured region
   */
  private isInStructuredRegion(candidate: Candidate, graph: CandidateGraph): boolean {
    return !!(candidate.metadata.isFromTable || candidate.metadata.isFromLineItem);
  }

  /**
   * Check if candidate has FX context
   */
  private hasFxContext(candidate: Candidate, graph: CandidateGraph): boolean {
    if (!candidate.metadata.contextWindow) return false;
    const context = candidate.metadata.contextWindow.toUpperCase();
    return !!(context.includes('FX') || context.includes('EXCHANGE') || context.includes('RATE'));
  }

  /**
   * Update re-weighting configuration
   */
  updateConfig(config: Partial<ReweightingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ReweightingConfig {
    return { ...this.config };
  }

  /**
   * Log iteration details
   */
  logIteration(iteration: ReweightingIteration): void {
    console.log(`\n=== Reweighting Iteration ${iteration.iteration} ===`);
    console.log(`Coherence Score: ${iteration.coherenceScore.toFixed(3)}`);
    console.log(`Status: ${iteration.status}`);
    console.log(`Candidates Adjusted: ${iteration.candidatesAdjusted}`);
    
    if (iteration.adjustments.size > 0) {
      console.log('Adjustments:');
      for (const [key, value] of iteration.adjustments.entries()) {
        console.log(`  ${key}: ${value.toFixed(3)}`);
      }
    }
    
    console.log('=== End Iteration ===\n');
  }
}
