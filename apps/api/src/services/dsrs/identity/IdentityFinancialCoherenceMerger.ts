/**
 * DSRS v5 - Identity Financial Coherence Merger
 * 
 * Final interpretation engine that merges identity graph, financial structure, PO validation, and field tournament output
 * This is the final brain that produces the document interpretation
 */

import { EntityNode, EntityType } from './EntityIdentityGraph';
import { IdentityResolution } from './IdentityResolver';
import { CoherenceResult } from './FinancialCoherenceEngine';
import { IntentClassification, InvoiceIntent } from './InvoiceIntentClassifier';

export interface VendorInterpretation {
  primary: string;
  role: string;
  confidence: number;
  linkedEntities: string[];
}

export interface FinancialSummary {
  invoiceTotal: number;
  poTotal: number;
  status: string;
  variance: number;
  varianceExplanation: string;
}

export interface FinalInterpretation {
  vendor: VendorInterpretation;
  financialSummary: FinancialSummary;
  intent: InvoiceIntent;
  intentConfidence: number;
  confidence: number;
  decision: string;
  explanation: string[];
  requiresReview: boolean;
}

export class IdentityFinancialCoherenceMerger {
  /**
   * Merge all components into final interpretation
   */
  mergeInterpretation(
    identityGraph: EntityNode[],
    identityResolution: IdentityResolution,
    financialCoherence: CoherenceResult,
    intentClassification: IntentClassification,
    tournamentOutput: any
  ): FinalInterpretation {
    console.log('[IdentityFinancialCoherenceMerger] Merging final interpretation');

    // Extract vendor interpretation
    const vendor = this.interpretVendor(identityGraph, identityResolution, intentClassification);

    // Extract financial summary
    const financialSummary = this.interpretFinancial(financialCoherence, tournamentOutput);

    // Determine final decision
    const decision = this.determineDecision(
      identityResolution,
      financialCoherence,
      intentClassification,
      vendor,
      financialSummary
    );

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(
      identityResolution.confidence,
      financialCoherence.confidence,
      intentClassification.confidence
    );

    // Generate explanation
    const explanation = this.generateExplanation(
      identityResolution,
      financialCoherence,
      intentClassification,
      vendor,
      financialSummary
    );

    const interpretation: FinalInterpretation = {
      vendor,
      financialSummary,
      intent: intentClassification.intent,
      intentConfidence: intentClassification.confidence,
      confidence,
      decision,
      explanation,
      requiresReview: decision !== 'AUTO_APPROVE'
    };

    console.log('[IdentityFinancialCoherenceMerger] Final interpretation:', {
      decision,
      confidence: confidence.toFixed(3),
      intent: intentClassification.intent,
      vendorRole: vendor.role
    });

    return interpretation;
  }

  /**
   * Interpret vendor role and identity
   */
  private interpretVendor(
    identityGraph: EntityNode[],
    identityResolution: IdentityResolution,
    intentClassification: IntentClassification
  ): VendorInterpretation {
    const invoiceVendor = identityGraph.find(e => e.type === 'INVOICE_VENDOR');
    const poVendor = identityGraph.find(e => e.type === 'PO_VENDOR');
    const shipper = identityGraph.find(e => e.type === 'SHIPPER');

    let primary = invoiceVendor?.name || 'Unknown';
    let role = 'PRIMARY_VENDOR';
    let confidence = identityResolution.confidence;
    const linkedEntities: string[] = [];

    // Determine vendor role based on intent and identity resolution
    if (intentClassification.intent === 'INTERMEDIARY_REBILL') {
      if (shipper) {
        primary = shipper.name;
        role = 'SHIPPER / INTERMEDIARY';
        linkedEntities.push(shipper.name);
      }
      if (poVendor && poVendor.name !== primary) {
        linkedEntities.push(poVendor.name);
      }
      confidence = Math.min(confidence, intentClassification.confidence);
    } else if (intentClassification.intent === 'MULTI_PO_CONSOLIDATED') {
      role = 'CONSOLIDATING_VENDOR';
      if (poVendor) {
        linkedEntities.push(poVendor.name);
      }
    } else if (intentClassification.intent === 'PARTIAL_SHIPMENT') {
      role = 'PARTIAL_SHIPMENT_VENDOR';
    }

    // Add linked entities from identity graph
    for (const entity of identityGraph) {
      if (entity.name !== primary && !linkedEntities.includes(entity.name)) {
        linkedEntities.push(entity.name);
      }
    }

    return {
      primary,
      role,
      confidence,
      linkedEntities
    };
  }

  /**
   * Interpret financial status
   */
  private interpretFinancial(
    financialCoherence: CoherenceResult,
    tournamentOutput: any
  ): FinancialSummary {
    const invoiceTotal = tournamentOutput.amount || 0;
    const poTotal = tournamentOutput.poTotal || 0;

    let status = 'MATCH';
    let variance = 0;
    let varianceExplanation = 'Amounts match within tolerance';

    if (poTotal > 0) {
      variance = Math.abs(invoiceTotal - poTotal) / poTotal;
      
      if (variance > 0.1) {
        status = 'MISMATCH';
        varianceExplanation = 'Significant variance detected';
      } else if (variance > 0.05) {
        status = 'NEAR_MATCH';
        varianceExplanation = 'Minor variance within acceptable range';
      }
    } else {
      status = 'NO_PO_REFERENCE';
      varianceExplanation = 'No PO total available for comparison';
    }

    // Adjust status based on financial coherence
    if (financialCoherence.status === 'INCONSISTENT') {
      status = 'INCONSISTENT';
      varianceExplanation = 'Financial structure inconsistent';
    } else if (financialCoherence.status === 'WARNING') {
      if (status !== 'INCONSISTENT') {
        status = 'WARNING';
      }
    }

    return {
      invoiceTotal,
      poTotal,
      status,
      variance,
      varianceExplanation
    };
  }

  /**
   * Determine final decision
   */
  private determineDecision(
    identityResolution: IdentityResolution,
    financialCoherence: CoherenceResult,
    intentClassification: IntentClassification,
    vendor: VendorInterpretation,
    financialSummary: FinancialSummary
  ): string {
    // Check for critical issues
    if (financialCoherence.status === 'INCONSISTENT') {
      if (intentClassification.intent === 'INTERMEDIARY_REBILL') {
        return 'REVIEW_NOT_ERROR';
      }
      return 'REVIEW_REQUIRED';
    }

    // Check for vendor mismatch
    if (!identityResolution.isSameEntity && identityResolution.confidence > 0.7) {
      if (intentClassification.intent === 'INTERMEDIARY_REBILL') {
        return 'REVIEW_NOT_ERROR';
      }
      return 'REVIEW_REQUIRED';
    }

    // Check for financial variance
    if (financialSummary.status === 'MISMATCH') {
      if (intentClassification.intent === 'PARTIAL_SHIPMENT') {
        return 'REVIEW_NOT_ERROR';
      }
      return 'REVIEW_REQUIRED';
    }

    // Check for multi-PO consolidation
    if (intentClassification.intent === 'MULTI_PO_CONSOLIDATED') {
      return 'REVIEW_NOT_ERROR';
    }

    // Check for adjustment invoice
    if (intentClassification.intent === 'ADJUSTMENT_INVOICE') {
      return 'REVIEW_NOT_ERROR';
    }

    // If everything looks good
    if (financialCoherence.status === 'CONSISTENT' && identityResolution.confidence > 0.8) {
      return 'AUTO_APPROVE';
    }

    // Default to review
    return 'REVIEW_REQUIRED';
  }

  /**
   * Calculate overall confidence
   */
  private calculateOverallConfidence(
    identityConfidence: number,
    financialConfidence: number,
    intentConfidence: number
  ): number {
    return (identityConfidence * 0.3) + (financialConfidence * 0.4) + (intentConfidence * 0.3);
  }

  /**
   * Generate explanation
   */
  private generateExplanation(
    identityResolution: IdentityResolution,
    financialCoherence: CoherenceResult,
    intentClassification: IntentClassification,
    vendor: VendorInterpretation,
    financialSummary: FinancialSummary
  ): string[] {
    const explanations: string[] = [];

    // Identity explanation
    if (identityResolution.isSameEntity) {
      explanations.push(`Vendor identity confirmed: ${vendor.primary}`);
    } else {
      explanations.push(`Vendor role identified: ${vendor.role}`);
      if (vendor.linkedEntities.length > 0) {
        explanations.push(`Linked entities: ${vendor.linkedEntities.join(', ')}`);
      }
    }

    // Intent explanation
    explanations.push(`Document intent: ${intentClassification.intent.replace(/_/g, ' ')}`);
    if (intentClassification.explanation.length > 0) {
      explanations.push(...intentClassification.explanation);
    }

    // Financial explanation
    explanations.push(`Financial status: ${financialSummary.status}`);
    if (financialSummary.status !== 'MATCH') {
      explanations.push(financialSummary.varianceExplanation);
    }

    // Coherence issues
    if (financialCoherence.issues.length > 0) {
      explanations.push('Financial coherence issues detected');
      explanations.push(...financialCoherence.issues.slice(0, 2));
    }

    // Recommendations
    if (financialCoherence.recommendations.length > 0) {
      explanations.push('Recommendations:');
      explanations.push(...financialCoherence.recommendations.slice(0, 2));
    }

    return explanations;
  }

  /**
   * Get decision color for UI
   */
  getDecisionColor(decision: string): string {
    switch (decision) {
      case 'AUTO_APPROVE':
        return 'green';
      case 'REVIEW_NOT_ERROR':
        return 'yellow';
      case 'REVIEW_REQUIRED':
        return 'red';
      default:
        return 'gray';
    }
  }

  /**
   * Export interpretation to JSON
   */
  toJSON(interpretation: FinalInterpretation): any {
    return {
      vendor: interpretation.vendor,
      financialSummary: interpretation.financialSummary,
      intent: interpretation.intent,
      intentConfidence: interpretation.intentConfidence,
      confidence: interpretation.confidence,
      decision: interpretation.decision,
      explanation: interpretation.explanation,
      requiresReview: interpretation.requiresReview,
      decisionColor: this.getDecisionColor(interpretation.decision)
    };
  }

  /**
   * Log interpretation
   */
  logInterpretation(interpretation: FinalInterpretation): void {
    console.log('\n=== FINAL INTERPRETATION ===');
    console.log(`Decision: ${interpretation.decision}`);
    console.log(`Overall Confidence: ${interpretation.confidence.toFixed(3)}`);
    
    console.log('\nVendor:');
    console.log(`  Primary: ${interpretation.vendor.primary}`);
    console.log(`  Role: ${interpretation.vendor.role}`);
    console.log(`  Confidence: ${interpretation.vendor.confidence.toFixed(3)}`);
    console.log(`  Linked Entities: ${interpretation.vendor.linkedEntities.join(', ')}`);
    
    console.log('\nFinancial Summary:');
    console.log(`  Invoice Total: ${interpretation.financialSummary.invoiceTotal}`);
    console.log(`  PO Total: ${interpretation.financialSummary.poTotal}`);
    console.log(`  Status: ${interpretation.financialSummary.status}`);
    console.log(`  Variance: ${(interpretation.financialSummary.variance * 100).toFixed(1)}%`);
    console.log(`  Explanation: ${interpretation.financialSummary.varianceExplanation}`);
    
    console.log('\nIntent:');
    console.log(`  Type: ${interpretation.intent}`);
    console.log(`  Confidence: ${interpretation.intentConfidence.toFixed(3)}`);
    
    console.log('\nExplanation:');
    interpretation.explanation.forEach(expl => console.log(`  - ${expl}`));
    
    console.log(`\nRequires Review: ${interpretation.requiresReview}`);
    console.log('=== END INTERPRETATION ===\n');
  }
}
