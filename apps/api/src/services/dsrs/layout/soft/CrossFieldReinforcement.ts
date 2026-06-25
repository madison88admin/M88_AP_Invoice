/**
 * DSRS v4.5 - Cross-field Reinforcement
 * 
 * Document-level agreement system
 * Fields influence each other softly (line items support amount, PO adjusts invoice confidence, etc.)
 */

import { Candidate, FieldType } from '../../tournament/Candidate';

export interface FieldInfluence {
  sourceField: FieldType;
  targetField: FieldType;
  influenceStrength: number; // 0.0 - 1.0
  direction: 'boost' | 'dampen' | 'neutral';
  condition: (sourceValue: any, targetValue: any) => boolean;
}

export interface ReinforcementResult {
  field: FieldType;
  originalConfidence: number;
  reinforcedConfidence: number;
  influences: FieldInfluence[];
  explanation: string;
}

export class CrossFieldReinforcement {
  private influences: Map<string, FieldInfluence[]>;
  private fieldValues: Map<FieldType, any>;
  private fieldConfidences: Map<FieldType, number>;

  constructor() {
    this.influences = new Map();
    this.fieldValues = new Map();
    this.fieldConfidences = new Map();
    this.initializeDefaultInfluences();
  }

  /**
   * Initialize default field influences
   */
  private initializeDefaultInfluences(): void {
    // Line items strongly support amount
    this.addInfluence({
      sourceField: 'sku',
      targetField: 'amount',
      influenceStrength: 0.30,
      direction: 'boost',
      condition: (sku, amount) => sku !== null && amount !== null
    });

    this.addInfluence({
      sourceField: 'qty',
      targetField: 'amount',
      influenceStrength: 0.25,
      direction: 'boost',
      condition: (qty, amount) => qty !== null && amount !== null
    });

    // PO amount slightly adjusts invoice amount confidence
    this.addInfluence({
      sourceField: 'po_number',
      targetField: 'amount',
      influenceStrength: 0.15,
      direction: 'boost',
      condition: (po, amount) => po !== null && amount !== null
    });

    // Vendor consistency boosts all header fields
    this.addInfluence({
      sourceField: 'vendor',
      targetField: 'invoice_number',
      influenceStrength: 0.20,
      direction: 'boost',
      condition: (vendor, invoiceNumber) => vendor !== null && invoiceNumber !== null
    });

    this.addInfluence({
      sourceField: 'vendor',
      targetField: 'invoice_date',
      influenceStrength: 0.15,
      direction: 'boost',
      condition: (vendor, date) => vendor !== null && date !== null
    });

    // Currency consistency boosts amount
    this.addInfluence({
      sourceField: 'currency',
      targetField: 'amount',
      influenceStrength: 0.20,
      direction: 'boost',
      condition: (currency, amount) => currency !== null && amount !== null
    });

    // Account number in bank region boosts vendor confidence
    this.addInfluence({
      sourceField: 'account_number',
      targetField: 'vendor',
      influenceStrength: 0.15,
      direction: 'boost',
      condition: (account, vendor) => account !== null && vendor !== null
    });

    // Conflicting amounts dampen each other
    this.addInfluence({
      sourceField: 'amount',
      targetField: 'amount',
      influenceStrength: 0.10,
      direction: 'dampen',
      condition: (sourceAmount, targetAmount) => {
        if (sourceAmount === null || targetAmount === null) return false;
        const difference = Math.abs(sourceAmount - targetAmount) / Math.max(sourceAmount, targetAmount);
        return difference > 0.1; // More than 10% difference
      }
    });
  }

  /**
   * Add custom field influence
   */
  addInfluence(influence: FieldInfluence): void {
    const key = `${influence.sourceField}_${influence.targetField}`;
    
    if (!this.influences.has(influence.targetField)) {
      this.influences.set(influence.targetField, []);
    }
    
    this.influences.get(influence.targetField)!.push(influence);
    console.log(`[CrossFieldReinforcement] Added influence: ${influence.sourceField} → ${influence.targetField} (${influence.direction})`);
  }

  /**
   * Set field value
   */
  setFieldValue(field: FieldType, value: any): void {
    this.fieldValues.set(field, value);
  }

  /**
   * Set field confidence
   */
  setFieldConfidence(field: FieldType, confidence: number): void {
    this.fieldConfidences.set(field, confidence);
  }

  /**
   * Calculate reinforcement for a field
   */
  calculateReinforcement(field: FieldType): ReinforcementResult {
    const originalConfidence = this.fieldConfidences.get(field) || 0.5;
    const influences = this.influences.get(field) || [];
    
    let totalBoost = 0;
    let totalDampen = 0;
    const activeInfluences: FieldInfluence[] = [];

    for (const influence of influences) {
      const sourceValue = this.fieldValues.get(influence.sourceField);
      const targetValue = this.fieldValues.get(field);

      if (influence.condition(sourceValue, targetValue)) {
        activeInfluences.push(influence);

        if (influence.direction === 'boost') {
          totalBoost += influence.influenceStrength;
        } else if (influence.direction === 'dampen') {
          totalDampen += influence.influenceStrength;
        }
      }
    }

    // Calculate reinforced confidence
    const netInfluence = totalBoost - totalDampen;
    const reinforcedConfidence = Math.max(0, Math.min(1, originalConfidence + netInfluence));

    // Generate explanation
    const explanation = this.generateExplanation(field, activeInfluences, netInfluence, reinforcedConfidence);

    const result: ReinforcementResult = {
      field,
      originalConfidence,
      reinforcedConfidence,
      influences: activeInfluences,
      explanation
    };

    console.log(`[CrossFieldReinforcement] Calculated reinforcement for ${field}:`, {
      original: originalConfidence.toFixed(3),
      reinforced: reinforcedConfidence.toFixed(3),
      netInfluence: netInfluence.toFixed(3)
    });

    return result;
  }

  /**
   * Generate explanation for reinforcement
   */
  private generateExplanation(
    field: FieldType,
    activeInfluences: FieldInfluence[],
    netInfluence: number,
    reinforcedConfidence: number
  ): string {
    if (activeInfluences.length === 0) {
      return `No cross-field influences for ${field}`;
    }

    const boostInfluences = activeInfluences.filter(i => i.direction === 'boost');
    const dampenInfluences = activeInfluences.filter(i => i.direction === 'dampen');

    let explanation = `Reinforced from ${this.fieldConfidences.get(field)?.toFixed(3) || '0.5'} to ${reinforcedConfidence.toFixed(3)}`;

    if (boostInfluences.length > 0) {
      const boostSources = boostInfluences.map(i => i.sourceField).join(', ');
      explanation += ` boosted by ${boostSources}`;
    }

    if (dampenInfluences.length > 0) {
      const dampenSources = dampenInfluences.map(i => i.sourceField).join(', ');
      explanation += ` dampened by ${dampenSources}`;
    }

    return explanation;
  }

  /**
   * Calculate reinforcement for all fields
   */
  calculateAllReinforcements(): Map<FieldType, ReinforcementResult> {
    const results = new Map<FieldType, ReinforcementResult>();

    for (const field of this.fieldConfidences.keys()) {
      const result = this.calculateReinforcement(field);
      results.set(field, result);

      // Update field confidence
      this.fieldConfidences.set(field, result.reinforcedConfidence);
    }

    return results;
  }

  /**
   * Get influences for a field
   */
  getInfluences(field: FieldType): FieldInfluence[] {
    return this.influences.get(field) || [];
  }

  /**
   * Get all influences
   */
  getAllInfluences(): Map<string, FieldInfluence[]> {
    return new Map(this.influences);
  }

  /**
   * Remove influence
   */
  removeInfluence(sourceField: FieldType, targetField: FieldType): void {
    const key = `${sourceField}_${targetField}`;
    const influences = this.influences.get(targetField);
    
    if (influences) {
      const filtered = influences.filter(i => i.sourceField !== sourceField);
      this.influences.set(targetField, filtered);
      console.log(`[CrossFieldReinforcement] Removed influence: ${sourceField} → ${targetField}`);
    }
  }

  /**
   * Clear all field values and confidences
   */
  clearFieldData(): void {
    this.fieldValues.clear();
    this.fieldConfidences.clear();
  }

  /**
   * Reset to default influences
   */
  resetToDefaults(): void {
    this.influences.clear();
    this.initializeDefaultInfluences();
  }

  /**
   * Log reinforcement results
   */
  logReinforcementResults(results: Map<FieldType, ReinforcementResult>): void {
    console.log('\n=== CROSS-FIELD REINFORCEMENT RESULTS ===');
    
    for (const [field, result] of results.entries()) {
      console.log(`\n${field}:`);
      console.log(`  Original Confidence: ${result.originalConfidence.toFixed(3)}`);
      console.log(`  Reinforced Confidence: ${result.reinforcedConfidence.toFixed(3)}`);
      console.log(`  Active Influences: ${result.influences.length}`);
      
      for (const influence of result.influences) {
        console.log(`    ${influence.sourceField} → ${influence.direction} (${influence.influenceStrength.toFixed(2)})`);
      }
      
      console.log(`  Explanation: ${result.explanation}`);
    }
    
    console.log('\n=== END REINFORCEMENT RESULTS ===\n');
  }

  /**
   * Log influence graph
   */
  logInfluenceGraph(): void {
    console.log('\n=== CROSS-FIELD INFLUENCE GRAPH ===');
    
    for (const [targetField, influences] of this.influences.entries()) {
      console.log(`\n${targetField}:`);
      
      for (const influence of influences) {
        console.log(`  ← ${influence.sourceField} (${influence.direction}, strength: ${influence.influenceStrength.toFixed(2)})`);
      }
    }
    
    console.log('\n=== END INFLUENCE GRAPH ===\n');
  }
}
