/**
 * DSRS v5 - Document Intent Classifier
 * 
 * Classifies invoice intent (SINGLE_PO, MULTI_PO, INTERMEDIARY, PARTIAL, ADJUSTMENT)
 * Critical for handling complex supply chain scenarios like AMASS case
 */

export type InvoiceIntent =
  | "SINGLE_PO_INVOICE"
  | "MULTI_PO_CONSOLIDATED"
  | "INTERMEDIARY_REBILL"
  | "PARTIAL_SHIPMENT"
  | "ADJUSTMENT_INVOICE"
  | "UNKNOWN";

export interface IntentFeatures {
  vendorMatch: boolean;
  poMatch: boolean;
  amountMatch: boolean;
  currencyMatch: boolean;
  entityCount: number;
  lineItemCount: number;
  hasMultiplePOs: boolean;
  hasIntermediaryIndicators: boolean;
  hasAdjustmentIndicators: boolean;
}

export interface IntentClassification {
  intent: InvoiceIntent;
  confidence: number;
  alternativeIntents: { intent: InvoiceIntent; confidence: number }[];
  explanation: string[];
  features: IntentFeatures;
}

export class InvoiceIntentClassifier {
  private intentPatterns: Map<InvoiceIntent, (features: IntentFeatures) => number>;

  constructor() {
    this.intentPatterns = this.initializePatterns();
  }

  /**
   * Initialize intent classification patterns
   */
  private initializePatterns(): Map<InvoiceIntent, (features: IntentFeatures) => number> {
    const patterns = new Map<InvoiceIntent, (features: IntentFeatures) => number>();

    // SINGLE_PO_INVOICE pattern
    patterns.set("SINGLE_PO_INVOICE", (features) => {
      let score = 0.0;
      if (features.vendorMatch) score += 0.3;
      if (features.poMatch) score += 0.3;
      if (features.amountMatch) score += 0.2;
      if (features.currencyMatch) score += 0.1;
      if (!features.hasMultiplePOs) score += 0.1;
      return score;
    });

    // MULTI_PO_CONSOLIDATED pattern
    patterns.set("MULTI_PO_CONSOLIDATED", (features) => {
      let score = 0.0;
      if (features.hasMultiplePOs) score += 0.4;
      if (!features.vendorMatch) score += 0.2;
      if (!features.amountMatch) score += 0.2;
      if (features.entityCount > 2) score += 0.2;
      return score;
    });

    // INTERMEDIARY_REBILL pattern (AMASS case)
    patterns.set("INTERMEDIARY_REBILL", (features) => {
      let score = 0.0;
      if (!features.vendorMatch) score += 0.3;
      if (features.hasIntermediaryIndicators) score += 0.3;
      if (features.entityCount > 2) score += 0.2;
      if (!features.poMatch) score += 0.1;
      if (!features.amountMatch) score += 0.1;
      return score;
    });

    // PARTIAL_SHIPMENT pattern
    patterns.set("PARTIAL_SHIPMENT", (features) => {
      let score = 0.0;
      if (!features.amountMatch) score += 0.3;
      if (features.poMatch) score += 0.2;
      if (features.vendorMatch) score += 0.2;
      if (features.currencyMatch) score += 0.2;
      if (features.lineItemCount > 0) score += 0.1;
      return score;
    });

    // ADJUSTMENT_INVOICE pattern
    patterns.set("ADJUSTMENT_INVOICE", (features) => {
      let score = 0.0;
      if (features.hasAdjustmentIndicators) score += 0.4;
      if (!features.amountMatch) score += 0.2;
      if (features.vendorMatch) score += 0.2;
      if (features.poMatch) score += 0.2;
      return score;
    });

    return patterns;
  }

  /**
   * Classify invoice intent
   */
  classifyIntent(features: IntentFeatures): IntentClassification {
    console.log('[InvoiceIntentClassifier] Classifying invoice intent');

    const scores = new Map<InvoiceIntent, number>();

    // Calculate scores for each intent
    for (const [intent, pattern] of this.intentPatterns.entries()) {
      const score = pattern(features);
      scores.set(intent, score);
    }

    // Sort by score
    const sortedScores = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1]);

    const [primaryIntent, primaryScore] = sortedScores[0];
    const confidence = primaryScore;

    // Get alternative intents
    const alternativeIntents = sortedScores
      .slice(1, 4)
      .map(([intent, score]) => ({ intent, confidence: score }));

    // Generate explanation
    const explanation = this.generateExplanation(primaryIntent, features, scores);

    const classification: IntentClassification = {
      intent: primaryIntent,
      confidence,
      alternativeIntents,
      explanation,
      features
    };

    console.log('[InvoiceIntentClassifier] Classification complete:', {
      intent: primaryIntent,
      confidence: confidence.toFixed(3),
      alternatives: alternativeIntents.map(a => `${a.intent} (${a.confidence.toFixed(2)})`)
    });

    return classification;
  }

  /**
   * Generate explanation for classification
   */
  private generateExplanation(
    intent: InvoiceIntent,
    features: IntentFeatures,
    scores: Map<InvoiceIntent, number>
  ): string[] {
    const explanations: string[] = [];

    switch (intent) {
      case "SINGLE_PO_INVOICE":
        if (features.vendorMatch) explanations.push("Vendor matches PO");
        if (features.poMatch) explanations.push("PO reference found");
        if (features.amountMatch) explanations.push("Amount aligns with PO");
        break;

      case "MULTI_PO_CONSOLIDATED":
        if (features.hasMultiplePOs) explanations.push("Multiple PO references detected");
        if (!features.vendorMatch) explanations.push("Vendor mismatch suggests consolidation");
        if (features.entityCount > 2) explanations.push("Multiple entities involved");
        break;

      case "INTERMEDIARY_REBILL":
        if (!features.vendorMatch) explanations.push("Vendor mismatch indicates intermediary");
        if (features.hasIntermediaryIndicators) explanations.push("Intermediary indicators present");
        if (features.entityCount > 2) explanations.push("Complex entity structure");
        if (!features.poMatch) explanations.push("PO reference unclear or indirect");
        break;

      case "PARTIAL_SHIPMENT":
        if (!features.amountMatch) explanations.push("Amount lower than PO suggests partial");
        if (features.poMatch) explanations.push("PO reference present");
        if (features.vendorMatch) explanations.push("Vendor matches PO");
        break;

      case "ADJUSTMENT_INVOICE":
        if (features.hasAdjustmentIndicators) explanations.push("Adjustment indicators detected");
        if (!features.amountMatch) explanations.push("Amount differs from original");
        break;

      case "UNKNOWN":
        explanations.push("Insufficient pattern matches for classification");
        break;
    }

    if (explanations.length === 0) {
      explanations.push("Classification based on weighted feature scores");
    }

    return explanations;
  }

  /**
   * Extract features from invoice data
   */
  extractFeatures(invoiceData: any, poData?: any): IntentFeatures {
    const features: IntentFeatures = {
      vendorMatch: this.checkVendorMatch(invoiceData, poData),
      poMatch: this.checkPOMatch(invoiceData, poData),
      amountMatch: this.checkAmountMatch(invoiceData, poData),
      currencyMatch: this.checkCurrencyMatch(invoiceData, poData),
      entityCount: this.countEntities(invoiceData),
      lineItemCount: this.countLineItems(invoiceData),
      hasMultiplePOs: this.detectMultiplePOs(invoiceData),
      hasIntermediaryIndicators: this.detectIntermediaryIndicators(invoiceData),
      hasAdjustmentIndicators: this.detectAdjustmentIndicators(invoiceData)
    };

    console.log('[InvoiceIntentClassifier] Extracted features:', features);
    return features;
  }

  /**
   * Check vendor match
   */
  private checkVendorMatch(invoiceData: any, poData?: any): boolean {
    if (!poData) return true; // Assume match if no PO data
    const invoiceVendor = invoiceData.vendor?.toLowerCase();
    const poVendor = poData.vendor?.toLowerCase();
    return invoiceVendor === poVendor;
  }

  /**
   * Check PO match
   */
  private checkPOMatch(invoiceData: any, poData?: any): boolean {
    if (!poData) return false;
    const invoicePO = invoiceData.poNumber;
    const poNumber = poData.poNumber;
    return invoicePO === poNumber;
  }

  /**
   * Check amount match
   */
  private checkAmountMatch(invoiceData: any, poData?: any): boolean {
    if (!poData || !poData.total || !invoiceData.total) return false;
    const tolerance = 0.05; // 5% tolerance
    const difference = Math.abs(invoiceData.total - poData.total) / poData.total;
    return difference <= tolerance;
  }

  /**
   * Check currency match
   */
  private checkCurrencyMatch(invoiceData: any, poData?: any): boolean {
    if (!poData) return true;
    const invoiceCurrency = invoiceData.currency;
    const poCurrency = poData.currency;
    return invoiceCurrency === poCurrency;
  }

  /**
   * Count entities in invoice
   */
  private countEntities(invoiceData: any): number {
    let count = 1; // Start with invoice vendor
    if (invoiceData.shipper) count++;
    if (invoiceData.billTo) count++;
    if (invoiceData.consignee) count++;
    if (invoiceData.notifiedParty) count++;
    return count;
  }

  /**
   * Count line items
   */
  private countLineItems(invoiceData: any): number {
    return invoiceData.lineItems?.length || 0;
  }

  /**
   * Detect multiple POs
   */
  private detectMultiplePOs(invoiceData: any): boolean {
    const poReferences = invoiceData.poReferences || [invoiceData.poNumber];
    return poReferences.length > 1;
  }

  /**
   * Detect intermediary indicators
   */
  private detectIntermediaryIndicators(invoiceData: any): boolean {
    const text = JSON.stringify(invoiceData).toLowerCase();
    const indicators = ['agent', 'broker', 'intermediary', 'forwarder', 'logistics', 'trading'];
    return indicators.some(indicator => text.includes(indicator));
  }

  /**
   * Detect adjustment indicators
   */
  private detectAdjustmentIndicators(invoiceData: any): boolean {
    const text = JSON.stringify(invoiceData).toLowerCase();
    const indicators = ['adjustment', 'correction', 'credit', 'debit', 'refund', 'amendment'];
    return indicators.some(indicator => text.includes(indicator));
  }

  /**
   * Get all intent types
   */
  getIntentTypes(): InvoiceIntent[] {
    return Array.from(this.intentPatterns.keys());
  }

  /**
   * Add custom intent pattern
   */
  addIntentPattern(intent: InvoiceIntent, pattern: (features: IntentFeatures) => number): void {
    this.intentPatterns.set(intent, pattern);
    console.log(`[InvoiceIntentClassifier] Added pattern for: ${intent}`);
  }

  /**
   * Log classification result
   */
  logClassificationResult(classification: IntentClassification): void {
    console.log('\n=== INVOICE INTENT CLASSIFICATION ===');
    console.log(`Primary Intent: ${classification.intent}`);
    console.log(`Confidence: ${classification.confidence.toFixed(3)}`);
    
    console.log('\nExplanation:');
    classification.explanation.forEach(expl => console.log(`  - ${expl}`));
    
    console.log('\nAlternative Intents:');
    classification.alternativeIntents.forEach(alt => {
      console.log(`  ${alt.intent}: ${alt.confidence.toFixed(3)}`);
    });
    
    console.log('\nFeatures:');
    console.log(`  Vendor Match: ${classification.features.vendorMatch}`);
    console.log(`  PO Match: ${classification.features.poMatch}`);
    console.log(`  Amount Match: ${classification.features.amountMatch}`);
    console.log(`  Currency Match: ${classification.features.currencyMatch}`);
    console.log(`  Entity Count: ${classification.features.entityCount}`);
    console.log(`  Line Item Count: ${classification.features.lineItemCount}`);
    console.log(`  Multiple POs: ${classification.features.hasMultiplePOs}`);
    console.log(`  Intermediary Indicators: ${classification.features.hasIntermediaryIndicators}`);
    console.log(`  Adjustment Indicators: ${classification.features.hasAdjustmentIndicators}`);
    
    console.log('\n=== END CLASSIFICATION ===\n');
  }
}
