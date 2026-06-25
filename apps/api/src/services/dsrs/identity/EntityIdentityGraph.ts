/**
 * DSRS v5 - Entity Identity Graph
 * 
 * Supply chain graph with entity nodes and edges
 * Treats vendor as a node in a supply chain graph, not just a string
 */

export type EntityType =
  | "INVOICE_VENDOR"
  | "PO_VENDOR"
  | "SHIPPER"
  | "BILL_TO"
  | "MANUFACTURER"
  | "INTERMEDIARY"
  | "CONSIGNEE"
  | "NOTIFIED_PARTY";

export type EntityEdge =
  | "ALIASED_AS"
  | "SUBCONTRACTED_BY"
  | "CONSOLIDATED_INVOICE"
  | "SHARED_BANK"
  | "SHARED_ADDRESS"
  | "SAME_LEGAL_ENTITY"
  | "PARTNERSHIP"
  | "SUPPLY_CHAIN_LINK";

export interface EntityAttributes {
  country?: string;
  bank?: string;
  address?: string;
  taxId?: string;
  registrationNumber?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface EntityEdgeData {
  type: EntityEdge;
  targetId: string;
  confidence: number;
  evidence?: string[];
  timestamp?: Date;
}

export interface EntityNode {
  id: string;
  name: string;
  type: EntityType;
  confidence: number;
  attributes: EntityAttributes;
  links: EntityEdgeData[];
  source: string; // Where this entity came from (invoice, PO, database, etc.)
  extractedAt: Date;
}

export interface EntityGraph {
  nodes: Map<string, EntityNode>;
  edges: Map<string, EntityEdgeData[]>;
  lastUpdated: Date;
}

export class EntityIdentityGraph {
  private graph: EntityGraph;

  constructor() {
    this.graph = {
      nodes: new Map(),
      edges: new Map(),
      lastUpdated: new Date()
    };
  }

  /**
   * Add entity node to graph
   */
  addEntity(entity: EntityNode): void {
    console.log(`[EntityIdentityGraph] Adding entity: ${entity.name} (${entity.type})`);
    this.graph.nodes.set(entity.id, entity);
    this.graph.lastUpdated = new Date();
  }

  /**
   * Get entity by ID
   */
  getEntity(id: string): EntityNode | undefined {
    return this.graph.nodes.get(id);
  }

  /**
   * Get entities by type
   */
  getEntitiesByType(type: EntityType): EntityNode[] {
    return Array.from(this.graph.nodes.values()).filter(entity => entity.type === type);
  }

  /**
   * Get entities by name (fuzzy match)
   */
  getEntitiesByName(name: string, threshold: number = 0.8): EntityNode[] {
    const upperName = name.toUpperCase();
    return Array.from(this.graph.nodes.values()).filter(entity => {
      const upperEntityName = entity.name.toUpperCase();
      const similarity = this.calculateNameSimilarity(upperName, upperEntityName);
      return similarity >= threshold;
    });
  }

  /**
   * Add edge between entities
   */
  addEdge(sourceId: string, edge: EntityEdgeData): void {
    if (!this.graph.edges.has(sourceId)) {
      this.graph.edges.set(sourceId, []);
    }
    
    this.graph.edges.get(sourceId)!.push(edge);
    this.graph.lastUpdated = new Date();
    
    console.log(`[EntityIdentityGraph] Added edge: ${sourceId} → ${edge.targetId} (${edge.type})`);
  }

  /**
   * Get edges for an entity
   */
  getEdges(entityId: string): EntityEdgeData[] {
    return this.graph.edges.get(entityId) || [];
  }

  /**
   * Get edges by type
   */
  getEdgesByType(entityId: string, edgeType: EntityEdge): EntityEdgeData[] {
    const edges = this.getEdges(entityId);
    return edges.filter(edge => edge.type === edgeType);
  }

  /**
   * Find connected entities
   */
  getConnectedEntities(entityId: string, maxDepth: number = 2): Set<string> {
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [{ id: entityId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (depth >= maxDepth || visited.has(id)) continue;

      visited.add(id);

      const edges = this.getEdges(id);
      for (const edge of edges) {
        if (!visited.has(edge.targetId)) {
          queue.push({ id: edge.targetId, depth: depth + 1 });
        }
      }
    }

    visited.delete(entityId); // Remove the starting entity
    return visited;
  }

  /**
   * Calculate name similarity (Levenshtein distance based)
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    if (name1 === name2) return 1.0;

    const len1 = name1.length;
    const len2 = name2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = name1[i - 1] === name2[j - 1] ? 0 : 1;
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
   * Find potential aliases (entities with similar names)
   */
  findPotentialAliases(entityId: string, threshold: number = 0.7): EntityNode[] {
    const entity = this.getEntity(entityId);
    if (!entity) return [];

    const similarEntities = this.getEntitiesByName(entity.name, threshold);
    return similarEntities.filter(e => e.id !== entityId);
  }

  /**
   * Detect entity relationships based on shared attributes
   */
  detectSharedAttributeRelationships(): void {
    const entities = Array.from(this.graph.nodes.values());

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const entity1 = entities[i];
        const entity2 = entities[j];

        // Check for shared bank
        if (entity1.attributes.bank && entity2.attributes.bank) {
          if (entity1.attributes.bank === entity2.attributes.bank) {
            this.addEdge(entity1.id, {
              type: "SHARED_BANK",
              targetId: entity2.id,
              confidence: 0.8,
              evidence: ["Shared bank account"],
              timestamp: new Date()
            });
          }
        }

        // Check for shared address
        if (entity1.attributes.address && entity2.attributes.address) {
          const addressSimilarity = this.calculateNameSimilarity(
            entity1.attributes.address,
            entity2.attributes.address
          );
          if (addressSimilarity > 0.8) {
            this.addEdge(entity1.id, {
              type: "SHARED_ADDRESS",
              targetId: entity2.id,
              confidence: addressSimilarity,
              evidence: ["Similar address"],
              timestamp: new Date()
            });
          }
        }

        // Check for same country
        if (entity1.attributes.country && entity2.attributes.country) {
          if (entity1.attributes.country === entity2.attributes.country) {
            // Low confidence edge for same country
            if (!this.getEdgesByType(entity1.id, "PARTNERSHIP").some(e => e.targetId === entity2.id)) {
              this.addEdge(entity1.id, {
                type: "PARTNERSHIP",
                targetId: entity2.id,
                confidence: 0.3,
                evidence: ["Same country"],
                timestamp: new Date()
              });
            }
          }
        }
      }
    }
  }

  /**
   * Get entity graph
   */
  getGraph(): EntityGraph {
    return {
      nodes: new Map(this.graph.nodes),
      edges: new Map(this.graph.edges),
      lastUpdated: this.graph.lastUpdated
    };
  }

  /**
   * Clear graph
   */
  clear(): void {
    this.graph.nodes.clear();
    this.graph.edges.clear();
    this.graph.lastUpdated = new Date();
  }

  /**
   * Export graph to JSON
   */
  toJSON(): any {
    const exportData: any = {
      nodes: [],
      edges: [],
      lastUpdated: this.graph.lastUpdated
    };

    for (const [id, node] of this.graph.nodes.entries()) {
      exportData.nodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        confidence: node.confidence,
        attributes: node.attributes,
        source: node.source,
        extractedAt: node.extractedAt
      });
    }

    for (const [sourceId, edges] of this.graph.edges.entries()) {
      for (const edge of edges) {
        exportData.edges.push({
          sourceId,
          targetId: edge.targetId,
          type: edge.type,
          confidence: edge.confidence,
          evidence: edge.evidence,
          timestamp: edge.timestamp
        });
      }
    }

    return exportData;
  }

  /**
   * Log graph state
   */
  logGraphState(): void {
    console.log('\n=== ENTITY IDENTITY GRAPH ===');
    console.log(`Nodes: ${this.graph.nodes.size}`);
    console.log(`Edges: ${Array.from(this.graph.edges.values()).reduce((sum, edges) => sum + edges.length, 0)}`);
    console.log(`Last Updated: ${this.graph.lastUpdated.toISOString()}`);
    
    console.log('\n--- Entities ---');
    for (const [id, entity] of this.graph.nodes.entries()) {
      console.log(`\n${id}:`);
      console.log(`  Name: ${entity.name}`);
      console.log(`  Type: ${entity.type}`);
      console.log(`  Confidence: ${entity.confidence.toFixed(3)}`);
      console.log(`  Source: ${entity.source}`);
      console.log(`  Links: ${entity.links.length}`);
    }
    
    console.log('\n--- Edges ---');
    for (const [sourceId, edges] of this.graph.edges.entries()) {
      const sourceEntity = this.graph.nodes.get(sourceId);
      console.log(`\n${sourceEntity?.name || sourceId}:`);
      
      for (const edge of edges) {
        const targetEntity = this.graph.nodes.get(edge.targetId);
        console.log(`  → ${targetEntity?.name || edge.targetId} (${edge.type}, conf: ${edge.confidence.toFixed(2)})`);
      }
    }
    
    console.log('\n=== END GRAPH ===\n');
  }
}
