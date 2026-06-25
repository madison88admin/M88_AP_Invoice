/**
 * DSRS v2 - Graph Pruner
 * 
 * Applies pruning rules to reduce graph noise and prevent overconnected graphs
 * Hard pruning: removes nodes/edges in noise zones
 * Soft pruning: reduces edge weights based on confidence and context
 */

import { CandidateGraph, GraphNode, GraphEdge, NodeType, EdgeType } from './CandidateGraphBuilder';

export interface PruningConfig {
  maxDistance: number; // Maximum token distance for edge retention
  minConfidence: number; // Minimum OCR confidence threshold
  hardPruneBankSection: boolean;
  hardPruneAddressSection: boolean;
  hardPruneSwiftBlock: boolean;
  softPruneTableWithoutCurrency: boolean;
  softPruneLongNumericSequences: boolean;
}

export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  maxDistance: 30, // 30 words/tokens
  minConfidence: 0.5,
  hardPruneBankSection: true,
  hardPruneAddressSection: true,
  hardPruneSwiftBlock: true,
  softPruneTableWithoutCurrency: true,
  softPruneLongNumericSequences: true
};

export class GraphPruner {
  private config: PruningConfig;

  constructor(config: PruningConfig = DEFAULT_PRUNING_CONFIG) {
    this.config = config;
  }

  /**
   * Apply all pruning rules to the graph
   */
  prune(graph: CandidateGraph): CandidateGraph {
    console.log('[GraphPruner] Starting graph pruning');
    const initialNodes = graph.nodes.size;
    const initialEdges = graph.edges.size;
    
    // Phase 1: Hard pruning (remove nodes/edges)
    this.hardPruneNoiseZones(graph);
    this.hardPruneLongDistanceEdges(graph);
    
    // Phase 2: Soft pruning (reduce weights)
    this.softPruneLowConfidence(graph);
    this.softPruneTableWithoutCurrency(graph);
    this.softPruneLongNumericSequences(graph);
    
    const finalNodes = graph.nodes.size;
    const finalEdges = graph.edges.size;
    
    console.log('[GraphPruner] Pruning complete:', {
      nodesRemoved: initialNodes - finalNodes,
      edgesRemoved: initialEdges - finalEdges,
      nodesRemaining: finalNodes,
      edgesRemaining: finalEdges
    });
    
    return graph;
  }

  /**
   * Hard prune: Remove nodes in noise zones (BANK, ADDRESS, SWIFT, ACCOUNT)
   */
  private hardPruneNoiseZones(graph: CandidateGraph): void {
    if (!this.config.hardPruneBankSection && 
        !this.config.hardPruneAddressSection && 
        !this.config.hardPruneSwiftBlock) {
      return;
    }
    
    const nodesToRemove: string[] = [];
    
    for (const [nodeId, node] of graph.nodes.entries()) {
      const context = node.context.toUpperCase();
      
      // Check if node is in BANK section
      if (this.config.hardPruneBankSection) {
        if (context.includes('BANK') || context.includes('SWIFT') || context.includes('ACCOUNT')) {
          nodesToRemove.push(nodeId);
          continue;
        }
      }
      
      // Check if node is in ADDRESS section
      if (this.config.hardPruneAddressSection) {
        if (context.includes('ADDRESS') || context.includes('STREET') || context.includes('CITY')) {
          nodesToRemove.push(nodeId);
          continue;
        }
      }
      
      // Check if node is in SWIFT block
      if (this.config.hardPruneSwiftBlock) {
        if (context.includes('SWIFT') || context.includes('IBAN') || context.includes('BIC')) {
          nodesToRemove.push(nodeId);
          continue;
        }
      }
    }
    
    // Remove nodes and their edges
    for (const nodeId of nodesToRemove) {
      this.removeNode(graph, nodeId);
    }
    
    if (nodesToRemove.length > 0) {
      console.log(`[GraphPruner] Hard pruned ${nodesToRemove.length} nodes in noise zones`);
    }
  }

  /**
   * Hard prune: Remove edges with distance > maxDistance
   */
  private hardPruneLongDistanceEdges(graph: CandidateGraph): void {
    const edgesToRemove: string[] = [];
    
    for (const [edgeId, edge] of graph.edges.entries()) {
      const sourceNode = graph.nodes.get(edge.sourceId);
      const targetNode = graph.nodes.get(edge.targetId);
      
      if (!sourceNode || !targetNode) {
        edgesToRemove.push(edgeId);
        continue;
      }
      
      // Calculate token distance (approximate)
      const distance = Math.abs(sourceNode.position - targetNode.position);
      const tokenDistance = Math.floor(distance / 5); // Rough estimate: 5 chars per token
      
      if (tokenDistance > this.config.maxDistance) {
        edgesToRemove.push(edgeId);
      }
    }
    
    // Remove edges
    for (const edgeId of edgesToRemove) {
      this.removeEdge(graph, edgeId);
    }
    
    if (edgesToRemove.length > 0) {
      console.log(`[GraphPruner] Hard pruned ${edgesToRemove.length} long-distance edges`);
    }
  }

  /**
   * Soft prune: Reduce edge weights for low confidence nodes
   */
  private softPruneLowConfidence(graph: CandidateGraph): void {
    let weightsReduced = 0;
    
    for (const edge of graph.edges.values()) {
      const sourceNode = graph.nodes.get(edge.sourceId);
      const targetNode = graph.nodes.get(edge.targetId);
      
      if (!sourceNode || !targetNode) {
        continue;
      }
      
      // Check OCR confidence
      const sourceConfidence = sourceNode.ocrConfidence || 1.0;
      const targetConfidence = targetNode.ocrConfidence || 1.0;
      const minConfidence = Math.min(sourceConfidence, targetConfidence);
      
      if (minConfidence < this.config.minConfidence) {
        // Reduce weight proportionally
        const penalty = 1 - (minConfidence / this.config.minConfidence);
        edge.weight *= (1 - penalty);
        weightsReduced++;
      }
    }
    
    if (weightsReduced > 0) {
      console.log(`[GraphPruner] Soft pruned ${weightsReduced} edges for low confidence`);
    }
  }

  /**
   * Soft prune: Reduce edge weights for nodes in tables without currency
   */
  private softPruneTableWithoutCurrency(graph: CandidateGraph): void {
    if (!this.config.softPruneTableWithoutCurrency) {
      return;
    }
    
    let weightsReduced = 0;
    const currencyNodes = Array.from(graph.nodes.values())
      .filter(n => n.type === 'currency');
    
    for (const edge of graph.edges.values()) {
      const sourceNode = graph.nodes.get(edge.sourceId);
      const targetNode = graph.nodes.get(edge.targetId);
      
      if (!sourceNode || !targetNode) {
        continue;
      }
      
      // Check if either node is in a table (dense numeric context)
      const sourceContext = sourceNode.context;
      const targetContext = targetNode.context;
      
      const sourceNumericDensity = (sourceContext.match(/\d/g) || []).length / sourceContext.length;
      const targetNumericDensity = (targetContext.match(/\d/g) || []).length / targetContext.length;
      
      const isDenseTable = sourceNumericDensity > 0.3 || targetNumericDensity > 0.3;
      
      if (isDenseTable) {
        // Check if currency is nearby
        const hasCurrencyNearby = currencyNodes.some(currency => {
          const sourceDistance = Math.abs(currency.position - sourceNode.position);
          const targetDistance = Math.abs(currency.position - targetNode.position);
          return sourceDistance < 100 || targetDistance < 100;
        });
        
        if (!hasCurrencyNearby) {
          edge.weight *= 0.5; // Reduce weight by 50%
          weightsReduced++;
        }
      }
    }
    
    if (weightsReduced > 0) {
      console.log(`[GraphPruner] Soft pruned ${weightsReduced} edges in tables without currency`);
    }
  }

  /**
   * Soft prune: Reduce edge weights for nodes in long numeric sequences
   */
  private softPruneLongNumericSequences(graph: CandidateGraph): void {
    if (!this.config.softPruneLongNumericSequences) {
      return;
    }
    
    let weightsReduced = 0;
    
    for (const edge of graph.edges.values()) {
      const sourceNode = graph.nodes.get(edge.sourceId);
      const targetNode = graph.nodes.get(edge.targetId);
      
      if (!sourceNode || !targetNode) {
        continue;
      }
      
      // Check if context has long numeric sequences
      const sourceNumbers = (sourceNode.context.match(/\d+/g) || []).length;
      const targetNumbers = (targetNode.context.match(/\d+/g) || []).length;
      
      const isLongSequence = sourceNumbers > 5 || targetNumbers > 5;
      
      if (isLongSequence) {
        edge.weight *= 0.7; // Reduce weight by 30%
        weightsReduced++;
      }
    }
    
    if (weightsReduced > 0) {
      console.log(`[GraphPruner] Soft pruned ${weightsReduced} edges in long numeric sequences`);
    }
  }

  /**
   * Remove node and all connected edges
   */
  private removeNode(graph: CandidateGraph, nodeId: string): void {
    // Remove all edges connected to this node
    const edgesToRemove: string[] = [];
    for (const [edgeId, edge] of graph.edges.entries()) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        edgesToRemove.push(edgeId);
      }
    }
    
    for (const edgeId of edgesToRemove) {
      this.removeEdge(graph, edgeId);
    }
    
    // Remove node
    graph.nodes.delete(nodeId);
    graph.adjacencyList.delete(nodeId);
  }

  /**
   * Remove edge from graph
   */
  private removeEdge(graph: CandidateGraph, edgeId: string): void {
    const edge = graph.edges.get(edgeId);
    if (!edge) {
      return;
    }
    
    graph.edges.delete(edgeId);
    
    // Update adjacency list
    const sourceNeighbors = graph.adjacencyList.get(edge.sourceId);
    if (sourceNeighbors) {
      sourceNeighbors.delete(edge.targetId);
    }
  }

  /**
   * Update pruning configuration
   */
  updateConfig(config: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): PruningConfig {
    return { ...this.config };
  }
}
