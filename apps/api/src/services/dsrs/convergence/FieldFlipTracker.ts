/**
 * DSRS v3.5 - Field Flip Tracker
 * 
 * Tracks how often field winners change across iterations
 * Identifies unstable fields that should have reduced reweighting impact
 */

import { FieldType } from '../tournament/Candidate';

export interface FieldFlipHistory {
  field: FieldType;
  winners: any[];
  flipCount: number;
  flipRate: number;
  stability: 'STABLE' | 'UNSTABLE' | 'HIGHLY_UNSTABLE';
}

export class FieldFlipTracker {
  private history: Map<FieldType, any[]>;
  private flipCounts: Map<FieldType, number>;

  constructor() {
    this.history = new Map();
    this.flipCounts = new Map();
  }

  /**
   * Record field winner for current iteration
   */
  recordWinner(field: FieldType, winner: any): void {
    if (!this.history.has(field)) {
      this.history.set(field, []);
      this.flipCounts.set(field, 0);
    }

    const fieldHistory = this.history.get(field)!;
    const previousWinner = fieldHistory.length > 0 ? fieldHistory[fieldHistory.length - 1] : null;

    // Check if winner changed
    if (previousWinner !== null && this.valuesDiffer(previousWinner, winner)) {
      this.flipCounts.set(field, this.flipCounts.get(field)! + 1);
    }

    fieldHistory.push(winner);
  }

  /**
   * Get flip history for a field
   */
  getFieldHistory(field: FieldType): FieldFlipHistory {
    const winners = this.history.get(field) || [];
    const flipCount = this.flipCounts.get(field) || 0;
    const flipRate = winners.length > 1 ? flipCount / (winners.length - 1) : 0;
    const stability = this.calculateStability(flipRate);

    return {
      field,
      winners,
      flipCount,
      flipRate,
      stability
    };
  }

  /**
   * Get all field histories
   */
  getAllHistories(): FieldFlipHistory[] {
    const histories: FieldFlipHistory[] = [];

    for (const field of this.history.keys()) {
      histories.push(this.getFieldHistory(field));
    }

    return histories;
  }

  /**
   * Calculate stability from flip rate
   */
  private calculateStability(flipRate: number): 'STABLE' | 'UNSTABLE' | 'HIGHLY_UNSTABLE' {
    if (flipRate < 0.2) return 'STABLE';
    if (flipRate < 0.5) return 'UNSTABLE';
    return 'HIGHLY_UNSTABLE';
  }

  /**
   * Check if two values differ
   */
  private valuesDiffer(value1: any, value2: any): boolean {
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      return Math.abs(value1 - value2) > 0.01;
    }
    if (typeof value1 === 'string' && typeof value2 === 'string') {
      return value1 !== value2;
    }
    return value1 !== value2;
  }

  /**
   * Get stability factor for a field (used for damping)
   */
  getStabilityFactor(field: FieldType): number {
    const history = this.getFieldHistory(field);
    
    switch (history.stability) {
      case 'STABLE':
        return 1.0; // Full reweighting impact
      case 'UNSTABLE':
        return 0.5; // Reduced impact
      case 'HIGHLY_UNSTABLE':
        return 0.2; // Minimal impact
      default:
        return 1.0;
    }
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.history.clear();
    this.flipCounts.clear();
  }

  /**
   * Log flip statistics
   */
  logFlipStats(): void {
    console.log('\n=== FIELD FLIP STATISTICS ===');
    
    const histories = this.getAllHistories();
    
    for (const history of histories) {
      console.log(`\n${history.field.toUpperCase()}:`);
      console.log(`  Winners: ${history.winners.length}`);
      console.log(`  Flips: ${history.flipCount}`);
      console.log(`  Flip Rate: ${(history.flipRate * 100).toFixed(1)}%`);
      console.log(`  Stability: ${history.stability}`);
      console.log(`  Stability Factor: ${this.getStabilityFactor(history.field).toFixed(2)}`);
    }
    
    console.log('\n=== END FLIP STATISTICS ===\n');
  }
}
