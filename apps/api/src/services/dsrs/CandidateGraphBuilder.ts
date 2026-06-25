/**
 * DSRS v2 - Candidate Graph Builder
 * 
 * Transforms raw invoice text into a unified graph representation
 * where nodes represent entities (amounts, quantities, keywords, SKUs)
 * and edges represent relationships (spatial, semantic, structural)
 */

export type NodeType = 'amount' | 'quantity' | 'keyword' | 'sku' | 'currency' | 'noise' | 'unknown';

export type EdgeType = 'spatial' | 'semantic' | 'structural' | 'exclusion';

export interface GraphNode {
  id: string;
  type: NodeType;
  value: string | number;
  position: number;
  context: string;
  contextStart: number;
  contextEnd: number;
  ocrConfidence?: number;
  metadata: {
    isCurrency?: boolean;
    isKeyword?: boolean;
    isSKU?: boolean;
    isTotalKeyword?: boolean;
    isBankKeyword?: boolean;
    isShippingKeyword?: boolean;
  };
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;
  justification: string;
}

export interface CandidateGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  adjacencyList: Map<string, Set<string>>;
}

export class CandidateGraphBuilder {
  private graph: CandidateGraph;
  private nodeIdCounter: number;
  private edgeIdCounter: number;

  constructor() {
    this.graph = {
      nodes: new Map(),
      edges: new Map(),
      adjacencyList: new Map()
    };
    this.nodeIdCounter = 0;
    this.edgeIdCounter = 0;
  }

  /**
   * Build candidate graph from raw invoice text
   */
  build(text: string): CandidateGraph {
    console.log('[CandidateGraphBuilder] Building graph from text, length:', text.length);
    
    // Extract all entities from text
    this.extractNumericNodes(text);
    this.extractKeywordNodes(text);
    this.extractCurrencyNodes(text);
    this.extractSKUNodes(text);
    
    // Build edges between nodes
    this.buildSpatialEdges(text);
    this.buildSemanticEdges();
    this.buildStructuralEdges();
    this.buildExclusionEdges();
    
    console.log('[CandidateGraphBuilder] Graph built:', {
      nodes: this.graph.nodes.size,
      edges: this.graph.edges.size
    });
    
    return this.graph;
  }

  /**
   * Extract numeric nodes (amounts and quantities)
   */
  private extractNumericNodes(text: string): void {
    const amountPattern = /([0-9,]+\.[0-9]{2,3})/g;
    const integerPattern = /\b(\d{3,5})\b/g;
    
    let match;
    while ((match = amountPattern.exec(text)) !== null) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (value > 0 && value < 10000000) {
        const start = Math.max(0, match.index - 50);
        const end = Math.min(text.length, match.index + 50);
        const context = text.substring(start, end);
        
        this.addNode({
          type: 'amount',
          value,
          position: match.index,
          context,
          contextStart: start,
          contextEnd: end,
          metadata: {}
        });
      }
    }
    
    while ((match = integerPattern.exec(text)) !== null) {
      const value = parseInt(match[1]);
      if (value > 0 && value < 100000) {
        const start = Math.max(0, match.index - 30);
        const end = Math.min(text.length, match.index + 30);
        const context = text.substring(start, end);
        
        this.addNode({
          type: 'quantity',
          value,
          position: match.index,
          context,
          contextStart: start,
          contextEnd: end,
          metadata: {}
        });
      }
    }
  }

  /**
   * Extract keyword nodes (TOTAL, BANK, SHIPPING, etc.)
   */
  private extractKeywordNodes(text: string): void {
    const keywords = [
      { pattern: /TOTAL/i, isTotal: true },
      { pattern: /GRAND TOTAL/i, isTotal: true },
      { pattern: /AMOUNT DUE/i, isTotal: true },
      { pattern: /SAY TOTAL/i, isTotal: true },
      { pattern: /SUBTOTAL/i, isTotal: false },
      { pattern: /BANK/i, isBank: true },
      { pattern: /ADDRESS/i, isBank: true },
      { pattern: /SWIFT/i, isBank: true },
      { pattern: /ACCOUNT/i, isBank: true },
      { pattern: /SHIPPING/i, isShipping: true },
      { pattern: /FREIGHT/i, isShipping: true },
      { pattern: /POSTAGE/i, isShipping: true },
      { pattern: /QTY/i, isKeyword: true },
      { pattern: /PCS/i, isKeyword: true },
      { pattern: /UNIT/i, isKeyword: true },
      { pattern: /PRICE/i, isKeyword: true },
      { pattern: /EACH/i, isKeyword: true },
    ];
    
    for (const { pattern, isTotal, isBank, isShipping, isKeyword } of keywords) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const start = Math.max(0, match.index - 30);
        const end = Math.min(text.length, match.index + 30);
        const context = text.substring(start, end);
        
        this.addNode({
          type: 'keyword',
          value: match[0].toUpperCase(),
          position: match.index,
          context,
          contextStart: start,
          contextEnd: end,
          metadata: {
            isKeyword: true,
            isTotalKeyword: isTotal,
            isBankKeyword: isBank,
            isShippingKeyword: isShipping
          }
        });
      }
    }
  }

  /**
   * Extract currency nodes ($, USD, EUR, etc.)
   */
  private extractCurrencyNodes(text: string): void {
    const currencyPatterns = [/\$/, /USD/i, /EUR/i, /HKD/i, /IDR/i, /PHP/i, /JPY/i];
    
    for (const pattern of currencyPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const start = Math.max(0, match.index - 20);
        const end = Math.min(text.length, match.index + 20);
        const context = text.substring(start, end);
        
        this.addNode({
          type: 'currency',
          value: match[0].toUpperCase(),
          position: match.index,
          context,
          contextStart: start,
          contextEnd: end,
          metadata: { isCurrency: true }
        });
      }
    }
  }

  /**
   * Extract SKU nodes (item codes like 23PTGB3)
   */
  private extractSKUNodes(text: string): void {
    const skuPattern = /\b\d{2}[A-Z]{2,4}\d{1,2}\b/g;
    
    let match;
    while ((match = skuPattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + 30);
      const context = text.substring(start, end);
      
      this.addNode({
        type: 'sku',
        value: match[0],
        position: match.index,
        context,
        contextStart: start,
        contextEnd: end,
        metadata: { isSKU: true }
      });
    }
  }

  /**
   * Add node to graph
   */
  private addNode(node: Omit<GraphNode, 'id'>): GraphNode {
    const id = `node_${this.nodeIdCounter++}`;
    const graphNode: GraphNode = { id, ...node };
    this.graph.nodes.set(id, graphNode);
    this.graph.adjacencyList.set(id, new Set());
    return graphNode;
  }

  /**
   * Build spatial edges (nodes near each other in text)
   */
  private buildSpatialEdges(text: string): void {
    const nodes = Array.from(this.graph.nodes.values());
    const proximityThreshold = 100; // characters
    
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const distance = Math.abs(nodes[i].position - nodes[j].position);
        
        if (distance < proximityThreshold) {
          const weight = 1 - (distance / proximityThreshold);
          this.addEdge({
            sourceId: nodes[i].id,
            targetId: nodes[j].id,
            type: 'spatial',
            weight,
            justification: `Spatial proximity: ${distance} chars apart`
          });
        }
      }
    }
  }

  /**
   * Build semantic edges (keyword → related entities)
   */
  private buildSemanticEdges(): void {
    const nodes = Array.from(this.graph.nodes.values());
    
    for (const node of nodes) {
      if (node.type === 'keyword' && node.metadata.isTotalKeyword) {
        // Connect TOTAL keywords to nearby amounts
        for (const otherNode of nodes) {
          if (otherNode.type === 'amount') {
            const distance = Math.abs(node.position - otherNode.position);
            if (distance < 200) {
              const weight = 0.9 - (distance / 2000);
              this.addEdge({
                sourceId: node.id,
                targetId: otherNode.id,
                type: 'semantic',
                weight,
                justification: `TOTAL keyword near amount`
              });
            }
          }
        }
      }
      
      if (node.type === 'keyword' && node.metadata.isBankKeyword) {
        // Connect BANK keywords to nearby amounts (for exclusion)
        for (const otherNode of nodes) {
          if (otherNode.type === 'amount') {
            const distance = Math.abs(node.position - otherNode.position);
            if (distance < 200) {
              this.addEdge({
                sourceId: node.id,
                targetId: otherNode.id,
                type: 'exclusion',
                weight: 0.95,
                justification: `Bank context - likely noise`
              });
            }
          }
        }
      }
    }
  }

  /**
   * Build structural edges (SKU → line item components)
   */
  private buildStructuralEdges(): void {
    const nodes = Array.from(this.graph.nodes.values());
    
    for (const node of nodes) {
      if (node.type === 'sku') {
        // Connect SKU to nearby quantities and amounts
        for (const otherNode of nodes) {
          if (otherNode.type === 'quantity' || otherNode.type === 'amount') {
            const distance = Math.abs(node.position - otherNode.position);
            if (distance < 150) {
              const weight = 0.8 - (distance / 1500);
              this.addEdge({
                sourceId: node.id,
                targetId: otherNode.id,
                type: 'structural',
                weight,
                justification: `SKU in line item row`
              });
            }
          }
        }
      }
    }
  }

  /**
   * Build exclusion edges (noise zones)
   */
  private buildExclusionEdges(): void {
    const nodes = Array.from(this.graph.nodes.values());
    
    for (const node of nodes) {
      if (node.type === 'keyword' && node.metadata.isShippingKeyword) {
        // Connect SHIPPING to nearby amounts
        for (const otherNode of nodes) {
          if (otherNode.type === 'amount') {
            const distance = Math.abs(node.position - otherNode.position);
            if (distance < 150) {
              this.addEdge({
                sourceId: node.id,
                targetId: otherNode.id,
                type: 'exclusion',
                weight: 0.7,
                justification: `Shipping context - likely not invoice total`
              });
            }
          }
        }
      }
    }
  }

  /**
   * Add edge to graph
   */
  private addEdge(edge: Omit<GraphEdge, 'id'>): GraphEdge {
    const id = `edge_${this.edgeIdCounter++}`;
    const graphEdge: GraphEdge = { id, ...edge };
    this.graph.edges.set(id, graphEdge);
    
    // Update adjacency list
    if (!this.graph.adjacencyList.has(edge.sourceId)) {
      this.graph.adjacencyList.set(edge.sourceId, new Set());
    }
    this.graph.adjacencyList.get(edge.sourceId)!.add(edge.targetId);
    
    return graphEdge;
  }

  /**
   * Get graph for debugging
   */
  getGraph(): CandidateGraph {
    return this.graph;
  }

  /**
   * Get nodes by type
   */
  getNodesByType(type: NodeType): GraphNode[] {
    return Array.from(this.graph.nodes.values()).filter(n => n.type === type);
  }

  /**
   * Get edges by type
   */
  getEdgesByType(type: EdgeType): GraphEdge[] {
    return Array.from(this.graph.edges.values()).filter(e => e.type === type);
  }
}
