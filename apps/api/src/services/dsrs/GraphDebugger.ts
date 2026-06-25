/**
 * DSRS v2 - Graph Debugger
 * 
 * Provides visualization and debugging utilities for candidate graph
 * Logs full graph structure, candidate paths, edge contributions, and rejection reasons
 */

import { CandidateGraph, GraphNode, GraphEdge, NodeType, EdgeType } from './CandidateGraphBuilder';
import { AmountResolution } from './AmountResolver';

export class GraphDebugger {
  /**
   * Log full candidate graph structure
   */
  static logGraph(graph: CandidateGraph): void {
    console.log('\n=== CANDIDATE GRAPH STRUCTURE ===');
    console.log(`Total nodes: ${graph.nodes.size}`);
    console.log(`Total edges: ${graph.edges.size}`);
    
    // Log nodes by type
    console.log('\n--- NODES BY TYPE ---');
    const nodesByType = new Map<NodeType, GraphNode[]>();
    for (const node of graph.nodes.values()) {
      if (!nodesByType.has(node.type)) {
        nodesByType.set(node.type, []);
      }
      nodesByType.get(node.type)!.push(node);
    }
    
    for (const [type, nodes] of nodesByType.entries()) {
      console.log(`\n${type.toUpperCase()} (${nodes.length}):`);
      nodes.slice(0, 10).forEach(node => {
        console.log(`  - ${node.id}: ${node.value} (pos: ${node.position})`);
        if (node.metadata.isTotalKeyword) console.log(`    → PRIMARY anchor`);
        if (node.metadata.isBankKeyword) console.log(`    → BANK keyword`);
        if (node.metadata.isShippingKeyword) console.log(`    → SHIPPING keyword`);
      });
      if (nodes.length > 10) {
        console.log(`  ... and ${nodes.length - 10} more`);
      }
    }
    
    // Log edges by type
    console.log('\n--- EDGES BY TYPE ---');
    const edgesByType = new Map<EdgeType, GraphEdge[]>();
    for (const edge of graph.edges.values()) {
      if (!edgesByType.has(edge.type)) {
        edgesByType.set(edge.type, []);
      }
      edgesByType.get(edge.type)!.push(edge);
    }
    
    for (const [type, edges] of edgesByType.entries()) {
      console.log(`\n${type.toUpperCase()} (${edges.length}):`);
      edges.slice(0, 10).forEach(edge => {
        const source = graph.nodes.get(edge.sourceId);
        const target = graph.nodes.get(edge.targetId);
        console.log(`  - ${edge.id}: ${source?.value} → ${target?.value} (weight: ${edge.weight.toFixed(2)})`);
        console.log(`    → ${edge.justification}`);
      });
      if (edges.length > 10) {
        console.log(`  ... and ${edges.length - 10} more`);
      }
    }
    
    console.log('\n=== END GRAPH STRUCTURE ===\n');
  }

  /**
   * Log top 3 candidate paths with edge contributions
   */
  static logCandidatePaths(resolution: AmountResolution): void {
    console.log('\n=== CANDIDATE PATHS ===');
    console.log(`Selected amount: ${resolution.amount}`);
    console.log(`Confidence: ${(resolution.confidence * 100).toFixed(1)}%`);
    console.log(`Explanation: ${resolution.explanation}`);
    
    console.log('\n--- DECISION PATH ---');
    resolution.path.forEach((step, index) => {
      console.log(`  ${index + 1}. ${step}`);
    });
    
    console.log('\n--- REJECTED CANDIDATES ---');
    if (resolution.rejectedCandidates.length === 0) {
      console.log('  None');
    } else {
      resolution.rejectedCandidates.slice(0, 5).forEach((rejected, index) => {
        console.log(`  ${index + 1}. Amount: ${rejected.amount}`);
        console.log(`     Reason: ${rejected.reason}`);
      });
      if (resolution.rejectedCandidates.length > 5) {
        console.log(`  ... and ${resolution.rejectedCandidates.length - 5} more`);
      }
    }
    
    console.log('\n=== END CANDIDATE PATHS ===\n');
  }

  /**
   * Log edge contributions for a specific node
   */
  static logEdgeContributions(graph: CandidateGraph, nodeId: string): void {
    console.log(`\n=== EDGE CONTRIBUTIONS FOR NODE ${nodeId} ===`);
    
    const node = graph.nodes.get(nodeId);
    if (!node) {
      console.log('Node not found');
      return;
    }
    
    console.log(`Node value: ${node.value}`);
    console.log(`Node type: ${node.type}`);
    console.log(`Node position: ${node.position}`);
    
    const connectedEdges: GraphEdge[] = [];
    for (const edge of graph.edges.values()) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        connectedEdges.push(edge);
      }
    }
    
    console.log(`\nConnected edges: ${connectedEdges.length}`);
    
    // Group by edge type
    const edgesByType = new Map<EdgeType, GraphEdge[]>();
    for (const edge of connectedEdges) {
      if (!edgesByType.has(edge.type)) {
        edgesByType.set(edge.type, []);
      }
      edgesByType.get(edge.type)!.push(edge);
    }
    
    for (const [type, edges] of edgesByType.entries()) {
      console.log(`\n${type.toUpperCase()} edges (${edges.length}):`);
      edges.forEach(edge => {
        const isSource = edge.sourceId === nodeId;
        const otherId = isSource ? edge.targetId : edge.sourceId;
        const otherNode = graph.nodes.get(otherId);
        const direction = isSource ? '→' : '←';
        console.log(`  ${direction} ${otherNode?.value} (weight: ${edge.weight.toFixed(2)})`);
        console.log(`    → ${edge.justification}`);
      });
    }
    
    console.log('\n=== END EDGE CONTRIBUTIONS ===\n');
  }

  /**
   * Log why each candidate was accepted/rejected
   */
  static logCandidateValidation(graph: CandidateGraph, candidates: Array<{
    amount: number;
    node: GraphNode;
    score: number;
    rejected: boolean;
    rejectionReason?: string;
  }>): void {
    console.log('\n=== CANDIDATE VALIDATION ===');
    console.log(`Total candidates: ${candidates.length}`);
    
    const accepted = candidates.filter(c => !c.rejected);
    const rejected = candidates.filter(c => c.rejected);
    
    console.log(`\nAccepted: ${accepted.length}`);
    accepted.forEach((candidate, index) => {
      console.log(`  ${index + 1}. Amount: ${candidate.amount}`);
      console.log(`     Score: ${candidate.score.toFixed(2)}`);
      console.log(`     Node: ${candidate.node.id}`);
      console.log(`     Position: ${candidate.node.position}`);
    });
    
    console.log(`\nRejected: ${rejected.length}`);
    rejected.forEach((candidate, index) => {
      console.log(`  ${index + 1}. Amount: ${candidate.amount}`);
      console.log(`     Score: ${candidate.score.toFixed(2)}`);
      console.log(`     Reason: ${candidate.rejectionReason}`);
      console.log(`     Node: ${candidate.node.id}`);
      console.log(`     Position: ${candidate.node.position}`);
    });
    
    console.log('\n=== END CANDIDATE VALIDATION ===\n');
  }

  /**
   * Export graph as JSON for external visualization
   */
  static exportGraphJSON(graph: CandidateGraph): string {
    const exportData = {
      nodes: Array.from(graph.nodes.values()).map(node => ({
        id: node.id,
        type: node.type,
        value: node.value,
        position: node.position,
        metadata: node.metadata
      })),
      edges: Array.from(graph.edges.values()).map(edge => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.type,
        weight: edge.weight,
        justification: edge.justification
      }))
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Generate summary statistics
   */
  static generateSummary(graph: CandidateGraph): {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
    avgDegree: number;
  } {
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};
    
    for (const node of graph.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }
    
    for (const edge of graph.edges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }
    
    // Calculate average degree (number of edges per node)
    let totalDegree = 0;
    for (const [nodeId, neighbors] of graph.adjacencyList.entries()) {
      totalDegree += neighbors.size;
    }
    const avgDegree = graph.nodes.size > 0 ? totalDegree / graph.nodes.size : 0;
    
    return {
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.size,
      nodesByType,
      edgesByType,
      avgDegree
    };
  }

  /**
   * Log summary statistics
   */
  static logSummary(graph: CandidateGraph): void {
    const summary = this.generateSummary(graph);
    
    console.log('\n=== GRAPH SUMMARY ===');
    console.log(`Total nodes: ${summary.totalNodes}`);
    console.log(`Total edges: ${summary.totalEdges}`);
    console.log(`Average degree: ${summary.avgDegree.toFixed(2)}`);
    
    console.log('\nNodes by type:');
    for (const [type, count] of Object.entries(summary.nodesByType)) {
      console.log(`  ${type}: ${count}`);
    }
    
    console.log('\nEdges by type:');
    for (const [type, count] of Object.entries(summary.edgesByType)) {
      console.log(`  ${type}: ${count}`);
    }
    
    console.log('\n=== END GRAPH SUMMARY ===\n');
  }
}
