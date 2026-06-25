/**
 * DSRS v2.5 - Unified Candidate Model
 * 
 * Every extractor MUST output this unified interface
 * No extractor is trusted anymore - only candidates are
 */

export type FieldType = 'amount' | 'vendor' | 'invoice_number' | 'qty' | 'sku' | 'po_number' | 'account_number' | 'brand_code' | 'currency' | 'payment_terms' | 'invoice_date' | 'due_date' | 'unit_price' | 'swift' | 'bill_to' | 'ship_to';

export interface CandidateMetadata {
  position?: number;
  tokenSpan?: [number, number];
  isFromTable?: boolean;
  isFromPO?: boolean;
  isFromBank?: boolean;
  isFromAddress?: boolean;
  isFromHeader?: boolean;
  isFromFooter?: boolean;
  isFromLineItem?: boolean;
  ocrConfidence?: number;
  contextWindow?: string;
}

export interface Candidate {
  id: string;
  field: FieldType;
  value: any;
  source: string; // extractor name (e.g., 'amountExtractor', 'vendorExtractor')
  confidence: number; // 0-1 from extractor
  graphScore: number; // 0-1 from graph traversal
  contextScore: number; // 0-1 from context analysis
  roleScore: number; // 0-1 from role classification (PRIMARY/SECONDARY/NOISE)
  globalScore: number; // computed final score
  metadata: CandidateMetadata;
  tournamentModifiers?: {
    anchorBoost?: number;
    structuralBoost?: number;
    noisePenalty?: number;
    consistencyBonus?: number;
  };
  explanation?: string; // human-readable reason for score
}

export interface ScoreBreakdown {
  roleScore: number;
  graphScore: number;
  contextScore: number;
  confidence: number;
  anchorBoost: number;
  structuralBoost: number;
  noisePenalty: number;
  consistencyBonus: number;
  globalScore: number;
}

export interface TournamentResult {
  field: FieldType;
  winner: Candidate;
  runnerUps: Candidate[];
  scoreBreakdown: ScoreBreakdown;
  explanation: string;
  confidenceSeparation: number; // difference between winner and runner-up
  requiresConsistencyCheck: boolean;
}

/**
 * Factory for creating candidates
 */
export class CandidateFactory {
  private static idCounter = 0;

  static createCandidate(
    field: FieldType,
    value: any,
    source: string,
    metadata: CandidateMetadata = {}
  ): Candidate {
    return {
      id: `candidate_${this.idCounter++}`,
      field,
      value,
      source,
      confidence: 0.5, // default confidence
      graphScore: 0.5, // default graph score
      contextScore: 0.5, // default context score
      roleScore: 0.5, // default role score
      globalScore: 0, // will be computed
      metadata,
      tournamentModifiers: {}
    };
  }

  static createAmountCandidate(
    value: number,
    source: string,
    metadata: CandidateMetadata = {}
  ): Candidate {
    return this.createCandidate('amount', value, source, metadata);
  }

  static createVendorCandidate(
    value: string,
    source: string,
    metadata: CandidateMetadata = {}
  ): Candidate {
    return this.createCandidate('vendor', value, source, metadata);
  }

  static createInvoiceNumberCandidate(
    value: string,
    source: string,
    metadata: CandidateMetadata = {}
  ): Candidate {
    return this.createCandidate('invoice_number', value, source, metadata);
  }

  static createQuantityCandidate(
    value: number,
    source: string,
    metadata: CandidateMetadata = {}
  ): Candidate {
    return this.createCandidate('qty', value, source, metadata);
  }

  static createSKUCandidate(
    value: string,
    source: string,
    metadata: CandidateMetadata = {}
  ): Candidate {
    return this.createCandidate('sku', value, source, metadata);
  }

  static resetIdCounter(): void {
    this.idCounter = 0;
  }
}
