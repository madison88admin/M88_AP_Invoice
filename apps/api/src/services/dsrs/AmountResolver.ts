/**
 * DSRS v2 - Amount Resolver
 * 
 * Resolves invoice total amount using graph traversal from PRIMARY anchors
 * Implements deterministic decision-making with explainable graph paths
 */

import { CandidateGraphBuilder, CandidateGraph, GraphNode, GraphEdge, NodeType, EdgeType } from './CandidateGraphBuilder';
import { GraphPruner, DEFAULT_PRUNING_CONFIG } from './GraphPruner';
import { AnchorHierarchy, AnchorTier } from './AnchorHierarchy';

export interface AmountResolution {
  amount: number | null;
  confidence: number;
  path: string[];
  explanation: string;
  rejectedCandidates: Array<{ amount: number; reason: string }>;
}

export class AmountResolver {
  private graph: CandidateGraph;
  private graphBuilder: CandidateGraphBuilder;
  private graphPruner: GraphPruner;
  private anchorHierarchy: AnchorHierarchy;

  constructor() {
    this.graphBuilder = new CandidateGraphBuilder();
    this.graphPruner = new GraphPruner(DEFAULT_PRUNING_CONFIG);
    this.anchorHierarchy = new AnchorHierarchy();
    this.graph = {
      nodes: new Map(),
      edges: new Map(),
      adjacencyList: new Map()
    };
  }

  /**
   * Resolve amount from invoice text using graph traversal
   */
  resolve(text: string): AmountResolution {
    console.log('[AmountResolver] Starting amount resolution');
    
    // Build candidate graph
    this.graph = this.graphBuilder.build(text);
    
    // Apply graph pruning to reduce noise
    this.graph = this.graphPruner.prune(this.graph);
    
    // Find anchors using hierarchy (priority order)
    const allNodes = Array.from(this.graph.nodes.values());
    const anchors = this.anchorHierarchy.getAnchors(allNodes);
    
    console.log('[AmountResolver] Found anchors by hierarchy:', anchors.length);
    this.anchorHierarchy.logHierarchy(anchors);
    
    if (anchors.length === 0) {
      console.log('[AmountResolver] No anchors found, using fallback');
      return this.fallbackResolution();
    }
    
    // Process anchors by tier (highest priority first)
    for (const tier of [AnchorTier.TIER_0_ABSOLUTE, AnchorTier.TIER_1_STRONG, AnchorTier.TIER_2_WEAK]) {
      const tierAnchors = this.anchorHierarchy.getAnchorsByTier(allNodes, tier);
      
      if (tierAnchors.length > 0) {
        console.log(`[AmountResolver] Processing ${this.anchorHierarchy.getTierName(tier)} anchors: ${tierAnchors.length}`);
        
        // Traverse from anchors at this tier (extract GraphNode from Anchor)
        const anchorNodes = tierAnchors.map(a => a.node);
        const candidates = this.traverseFromAnchors(anchorNodes);
        console.log('[AmountResolver] Found candidates from traversal:', candidates.length);
        
        // Apply structural validation
        const validatedCandidates = this.validateCandidates(candidates);
        console.log('[AmountResolver] Validated candidates:', validatedCandidates.length);
        
        // Select best candidate
        const bestCandidate = this.selectBestCandidate(validatedCandidates);
        
        if (bestCandidate) {
          console.log('[AmountResolver] Selected amount:', bestCandidate.amount, 'confidence:', bestCandidate.confidence);
          return {
            amount: bestCandidate.amount,
            confidence: bestCandidate.confidence,
            path: bestCandidate.path,
            explanation: bestCandidate.explanation,
            rejectedCandidates: bestCandidate.rejected
          };
        }
      }
    }
    
    console.log('[AmountResolver] No valid candidate found from any tier, using fallback');
    return this.fallbackResolution();
  }

  /**
   * Find PRIMARY anchor nodes (TOTAL, GRAND TOTAL, AMOUNT DUE, SAY TOTAL)
   */
  private findPrimaryAnchors(): GraphNode[] {
    const keywordNodes = this.graphBuilder.getNodesByType('keyword');
    return keywordNodes.filter(n => n.metadata.isTotalKeyword);
  }

  /**
   * Traverse from anchors to find candidate amounts
   */
  private traverseFromAnchors(anchors: GraphNode[]): Array<{
    amount: number;
    path: string[];
    score: number;
    node: GraphNode;
  }> {
    const candidates: Array<{
      amount: number;
      path: string[];
      score: number;
      node: GraphNode;
    }> = [];
    
    for (const anchor of anchors) {
      console.log('[AmountResolver] Traversing from anchor:', anchor.value, 'at position:', anchor.position);
      
      // Get connected nodes via semantic edges
      const connectedEdges = this.getConnectedEdges(anchor.id, 'semantic');
      
      for (const edge of connectedEdges) {
        const targetNode = this.graph.nodes.get(edge.targetId);
        if (targetNode && targetNode.type === 'amount') {
          const amount = targetNode.value as number;
          const path = [`${anchor.value} → (semantic, weight: ${edge.weight.toFixed(2)}) → amount: ${amount}`];
          const score = edge.weight;
          
          candidates.push({ amount, path, score, node: targetNode });
          console.log('[AmountResolver] Found candidate via semantic edge:', amount, 'score:', score);
        }
      }
      
      // Also check spatial edges for nearby amounts
      const spatialEdges = this.getConnectedEdges(anchor.id, 'spatial');
      for (const edge of spatialEdges) {
        const targetNode = this.graph.nodes.get(edge.targetId);
        if (targetNode && targetNode.type === 'amount') {
          const amount = targetNode.value as number;
          const path = [`${anchor.value} → (spatial, weight: ${edge.weight.toFixed(2)}) → amount: ${amount}`];
          const score = edge.weight * 0.7; // Spatial edges have lower priority
          
          // Avoid duplicates
          if (!candidates.some(c => c.amount === amount)) {
            candidates.push({ amount, path, score, node: targetNode });
            console.log('[AmountResolver] Found candidate via spatial edge:', amount, 'score:', score);
          }
        }
      }
    }
    
    return candidates;
  }

  /**
   * Get edges connected to a node by type
   */
  private getConnectedEdges(nodeId: string, edgeType: EdgeType): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const edge of this.graph.edges.values()) {
      if (edge.sourceId === nodeId && edge.type === edgeType) {
        edges.push(edge);
      }
    }
    return edges.sort((a, b) => b.weight - a.weight); // Sort by weight descending
  }

  /**
   * Apply structural validation to candidates
   */
  private validateCandidates(candidates: Array<{
    amount: number;
    path: string[];
    score: number;
    node: GraphNode;
  }>): Array<{
    amount: number;
    path: string[];
    score: number;
    node: GraphNode;
    rejected: boolean;
    rejectionReason?: string;
  }> {
    const validated = candidates.map(candidate => {
      let rejected = false;
      let rejectionReason: string | undefined;
      
      // Check for BANK/ADDRESS exclusion edges
      const exclusionEdges = this.getConnectedEdges(candidate.node.id, 'exclusion');
      if (exclusionEdges.length > 0) {
        rejected = true;
        rejectionReason = `Excluded by ${exclusionEdges.length} exclusion edges (BANK/ADDRESS context)`;
        console.log('[AmountResolver] Candidate rejected:', candidate.amount, rejectionReason);
      }
      
      // Bonus for currency symbol connection
      const currencyNodes = this.graphBuilder.getNodesByType('currency');
      const hasCurrencyNearby = currencyNodes.some(currency => {
        const distance = Math.abs(currency.position - candidate.node.position);
        return distance < 50;
      });
      
      if (hasCurrencyNearby) {
        candidate.score += 0.2;
        candidate.path.push(`Currency symbol nearby (+0.2)`);
      }
      
      // Penalty for unit price range
      if (candidate.amount < 1.0) {
        candidate.score -= 0.5;
        candidate.path.push(`Unit price range penalty (-0.5)`);
      }
      
      // Bonus for larger amounts (more likely to be totals)
      if (candidate.amount > 100.0) {
        candidate.score += 0.1;
        candidate.path.push(`Large amount bonus (+0.1)`);
      }
      
      return { ...candidate, rejected, rejectionReason };
    });
    
    return validated.filter(c => !c.rejected);
  }

  /**
   * Select best candidate with deterministic scoring
   */
  private selectBestCandidate(candidates: Array<{
    amount: number;
    path: string[];
    score: number;
    node: GraphNode;
    rejected?: boolean;
    rejectionReason?: string;
  }>): {
    amount: number;
    confidence: number;
    path: string[];
    explanation: string;
    rejected: Array<{ amount: number; reason: string }>;
  } | null {
    if (candidates.length === 0) {
      return null;
    }
    
    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    
    const best = candidates[0];
    const rejected = candidates.slice(1).map(c => ({
      amount: c.amount,
      reason: `Lower score (${c.score.toFixed(2)}) vs best (${best.score.toFixed(2)})`
    }));
    
    // Build explanation
    const explanation = `Selected amount ${best.amount} with score ${best.score.toFixed(2)}. Path: ${best.path.join(' → ')}`;
    
    // Normalize confidence from score (0-1) to percentage
    const confidence = Math.min(0.95, Math.max(0.3, best.score));
    
    return {
      amount: best.amount,
      confidence,
      path: best.path,
      explanation,
      rejected
    };
  }

  /**
   * Fallback resolution when no PRIMARY anchors found
   */
  private fallbackResolution(): AmountResolution {
    console.log('[AmountResolver] Using fallback resolution');
    
    const amountNodes = this.graphBuilder.getNodesByType('amount');
    
    if (amountNodes.length === 0) {
      return {
        amount: null,
        confidence: 0,
        path: [],
        explanation: 'No amount candidates found',
        rejectedCandidates: []
      };
    }
    
    // Prefer amounts with currency nearby
    const currencyNodes = this.graphBuilder.getNodesByType('currency');
    
    const scoredAmounts = amountNodes.map(node => {
      let score = 0.5;
      
      // Check for currency nearby
      const hasCurrency = currencyNodes.some(currency => {
        const distance = Math.abs(currency.position - node.position);
        return distance < 50;
      });
      
      if (hasCurrency) score += 0.3;
      
      // Bonus for being near end of document
      // (We don't have text length here, so skip)
      
      // Penalty for unit price range
      if (node.value as number < 1.0) score -= 0.3;
      
      // Bonus for larger amounts
      if (node.value as number > 100.0) score += 0.1;
      
      return { node, score };
    });
    
    // Sort by score and pick best
    scoredAmounts.sort((a, b) => b.score - a.score);
    
    const best = scoredAmounts[0];
    const amount = best.node.value as number;
    
    return {
      amount,
      confidence: Math.min(0.5, best.score),
      path: [`Fallback: highest scored amount (${best.score.toFixed(2)})`],
      explanation: `Fallback resolution: selected amount ${amount} with score ${best.score.toFixed(2)}`,
      rejectedCandidates: scoredAmounts.slice(1).map(s => ({
        amount: s.node.value as number,
        reason: `Lower score (${s.score.toFixed(2)})`
      }))
    };
  }

  /**
   * Get graph for debugging
   */
  getGraph(): CandidateGraph {
    return this.graph;
  }
}
