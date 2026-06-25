/**
 * DSRS v2.5 - Global Candidate Pool
 * 
 * Collects candidates from ALL extractors and unifies them into Candidate[]
 * This is the central hub where all extraction outputs compete
 */

import { Candidate, CandidateFactory, FieldType, CandidateMetadata } from './Candidate';

export interface ExtractorOutput {
  field: FieldType;
  value: any;
  source: string;
  confidence: number;
  metadata?: CandidateMetadata;
}

export class GlobalCandidatePool {
  private candidates: Map<FieldType, Candidate[]>;
  private extractors: Map<string, (text: string) => ExtractorOutput[]>;

  constructor() {
    this.candidates = new Map();
    this.extractors = new Map();
  }

  /**
   * Register an extractor function
   */
  registerExtractor(name: string, extractor: (text: string) => ExtractorOutput[]): void {
    this.extractors.set(name, extractor);
    console.log(`[GlobalCandidatePool] Registered extractor: ${name}`);
  }

  /**
   * Run all registered extractors on text and collect candidates
   */
  async extractFromText(text: string): Promise<Map<FieldType, Candidate[]>> {
    console.log('[GlobalCandidatePool] Running all extractors on text');
    CandidateFactory.resetIdCounter();
    this.candidates.clear();

    // Run each registered extractor
    for (const [name, extractor] of this.extractors.entries()) {
      try {
        console.log(`[GlobalCandidatePool] Running extractor: ${name}`);
        const outputs = extractor(text);
        
        for (const output of outputs) {
          this.addCandidate(output);
        }
        
        console.log(`[GlobalCandidatePool] Extractor ${name} produced ${outputs.length} candidates`);
      } catch (error) {
        console.error(`[GlobalCandidatePool] Extractor ${name} failed:`, error);
      }
    }

    // Log summary
    console.log('[GlobalCandidatePool] Extraction complete:');
    for (const [field, candidates] of this.candidates.entries()) {
      console.log(`  ${field}: ${candidates.length} candidates`);
    }

    return this.candidates;
  }

  /**
   * Add a candidate to the pool
   */
  private addCandidate(output: ExtractorOutput): void {
    const candidate = CandidateFactory.createCandidate(
      output.field,
      output.value,
      output.source,
      output.metadata || {}
    );
    
    candidate.confidence = output.confidence;
    
    if (!this.candidates.has(output.field)) {
      this.candidates.set(output.field, []);
    }
    
    this.candidates.get(output.field)!.push(candidate);
  }

  /**
   * Get candidates for a specific field
   */
  getCandidates(field: FieldType): Candidate[] {
    return this.candidates.get(field) || [];
  }

  /**
   * Get all candidates
   */
  getAllCandidates(): Map<FieldType, Candidate[]> {
    return this.candidates;
  }

  /**
   * Get candidate count by field
   */
  getCandidateCount(): Map<FieldType, number> {
    const counts = new Map<FieldType, number>();
    for (const [field, candidates] of this.candidates.entries()) {
      counts.set(field, candidates.length);
    }
    return counts;
  }

  /**
   * Clear all candidates
   */
  clear(): void {
    this.candidates.clear();
  }

  /**
   * Get registered extractor names
   */
  getRegisteredExtractors(): string[] {
    return Array.from(this.extractors.keys());
  }

  /**
   * Remove an extractor
   */
  unregisterExtractor(name: string): void {
    this.extractors.delete(name);
    console.log(`[GlobalCandidatePool] Unregistered extractor: ${name}`);
  }

  /**
   * Log pool state for debugging
   */
  logPoolState(): void {
    console.log('\n=== GLOBAL CANDIDATE POOL STATE ===');
    console.log(`Registered extractors: ${this.extractors.size}`);
    console.log(`Fields with candidates: ${this.candidates.size}`);
    
    for (const [field, candidates] of this.candidates.entries()) {
      console.log(`\n${field.toUpperCase()} (${candidates.length}):`);
      candidates.slice(0, 5).forEach((candidate, index) => {
        console.log(`  ${index + 1}. Value: ${candidate.value}`);
        console.log(`     Source: ${candidate.source}`);
        console.log(`     Confidence: ${candidate.confidence.toFixed(2)}`);
        console.log(`     Graph Score: ${candidate.graphScore.toFixed(2)}`);
        console.log(`     Context Score: ${candidate.contextScore.toFixed(2)}`);
        console.log(`     Role Score: ${candidate.roleScore.toFixed(2)}`);
      });
      if (candidates.length > 5) {
        console.log(`  ... and ${candidates.length - 5} more`);
      }
    }
    
    console.log('\n=== END POOL STATE ===\n');
  }

  /**
   * Export pool as JSON
   */
  exportJSON(): string {
    const exportData = {
      timestamp: new Date().toISOString(),
      registeredExtractors: Array.from(this.extractors.keys()),
      candidates: {}
    };
    
    for (const [field, candidates] of this.candidates.entries()) {
      (exportData.candidates as any)[field] = candidates.map(c => ({
        id: c.id,
        value: c.value,
        source: c.source,
        confidence: c.confidence,
        graphScore: c.graphScore,
        contextScore: c.contextScore,
        roleScore: c.roleScore,
        globalScore: c.globalScore,
        metadata: c.metadata
      }));
    }
    
    return JSON.stringify(exportData, null, 2);
  }
}
