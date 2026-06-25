/**
 * DSRS v2 - Anchor Hierarchy Model
 * 
 * Prioritizes PRIMARY anchors by tier to reduce decision space before scoring
 * Prevents fallback from competing too aggressively with higher-tier anchors
 */

import { GraphNode } from './CandidateGraphBuilder';

export enum AnchorTier {
  TIER_0_ABSOLUTE = 0,  // SAY TOTAL, GRAND TOTAL, AMOUNT DUE
  TIER_1_STRONG = 1,     // TOTAL, INVOICE TOTAL
  TIER_2_WEAK = 2,       // AMOUNT, SUM
  TIER_3_FALLBACK = 3    // highest $ value after filtering
}

export interface Anchor {
  node: GraphNode;
  tier: AnchorTier;
  pattern: string;
}

export class AnchorHierarchy {
  private tierPatterns: Map<AnchorTier, RegExp[]>;

  constructor() {
    this.tierPatterns = new Map([
      [AnchorTier.TIER_0_ABSOLUTE, [
        /SAY TOTAL/i,
        /GRAND TOTAL/i,
        /AMOUNT DUE/i
      ]],
      [AnchorTier.TIER_1_STRONG, [
        /TOTAL/i,
        /INVOICE TOTAL/i
      ]],
      [AnchorTier.TIER_2_WEAK, [
        /AMOUNT/i,
        /SUM/i
      ]],
      [AnchorTier.TIER_3_FALLBACK, []] // No patterns, uses currency symbol
    ]);
  }

  /**
   * Classify anchor node by tier
   */
  classifyAnchor(node: GraphNode): AnchorTier {
    const context = node.context.toUpperCase();
    const value = (node.value as string).toUpperCase();
    
    // Check tiers in order (highest priority first)
    for (const [tier, patterns] of this.tierPatterns.entries()) {
      if (tier === AnchorTier.TIER_3_FALLBACK) {
        continue; // Skip fallback tier for pattern matching
      }
      
      for (const pattern of patterns) {
        if (pattern.test(context) || pattern.test(value)) {
          return tier;
        }
      }
    }
    
    // If no pattern matches, default to TIER_2_WEAK for generic keywords
    if (node.type === 'keyword') {
      return AnchorTier.TIER_2_WEAK;
    }
    
    return AnchorTier.TIER_3_FALLBACK;
  }

  /**
   * Get all anchors from nodes, classified by tier
   */
  getAnchors(nodes: GraphNode[]): Anchor[] {
    const anchors: Anchor[] = [];
    
    for (const node of nodes) {
      if (node.type === 'keyword' && node.metadata.isTotalKeyword) {
        const tier = this.classifyAnchor(node);
        const pattern = this.getMatchingPattern(node, tier);
        
        anchors.push({
          node,
          tier,
          pattern
        });
      }
    }
    
    // Sort by tier (lower tier = higher priority)
    anchors.sort((a, b) => a.tier - b.tier);
    
    return anchors;
  }

  /**
   * Get anchors by specific tier
   */
  getAnchorsByTier(nodes: GraphNode[], tier: AnchorTier): Anchor[] {
    const allAnchors = this.getAnchors(nodes);
    return allAnchors.filter(a => a.tier === tier);
  }

  /**
   * Get highest priority anchors (lowest tier)
   */
  getHighestPriorityAnchors(nodes: GraphNode[]): Anchor[] {
    const allAnchors = this.getAnchors(nodes);
    
    if (allAnchors.length === 0) {
      return [];
    }
    
    const lowestTier = allAnchors[0].tier;
    return allAnchors.filter(a => a.tier === lowestTier);
  }

  /**
   * Get matching pattern for a node at a given tier
   */
  private getMatchingPattern(node: GraphNode, tier: AnchorTier): string {
    const patterns = this.tierPatterns.get(tier) || [];
    const context = node.context.toUpperCase();
    const value = (node.value as string).toUpperCase();
    
    for (const pattern of patterns) {
      if (pattern.test(context) || pattern.test(value)) {
        return pattern.source;
      }
    }
    
    return 'unknown';
  }

  /**
   * Check if tier has any anchors
   */
  hasAnchorsAtTier(nodes: GraphNode[], tier: AnchorTier): boolean {
    return this.getAnchorsByTier(nodes, tier).length > 0;
  }

  /**
   * Get tier name for logging
   */
  getTierName(tier: AnchorTier): string {
    switch (tier) {
      case AnchorTier.TIER_0_ABSOLUTE:
        return 'TIER_0_ABSOLUTE';
      case AnchorTier.TIER_1_STRONG:
        return 'TIER_1_STRONG';
      case AnchorTier.TIER_2_WEAK:
        return 'TIER_2_WEAK';
      case AnchorTier.TIER_3_FALLBACK:
        return 'TIER_3_FALLBACK';
      default:
        return 'UNKNOWN';
    }
  }

  /**
   * Log anchor hierarchy for debugging
   */
  logHierarchy(anchors: Anchor[]): void {
    console.log('\n=== ANCHOR HIERARCHY ===');
    
    const anchorsByTier = new Map<AnchorTier, Anchor[]>();
    for (const anchor of anchors) {
      if (!anchorsByTier.has(anchor.tier)) {
        anchorsByTier.set(anchor.tier, []);
      }
      anchorsByTier.get(anchor.tier)!.push(anchor);
    }
    
    for (const [tier, tierAnchors] of anchorsByTier.entries()) {
      console.log(`\n${this.getTierName(tier)} (${tierAnchors.length}):`);
      tierAnchors.forEach(anchor => {
        console.log(`  - ${anchor.node.value} (pattern: ${anchor.pattern})`);
      });
    }
    
    console.log('\n=== END ANCHOR HIERARCHY ===\n');
  }

  /**
   * Add custom pattern to a tier
   */
  addPattern(tier: AnchorTier, pattern: RegExp): void {
    const patterns = this.tierPatterns.get(tier) || [];
    patterns.push(pattern);
    this.tierPatterns.set(tier, patterns);
  }

  /**
   * Remove pattern from a tier
   */
  removePattern(tier: AnchorTier, pattern: RegExp): void {
    const patterns = this.tierPatterns.get(tier) || [];
    const index = patterns.findIndex(p => p.source === pattern.source);
    if (index !== -1) {
      patterns.splice(index, 1);
      this.tierPatterns.set(tier, patterns);
    }
  }

  /**
   * Get all patterns for a tier
   */
  getPatterns(tier: AnchorTier): RegExp[] {
    return this.tierPatterns.get(tier) || [];
  }
}
