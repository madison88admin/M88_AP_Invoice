/**
 * DSRS v4 - Region-Scoped Candidate Pool
 * 
 * Region-specific field buckets
 * Enforces region boundaries during candidate collection
 */

import { Candidate, FieldType } from '../tournament/Candidate';
import { RegionType } from './LayoutGraphBuilder';
import { RegionFieldBinding } from './RegionFieldBinding';

export interface RegionBucket {
  region: RegionType;
  fields: Map<FieldType, Candidate[]>;
  regionConfidence: number;
}

export class RegionCandidatePool {
  private regionBuckets: Map<RegionType, RegionBucket>;
  private fieldBinding: RegionFieldBinding;

  constructor(fieldBinding?: RegionFieldBinding) {
    this.regionBuckets = new Map();
    this.fieldBinding = fieldBinding || new RegionFieldBinding();
  }

  /**
   * Initialize region buckets
   */
  initializeRegions(regions: RegionType[]): void {
    for (const region of regions) {
      this.regionBuckets.set(region, {
        region,
        fields: new Map(),
        regionConfidence: 0.5
      });
    }
  }

  /**
   * Add candidate to region bucket
   */
  addCandidate(candidate: Candidate, region: RegionType): boolean {
    // Check if field is allowed in this region
    if (!this.fieldBinding.isFieldAllowedInRegion(candidate.field, region)) {
      console.log(`[RegionCandidatePool] Candidate ${candidate.field} rejected from region ${region} (not allowed)`);
      return false;
    }

    const bucket = this.regionBuckets.get(region);
    if (!bucket) {
      console.log(`[RegionCandidatePool] Region ${region} not initialized, creating bucket`);
      this.regionBuckets.set(region, {
        region,
        fields: new Map(),
        regionConfidence: 0.5
      });
      return this.addCandidate(candidate, region);
    }

    // Add to field-specific list
    if (!bucket.fields.has(candidate.field)) {
      bucket.fields.set(candidate.field, []);
    }
    bucket.fields.get(candidate.field)!.push(candidate);

    console.log(`[RegionCandidatePool] Added ${candidate.field} candidate to ${region} region: ${candidate.value}`);

    return true;
  }

  /**
   * Get candidates for a field from a specific region
   */
  getCandidatesFromRegion(field: FieldType, region: RegionType): Candidate[] {
    const bucket = this.regionBuckets.get(region);
    if (!bucket) return [];

    return bucket.fields.get(field) || [];
  }

  /**
   * Get all candidates for a field across all regions
   */
  getCandidatesForField(field: FieldType): Map<RegionType, Candidate[]> {
    const candidates = new Map<RegionType, Candidate[]>();

    for (const [region, bucket] of this.regionBuckets.entries()) {
      const fieldCandidates = bucket.fields.get(field);
      if (fieldCandidates && fieldCandidates.length > 0) {
        candidates.set(region, fieldCandidates);
      }
    }

    return candidates;
  }

  /**
   * Get candidates from preferred region for a field
   */
  getCandidatesFromPreferredRegion(field: FieldType): Candidate[] {
    const preferredRegion = this.fieldBinding.getPreferredRegion(field);
    if (!preferredRegion) return [];

    return this.getCandidatesFromRegion(field, preferredRegion);
  }

  /**
   * Merge candidates from multiple regions for a field
   */
  mergeCandidatesForField(field: FieldType): Candidate[] {
    const allCandidates: Candidate[] = [];

    for (const [region, bucket] of this.regionBuckets.entries()) {
      const fieldCandidates = bucket.fields.get(field);
      if (fieldCandidates) {
        // Add region metadata to candidates
        const regionCandidates = fieldCandidates.map(c => ({
          ...c,
          metadata: {
            ...c.metadata,
            region: region
          }
        }));
        allCandidates.push(...regionCandidates);
      }
    }

    return allCandidates;
  }

  /**
   * Set region confidence
   */
  setRegionConfidence(region: RegionType, confidence: number): void {
    const bucket = this.regionBuckets.get(region);
    if (bucket) {
      bucket.regionConfidence = confidence;
    }
  }

  /**
   * Get region confidence
   */
  getRegionConfidence(region: RegionType): number {
    const bucket = this.regionBuckets.get(region);
    return bucket?.regionConfidence || 0.5;
  }

  /**
   * Propagate region confidence to candidates
   */
  propagateRegionConfidence(): void {
    for (const [region, bucket] of this.regionBuckets.entries()) {
      const regionConfidence = bucket.regionConfidence;

      for (const [field, candidates] of bucket.fields.entries()) {
        for (const candidate of candidates) {
          // Adjust candidate confidence based on region confidence
          candidate.confidence = candidate.confidence * (0.5 + regionConfidence * 0.5);
        }
      }
    }
  }

  /**
   * Get region bucket
   */
  getRegionBucket(region: RegionType): RegionBucket | undefined {
    return this.regionBuckets.get(region);
  }

  /**
   * Get all region buckets
   */
  getAllRegionBuckets(): Map<RegionType, RegionBucket> {
    return new Map(this.regionBuckets);
  }

  /**
   * Get field binding
   */
  getFieldBinding(): RegionFieldBinding {
    return this.fieldBinding;
  }

  /**
   * Set field binding
   */
  setFieldBinding(binding: RegionFieldBinding): void {
    this.fieldBinding = binding;
  }

  /**
   * Clear all candidates
   */
  clear(): void {
    for (const bucket of this.regionBuckets.values()) {
      bucket.fields.clear();
    }
  }

  /**
   * Reset region buckets
   */
  reset(): void {
    this.regionBuckets.clear();
  }

  /**
   * Export to JSON
   */
  toJSON(): any {
    const exportData: any = {};

    for (const [region, bucket] of this.regionBuckets.entries()) {
      exportData[region] = {
        region: bucket.region,
        regionConfidence: bucket.regionConfidence,
        fields: {}
      };

      for (const [field, candidates] of bucket.fields.entries()) {
        exportData[region].fields[field] = candidates.map(c => ({
          value: c.value,
          confidence: c.confidence,
          source: c.source
        }));
      }
    }

    return exportData;
  }

  /**
   * Log pool state
   */
  logPoolState(): void {
    console.log('\n=== REGION CANDIDATE POOL STATE ===');
    
    for (const [region, bucket] of this.regionBuckets.entries()) {
      console.log(`\n${region}:`);
      console.log(`  Region Confidence: ${bucket.regionConfidence.toFixed(3)}`);
      console.log(`  Fields: ${bucket.fields.size}`);
      
      for (const [field, candidates] of bucket.fields.entries()) {
        console.log(`    ${field}: ${candidates.length} candidates`);
        candidates.forEach(c => {
          console.log(`      - ${c.value} (conf: ${c.confidence.toFixed(3)})`);
        });
      }
    }
    
    console.log('\n=== END POOL STATE ===\n');
  }
}
