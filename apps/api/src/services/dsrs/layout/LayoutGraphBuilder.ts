/**
 * DSRS v4 - Layout Graph Builder
 * 
 * Converts raw OCR text into structured document regions
 * Foundation for layout-first extraction system
 */

export type RegionType = 'HEADER' | 'TABLE' | 'FOOTER' | 'BANK' | 'META' | 'NOTES' | 'BODY';

export interface RegionNode {
  id: string;
  type: RegionType;
  startPosition: number;
  endPosition: number;
  text: string;
  score: number;
  confidence: number;
  fields: string[]; // Expected fields in this region
  patterns: string[]; // Patterns that identify this region
}

export interface BlockNode {
  id: string;
  regionId: string;
  startPosition: number;
  endPosition: number;
  text: string;
  type: 'TEXT' | 'NUMERIC' | 'MIXED';
  alignment: 'LEFT' | 'CENTER' | 'RIGHT';
}

export interface LayoutGraph {
  regions: Map<string, RegionNode>;
  blocks: Map<string, BlockNode>;
  edges: LayoutEdge[];
}

export interface LayoutEdge {
  sourceId: string;
  targetId: string;
  type: 'CONTAINS' | 'ALIGNS' | 'PRECEDES' | 'FOLLOWS';
  weight: number;
}

export interface LayoutConfig {
  headerKeywords: string[];
  tableKeywords: string[];
  footerKeywords: string[];
  bankKeywords: string[];
  metaKeywords: string[];
  minRegionLength: number;
  maxRegionLength: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  headerKeywords: ['invoice', 'bill to', 'ship to', 'date', 'invoice no', 'vendor', 'from'],
  tableKeywords: ['sku', 'description', 'quantity', 'qty', 'unit price', 'amount', 'total'],
  footerKeywords: ['total', 'grand total', 'say total', 'amount due', 'balance due', 'subtotal'],
  bankKeywords: ['bank', 'swift', 'iban', 'account', 'routing', 'sort code'],
  metaKeywords: ['po', 'purchase order', 'reference', 'terms', 'payment'],
  minRegionLength: 50,
  maxRegionLength: 5000
};

export class LayoutGraphBuilder {
  private config: LayoutConfig;

  constructor(config: LayoutConfig = DEFAULT_LAYOUT_CONFIG) {
    this.config = config;
  }

  /**
   * Build layout graph from OCR text
   */
  build(text: string): LayoutGraph {
    console.log('[LayoutGraphBuilder] Building layout graph from text');

    const regions = this.segmentRegions(text);
    const blocks = this.extractBlocks(regions, text);
    const edges = this.buildEdges(regions, blocks);

    const graph: LayoutGraph = {
      regions: new Map(regions.map(r => [r.id, r])),
      blocks: new Map(blocks.map(b => [b.id, b])),
      edges
    };

    console.log(`[LayoutGraphBuilder] Built graph with ${regions.length} regions, ${blocks.length} blocks, ${edges.length} edges`);

    return graph;
  }

  /**
   * Segment text into regions
   */
  private segmentRegions(text: string): RegionNode[] {
    const regions: RegionNode[] = [];
    const lines = text.split('\n');
    let currentPosition = 0;
    let currentRegion: RegionNode | null = null;
    let regionText: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = currentPosition;
      currentPosition += line.length + 1; // +1 for newline

      const detectedRegion: RegionType = this.detectRegionType(line);

      if (currentRegion === null || detectedRegion !== currentRegion.type) {
        // Close current region if exists
        if (currentRegion) {
          currentRegion.endPosition = lineStart;
          currentRegion.text = regionText.join('\n');
          currentRegion.score = this.calculateRegionScore(currentRegion);
          regions.push(currentRegion);
        }

        // Start new region
        currentRegion = {
          id: `region_${regions.length}`,
          type: detectedRegion,
          startPosition: lineStart,
          endPosition: 0, // Will be set when region closes
          text: '',
          score: 0,
          confidence: 0.5,
          fields: this.getExpectedFields(detectedRegion),
          patterns: this.getRegionPatterns(detectedRegion)
        };
        regionText = [line];
      } else {
        regionText.push(line);
      }
    }

    // Close final region
    if (currentRegion) {
      currentRegion.endPosition = currentPosition;
      currentRegion.text = regionText.join('\n');
      currentRegion.score = this.calculateRegionScore(currentRegion);
      regions.push(currentRegion);
    }

    return regions;
  }

  /**
   * Detect region type from line content
   */
  private detectRegionType(line: string): RegionType {
    const upperLine = line.toUpperCase();

    // Check for HEADER
    if (this.config.headerKeywords.some(kw => upperLine.includes(kw))) {
      return 'HEADER';
    }

    // Check for TABLE
    if (this.config.tableKeywords.some(kw => upperLine.includes(kw))) {
      return 'TABLE';
    }

    // Check for FOOTER
    if (this.config.footerKeywords.some(kw => upperLine.includes(kw))) {
      return 'FOOTER';
    }

    // Check for BANK
    if (this.config.bankKeywords.some(kw => upperLine.includes(kw))) {
      return 'BANK';
    }

    // Check for META
    if (this.config.metaKeywords.some(kw => upperLine.includes(kw))) {
      return 'META';
    }

    // Default to BODY
    return 'BODY';
  }

  /**
   * Calculate region score based on pattern matching
   */
  private calculateRegionScore(region: RegionNode): number {
    const upperText = region.text.toUpperCase();
    let score = 0;

    // Count pattern matches
    for (const pattern of region.patterns) {
      if (upperText.includes(pattern)) {
        score += 0.2;
      }
    }

    // Normalize to [0, 1]
    return Math.min(1.0, score);
  }

  /**
   * Get expected fields for a region type
   */
  private getExpectedFields(regionType: RegionType): string[] {
    switch (regionType) {
      case 'HEADER':
        return ['invoice_number', 'vendor', 'invoice_date', 'bill_to', 'ship_to'];
      case 'TABLE':
        return ['sku', 'description', 'quantity', 'unit_price', 'line_amount'];
      case 'FOOTER':
        return ['amount', 'subtotal', 'total', 'tax', 'shipping'];
      case 'BANK':
        return ['account_number', 'swift', 'bank_name', 'routing_number'];
      case 'META':
        return ['po_number', 'reference', 'payment_terms', 'delivery_terms'];
      case 'NOTES':
        return ['notes', 'disclaimer'];
      case 'BODY':
        return ['description', 'notes'];
      default:
        return [];
    }
  }

  /**
   * Get patterns that identify a region type
   */
  private getRegionPatterns(regionType: RegionType): string[] {
    switch (regionType) {
      case 'HEADER':
        return this.config.headerKeywords;
      case 'TABLE':
        return this.config.tableKeywords;
      case 'FOOTER':
        return this.config.footerKeywords;
      case 'BANK':
        return this.config.bankKeywords;
      case 'META':
        return this.config.metaKeywords;
      default:
        return [];
    }
  }

  /**
   * Extract blocks from regions
   */
  private extractBlocks(regions: RegionNode[], text: string): BlockNode[] {
    const blocks: BlockNode[] = [];
    let blockId = 0;

    for (const region of regions) {
      const regionLines = region.text.split('\n');
      let blockStart = region.startPosition;

      for (const line of regionLines) {
        const block: BlockNode = {
          id: `block_${blockId++}`,
          regionId: region.id,
          startPosition: blockStart,
          endPosition: blockStart + line.length,
          text: line,
          type: this.detectBlockType(line),
          alignment: this.detectAlignment(line)
        };
        blocks.push(block);
        blockStart += line.length + 1;
      }
    }

    return blocks;
  }

  /**
   * Detect block type
   */
  private detectBlockType(line: string): 'TEXT' | 'NUMERIC' | 'MIXED' {
    const hasNumbers = /\d/.test(line);
    const hasLetters = /[a-zA-Z]/.test(line);

    if (hasNumbers && hasLetters) return 'MIXED';
    if (hasNumbers) return 'NUMERIC';
    return 'TEXT';
  }

  /**
   * Detect text alignment
   */
  private detectAlignment(line: string): 'LEFT' | 'CENTER' | 'RIGHT' {
    const trimmed = line.trim();
    const leftPadding = line.length - line.trimLeft().length;
    const rightPadding = line.length - line.trimRight().length;

    if (leftPadding > 10 && rightPadding > 10) return 'CENTER';
    if (rightPadding > 10) return 'RIGHT';
    return 'LEFT';
  }

  /**
   * Build edges between regions and blocks
   */
  private buildEdges(regions: RegionNode[], blocks: BlockNode[]): LayoutEdge[] {
    const edges: LayoutEdge[] = [];
    let edgeId = 0;

    // Create CONTAINS edges (region → block)
    for (const region of regions) {
      for (const block of blocks) {
        if (block.regionId === region.id) {
          edges.push({
            sourceId: region.id,
            targetId: block.id,
            type: 'CONTAINS',
            weight: 1.0
          });
        }
      }
    }

    // Create PRECEDES/FOLLOWS edges between regions
    for (let i = 0; i < regions.length - 1; i++) {
      edges.push({
        sourceId: regions[i].id,
        targetId: regions[i + 1].id,
        type: 'PRECEDES',
        weight: 0.8
      });
      edges.push({
        sourceId: regions[i + 1].id,
        targetId: regions[i].id,
        type: 'FOLLOWS',
        weight: 0.8
      });
    }

    // Create ALIGNS edges between blocks in same region
    for (const region of regions) {
      const regionBlocks = blocks.filter(b => b.regionId === region.id);
      for (let i = 0; i < regionBlocks.length - 1; i++) {
        if (regionBlocks[i].alignment === regionBlocks[i + 1].alignment) {
          edges.push({
            sourceId: regionBlocks[i].id,
            targetId: regionBlocks[i + 1].id,
            type: 'ALIGNS',
            weight: 0.5
          });
        }
      }
    }

    return edges;
  }

  /**
   * Get region by position
   */
  getRegionAtPosition(graph: LayoutGraph, position: number): RegionNode | null {
    for (const region of graph.regions.values()) {
      if (position >= region.startPosition && position <= region.endPosition) {
        return region;
      }
    }
    return null;
  }

  /**
   * Get regions by type
   */
  getRegionsByType(graph: LayoutGraph, type: RegionType): RegionNode[] {
    return Array.from(graph.regions.values()).filter(r => r.type === type);
  }

  /**
   * Update layout configuration
   */
  updateConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LayoutConfig {
    return { ...this.config };
  }

  /**
   * Log layout graph structure
   */
  logLayoutGraph(graph: LayoutGraph): void {
    console.log('\n=== LAYOUT GRAPH STRUCTURE ===');
    console.log(`Regions: ${graph.regions.size}`);
    
    for (const [id, region] of graph.regions.entries()) {
      console.log(`\n${id} (${region.type}):`);
      console.log(`  Position: ${region.startPosition} - ${region.endPosition}`);
      console.log(`  Score: ${region.score.toFixed(3)}`);
      console.log(`  Expected Fields: ${region.fields.join(', ')}`);
    }
    
    console.log(`\nBlocks: ${graph.blocks.size}`);
    console.log(`Edges: ${graph.edges.length}`);
    console.log('=== END LAYOUT GRAPH ===\n');
  }
}
