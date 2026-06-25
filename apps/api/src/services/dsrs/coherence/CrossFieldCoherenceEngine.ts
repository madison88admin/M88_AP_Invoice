/**
 * DSRS v3 - Cross-Field Coherence Engine
 * 
 * The brain that validates relationships between fields
 * Answers: "Do these winners make sense together as a document?"
 */

import { Candidate, FieldType } from '../tournament/Candidate';

export interface FieldState {
  value: any;
  confidence: number;
  stability: 'HIGH' | 'MEDIUM' | 'LOW';
  conflictScore: number;
  dependencyLinks: string[]; // links to other fields
}

export interface InvoiceState {
  fields: Map<FieldType, FieldState>;
  coherenceScore: number;
  status: 'STABLE' | 'UNSTABLE' | 'CONFLICT';
  conflicts: ConflictFlag[];
}

export type ConflictFlag =
  | 'AMOUNT_PO_MISMATCH'
  | 'AMOUNT_LINEITEM_MISMATCH'
  | 'VENDOR_MISMATCH'
  | 'VENDOR_MISSING'
  | 'CURRENCY_MISMATCH'
  | 'CURRENCY_MISMATCH_MINOR'
  | 'QTY_MISMATCH'
  | 'STRUCTURAL_INTEGRITY_LOW'
  | 'NO_CONFLICTS';

export interface CoherenceConfig {
  amountLineItemMatchBonus: number;
  amountPoMismatchPenalty: number;
  amountSingleLineItemBonus: number;
  vendorPoMatchBonus: number;
  vendorBillToBonus: number;
  vendorMissingPenalty: number;
  currencyMismatchMinorPenalty: number;
  currencyMismatchMajorPenalty: number;
  qtyLineItemMatchBonus: number;
  qtyPoExcessPenalty: number;
  structuralIntegrityBonus: number;
  structuralIntegrityPenalty: number;
  stabilityThreshold: number;
  conflictThreshold: number;
}

export const DEFAULT_COHERENCE_CONFIG: CoherenceConfig = {
  amountLineItemMatchBonus: 0.4,
  amountPoMismatchPenalty: -0.4,
  amountSingleLineItemBonus: 0.2,
  vendorPoMatchBonus: 0.5,
  vendorBillToBonus: 0.2,
  vendorMissingPenalty: -0.6,
  currencyMismatchMinorPenalty: -0.1,
  currencyMismatchMajorPenalty: -0.4,
  qtyLineItemMatchBonus: 0.3,
  qtyPoExcessPenalty: -0.2,
  structuralIntegrityBonus: 0.3,
  structuralIntegrityPenalty: -0.3,
  stabilityThreshold: 0.85,
  conflictThreshold: 0.5
};

export interface POData {
  amount?: number;
  vendor?: string;
  currency?: string;
  expectedQty?: number;
}

export interface LineItemData {
  totalAmount: number;
  totalQty: number;
  itemCount: number;
  hasValidSKUs: boolean;
}

export class CrossFieldCoherenceEngine {
  private config: CoherenceConfig;

  constructor(config: CoherenceConfig = DEFAULT_COHERENCE_CONFIG) {
    this.config = config;
  }

  /**
   * Evaluate coherence of field winners
   */
  evaluateCoherence(
    fieldStates: Map<FieldType, FieldState>,
    poData?: POData,
    lineItemData?: LineItemData
  ): InvoiceState {
    console.log('[CrossFieldCoherenceEngine] Evaluating field coherence');

    const conflicts: ConflictFlag[] = [];
    let coherenceScore = 0.5; // base score

    // Rule 1: Amount Consistency
    const amountState = fieldStates.get('amount');
    if (amountState) {
      const amountResult = this.evaluateAmountCoherence(amountState, poData, lineItemData);
      coherenceScore += amountResult.score;
      conflicts.push(...amountResult.conflicts);
    }

    // Rule 2: Vendor Consistency
    const vendorState = fieldStates.get('vendor');
    if (vendorState) {
      const vendorResult = this.evaluateVendorCoherence(vendorState, poData);
      coherenceScore += vendorResult.score;
      conflicts.push(...vendorResult.conflicts);
    }

    // Rule 3: Currency Consistency
    const currencyState = fieldStates.get('currency');
    if (currencyState) {
      const currencyResult = this.evaluateCurrencyCoherence(currencyState, poData);
      coherenceScore += currencyResult.score;
      conflicts.push(...currencyResult.conflicts);
    }

    // Rule 4: Quantity Consistency
    const qtyState = fieldStates.get('qty');
    if (qtyState) {
      const qtyResult = this.evaluateQuantityCoherence(qtyState, poData, lineItemData);
      coherenceScore += qtyResult.score;
      conflicts.push(...qtyResult.conflicts);
    }

    // Rule 5: Structural Integrity
    const structuralResult = this.evaluateStructuralIntegrity(fieldStates, lineItemData);
    coherenceScore += structuralResult.score;
    conflicts.push(...structuralResult.conflicts);

    // Normalize coherence score to [0, 1]
    coherenceScore = Math.max(0, Math.min(1, coherenceScore));

    // Determine status
    let status: 'STABLE' | 'UNSTABLE' | 'CONFLICT';
    if (coherenceScore >= this.config.stabilityThreshold) {
      status = 'STABLE';
    } else if (coherenceScore >= this.config.conflictThreshold) {
      status = 'UNSTABLE';
    } else {
      status = 'CONFLICT';
    }

    // Remove NO_CONFLICTS flag if other conflicts exist
    if (conflicts.length > 1 || (conflicts.length === 1 && conflicts[0] !== 'NO_CONFLICTS')) {
      const noConflictIndex = conflicts.indexOf('NO_CONFLICTS');
      if (noConflictIndex !== -1) {
        conflicts.splice(noConflictIndex, 1);
      }
    }

    const invoiceState: InvoiceState = {
      fields: fieldStates,
      coherenceScore,
      status,
      conflicts
    };

    console.log(`[CrossFieldCoherenceEngine] Coherence score: ${coherenceScore.toFixed(3)}, Status: ${status}`);
    console.log(`[CrossFieldCoherenceEngine] Conflicts:`, conflicts);

    return invoiceState;
  }

  /**
   * Rule 1: Amount Consistency
   */
  private evaluateAmountCoherence(
    amountState: FieldState,
    poData?: POData,
    lineItemData?: LineItemData
  ): { score: number; conflicts: ConflictFlag[] } {
    let score = 0;
    const conflicts: ConflictFlag[] = [];

    // Check against line items
    if (lineItemData) {
      const amount = amountState.value as number;
      const lineItemTotal = lineItemData.totalAmount;

      if (Math.abs(amount - lineItemTotal) < 0.01) {
        score += this.config.amountLineItemMatchBonus;
        console.log('[Coherence] Amount matches line item total');
      } else if (lineItemData.itemCount === 1) {
        score += this.config.amountSingleLineItemBonus;
        console.log('[Coherence] Amount matches single line item (possible partial invoice)');
      }
    }

    // Check against PO
    if (poData && poData.amount) {
      const amount = amountState.value as number;
      const poAmount = poData.amount;
      const deviation = Math.abs(amount - poAmount) / poAmount;

      if (deviation > 0.1) { // 10% threshold
        score += this.config.amountPoMismatchPenalty;
        conflicts.push('AMOUNT_PO_MISMATCH');
        console.log(`[Coherence] Amount-PO mismatch: ${deviation.toFixed(2)} deviation`);
      }
    }

    return { score, conflicts };
  }

  /**
   * Rule 2: Vendor Consistency
   */
  private evaluateVendorCoherence(
    vendorState: FieldState,
    poData?: POData
  ): { score: number; conflicts: ConflictFlag[] } {
    let score = 0;
    const conflicts: ConflictFlag[] = [];

    const vendor = vendorState.value as string;

    // Check if vendor is null/missing
    if (!vendor || vendor.trim() === '') {
      score += this.config.vendorMissingPenalty;
      conflicts.push('VENDOR_MISSING');
      console.log('[Coherence] Vendor is missing');
      return { score, conflicts };
    }

    // Check against PO vendor
    if (poData && poData.vendor) {
      if (this.normalizeVendorName(vendor) === this.normalizeVendorName(poData.vendor)) {
        score += this.config.vendorPoMatchBonus;
        console.log('[Coherence] Vendor matches PO');
      } else {
        conflicts.push('VENDOR_MISMATCH');
        console.log('[Coherence] Vendor mismatch with PO');
      }
    }

    // Check if vendor appears in bill-to/ship-from (placeholder for now)
    // TODO: Implement when bill-to/ship-from extraction is available

    return { score, conflicts };
  }

  /**
   * Rule 3: Currency Consistency
   */
  private evaluateCurrencyCoherence(
    currencyState: FieldState,
    poData?: POData
  ): { score: number; conflicts: ConflictFlag[] } {
    let score = 0;
    const conflicts: ConflictFlag[] = [];

    const currency = currencyState.value as string;

    // Check against PO currency
    if (poData && poData.currency) {
      if (currency.toUpperCase() !== poData.currency.toUpperCase()) {
        // Check for FX context (placeholder for now)
        const hasFxContext = false; // TODO: Implement FX context detection

        if (hasFxContext) {
          score += this.config.currencyMismatchMinorPenalty;
          conflicts.push('CURRENCY_MISMATCH_MINOR');
          console.log('[Coherence] Currency mismatch with FX context');
        } else {
          score += this.config.currencyMismatchMajorPenalty;
          conflicts.push('CURRENCY_MISMATCH');
          console.log('[Coherence] Currency mismatch without FX context');
        }
      }
    }

    return { score, conflicts };
  }

  /**
   * Rule 4: Quantity Consistency
   */
  private evaluateQuantityCoherence(
    qtyState: FieldState,
    poData?: POData,
    lineItemData?: LineItemData
  ): { score: number; conflicts: ConflictFlag[] } {
    let score = 0;
    const conflicts: ConflictFlag[] = [];

    const qty = qtyState.value as number;

    // Check against line items
    if (lineItemData) {
      const lineItemQty = lineItemData.totalQty;
      if (Math.abs(qty - lineItemQty) < 0.01) {
        score += this.config.qtyLineItemMatchBonus;
        console.log('[Coherence] Quantity matches line item total');
      }
    }

    // Check against PO expected quantity
    if (poData && poData.expectedQty) {
      if (qty > poData.expectedQty) {
        score += this.config.qtyPoExcessPenalty;
        conflicts.push('QTY_MISMATCH');
        console.log('[Coherence] Quantity exceeds PO expected');
      }
    }

    return { score, conflicts };
  }

  /**
   * Rule 5: Structural Integrity
   */
  private evaluateStructuralIntegrity(
    fieldStates: Map<FieldType, FieldState>,
    lineItemData?: LineItemData
  ): { score: number; conflicts: ConflictFlag[] } {
    let score = 0;
    const conflicts: ConflictFlag[] = [];

    // Check for table detection and SKU alignment
    if (lineItemData) {
      if (lineItemData.hasValidSKUs && lineItemData.itemCount > 0) {
        score += this.config.structuralIntegrityBonus;
        console.log('[Coherence] Valid table structure with SKU alignment');
      } else if (lineItemData.itemCount === 0) {
        score += this.config.structuralIntegrityPenalty;
        conflicts.push('STRUCTURAL_INTEGRITY_LOW');
        console.log('[Coherence] No line items detected');
      }
    }

    // Check for random numeric scatter (placeholder for now)
    // TODO: Implement numeric scatter detection

    return { score, conflicts };
  }

  /**
   * Normalize vendor name for comparison
   */
  private normalizeVendorName(name: string): string {
    return name.toUpperCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Update coherence configuration
   */
  updateConfig(config: Partial<CoherenceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CoherenceConfig {
    return { ...this.config };
  }

  /**
   * Generate feedback signals for graph re-weighting
   */
  generateFeedbackSignals(invoiceState: InvoiceState): Map<string, number> {
    const signals = new Map<string, number>();

    for (const conflict of invoiceState.conflicts) {
      switch (conflict) {
        case 'AMOUNT_PO_MISMATCH':
          signals.set('AMOUNT_PO_MISMATCH', this.config.amountPoMismatchPenalty);
          break;
        case 'VENDOR_MISMATCH':
          signals.set('VENDOR_MISMATCH', -0.3);
          break;
        case 'VENDOR_MISSING':
          signals.set('VENDOR_MISSING', this.config.vendorMissingPenalty);
          break;
        case 'CURRENCY_MISMATCH':
          signals.set('CURRENCY_MISMATCH', this.config.currencyMismatchMajorPenalty);
          break;
        case 'QTY_MISMATCH':
          signals.set('QTY_MISMATCH', this.config.qtyPoExcessPenalty);
          break;
        case 'STRUCTURAL_INTEGRITY_LOW':
          signals.set('STRUCTURAL_INTEGRITY_LOW', this.config.structuralIntegrityPenalty);
          break;
      }
    }

    return signals;
  }
}
