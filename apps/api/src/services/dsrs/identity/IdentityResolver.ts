/**
 * DSRS v5 - Identity Resolver
 * 
 * Determines if two names are actually the same economic entity
 * Scoring model: nameSimilarity + addressMatch + bankMatch + historicalLink
 */

import { EntityNode, EntityEdge } from './EntityIdentityGraph';

export interface IdentityResolution {
  isSameEntity: boolean;
  confidence: number;
  relationship: string;
  explanation: string[];
  scoreBreakdown: {
    nameSimilarity: number;
    addressMatch: number;
    bankMatch: number;
    historicalLink: number;
  };
}

export interface IdentityWeights {
  nameSimilarity: number;
  addressMatch: number;
  bankMatch: number;
  historicalLink: number;
}

export class IdentityResolver {
  private weights: IdentityWeights;
  private historicalLinks: Map<string, Set<string>>; // entity ID -> linked entity IDs

  constructor(customWeights?: Partial<IdentityWeights>) {
    this.weights = {
      nameSimilarity: 0.4,
      addressMatch: 0.2,
      bankMatch: 0.2,
      historicalLink: 0.2,
      ...customWeights
    };
    this.historicalLinks = new Map();
  }

  /**
   * Resolve identity between two entities
   */
  resolveIdentity(entity1: EntityNode, entity2: EntityNode): IdentityResolution {
    console.log(`[IdentityResolver] Resolving identity between ${entity1.name} and ${entity2.name}`);

    const nameSimilarity = this.calculateNameSimilarity(entity1.name, entity2.name);
    const addressMatch = this.calculateAddressMatch(entity1, entity2);
    const bankMatch = this.calculateBankMatch(entity1, entity2);
    const historicalLink = this.calculateHistoricalLink(entity1.id, entity2.id);

    const scoreBreakdown = {
      nameSimilarity,
      addressMatch,
      bankMatch,
      historicalLink
    };

    // Calculate weighted score
    const weightedScore =
      (nameSimilarity * this.weights.nameSimilarity) +
      (addressMatch * this.weights.addressMatch) +
      (bankMatch * this.weights.bankMatch) +
      (historicalLink * this.weights.historicalLink);

    const isSameEntity = weightedScore > 0.6;
    const relationship = this.determineRelationship(weightedScore, entity1, entity2);
    const explanation = this.generateExplanation(scoreBreakdown, weightedScore, relationship);

    const resolution: IdentityResolution = {
      isSameEntity,
      confidence: weightedScore,
      relationship,
      explanation,
      scoreBreakdown
    };

    console.log(`[IdentityResolver] Resolution:`, {
      isSameEntity,
      confidence: weightedScore.toFixed(3),
      relationship,
      scoreBreakdown
    });

    return resolution;
  }

  /**
   * Calculate name similarity using multiple methods
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const upper1 = name1.toUpperCase();
    const upper2 = name2.toUpperCase();

    // Exact match
    if (upper1 === upper2) return 1.0;

    // Levenshtein distance
    const levenshteinSimilarity = this.levenshteinSimilarity(upper1, upper2);

    // Word overlap
    const wordOverlapSimilarity = this.wordOverlapSimilarity(upper1, upper2);

    // Common suffix/prefix matching (e.g., LTD, LIMITED, CO, COMPANY)
    const normalizedSimilarity = this.normalizedSimilarity(upper1, upper2);

    // Return the highest similarity
    return Math.max(levenshteinSimilarity, wordOverlapSimilarity, normalizedSimilarity);
  }

  /**
   * Levenshtein distance similarity
   */
  private levenshteinSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return maxLen > 0 ? 1 - distance / maxLen : 0;
  }

  /**
   * Word overlap similarity
   */
  private wordOverlapSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(/\s+/).filter(w => w.length > 2);
    const words2 = str2.split(/\s+/).filter(w => w.length > 2);

    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Normalized similarity (handles common suffixes/prefixes)
   */
  private normalizedSimilarity(str1: string, str2: string): number {
    const normalize = (str: string) => {
      return str
        .replace(/\b(LTD|LIMITED|LLC|INC|CORP|CO|COMPANY|GMBH|AG|SA|SAS|PTY)\b/g, '')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const norm1 = normalize(str1);
    const norm2 = normalize(str2);

    if (norm1 === norm2) return 0.9; // High confidence for normalized match

    return this.levenshteinSimilarity(norm1, norm2);
  }

  /**
   * Calculate address match
   */
  private calculateAddressMatch(entity1: EntityNode, entity2: EntityNode): number {
    const addr1 = entity1.attributes.address;
    const addr2 = entity2.attributes.address;

    if (!addr1 || !addr2) return 0;

    const similarity = this.levenshteinSimilarity(addr1.toUpperCase(), addr2.toUpperCase());
    
    // Boost if country matches
    const country1 = entity1.attributes.country;
    const country2 = entity2.attributes.country;
    if (country1 && country2 && country1 === country2) {
      return Math.min(1.0, similarity + 0.2);
    }

    return similarity;
  }

  /**
   * Calculate bank match
   */
  private calculateBankMatch(entity1: EntityNode, entity2: EntityNode): number {
    const bank1 = entity1.attributes.bank;
    const bank2 = entity2.attributes.bank;

    if (!bank1 || !bank2) return 0;

    // Exact match
    if (bank1 === bank2) return 1.0;

    // Partial match (account number similarity)
    const similarity = this.levenshteinSimilarity(bank1, bank2);
    return similarity > 0.8 ? similarity : 0;
  }

  /**
   * Calculate historical link
   */
  private calculateHistoricalLink(id1: string, id2: string): number {
    const links1 = this.historicalLinks.get(id1);
    const links2 = this.historicalLinks.get(id2);

    if (!links1 || !links2) return 0;

    // Check if they've been linked before
    if (links1.has(id2) && links2.has(id1)) {
      return 1.0;
    }

    return 0;
  }

  /**
   * Determine relationship type
   */
  private determineRelationship(score: number, entity1: EntityNode, entity2: EntityNode): string {
    if (score > 0.8) return "SAME_LEGAL_ENTITY";
    if (score > 0.6) return "LIKELY_SAME_ENTITY";
    if (score > 0.4) return "RELATED_ENTITY";
    if (score > 0.2) return "INTERMEDIARY_LINKED";
    return "NO_RELATIONSHIP";
  }

  /**
   * Generate explanation
   */
  private generateExplanation(breakdown: any, score: number, relationship: string): string[] {
    const explanations: string[] = [];

    if (breakdown.nameSimilarity > 0.8) {
      explanations.push("Very similar names");
    } else if (breakdown.nameSimilarity > 0.5) {
      explanations.push("Moderately similar names");
    } else {
      explanations.push("Different legal names");
    }

    if (breakdown.addressMatch > 0.7) {
      explanations.push("Shared or similar address");
    } else if (breakdown.addressMatch > 0.3) {
      explanations.push("Some address overlap");
    }

    if (breakdown.bankMatch > 0.8) {
      explanations.push("Shared bank account");
    } else if (breakdown.bankMatch > 0.3) {
      explanations.push("Some bank overlap");
    }

    if (breakdown.historicalLink > 0.5) {
      explanations.push("Historically linked entities");
    }

    return explanations;
  }

  /**
   * Add historical link
   */
  addHistoricalLink(id1: string, id2: string): void {
    if (!this.historicalLinks.has(id1)) {
      this.historicalLinks.set(id1, new Set());
    }
    if (!this.historicalLinks.has(id2)) {
      this.historicalLinks.set(id2, new Set());
    }

    this.historicalLinks.get(id1)!.add(id2);
    this.historicalLinks.get(id2)!.add(id1);

    console.log(`[IdentityResolver] Added historical link: ${id1} ↔ ${id2}`);
  }

  /**
   * Update weights
   */
  updateWeights(newWeights: Partial<IdentityWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
    console.log('[IdentityResolver] Updated weights:', this.weights);
  }

  /**
   * Get current weights
   */
  getWeights(): IdentityWeights {
    return { ...this.weights };
  }

  /**
   * Clear historical links
   */
  clearHistoricalLinks(): void {
    this.historicalLinks.clear();
  }

  /**
   * Batch resolve identities
   */
  batchResolveIdentities(entities: EntityNode[]): Map<string, IdentityResolution> {
    const results = new Map<string, IdentityResolution>();

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const key = `${entities[i].id}_${entities[j].id}`;
        const resolution = this.resolveIdentity(entities[i], entities[j]);
        results.set(key, resolution);
      }
    }

    return results;
  }
}
