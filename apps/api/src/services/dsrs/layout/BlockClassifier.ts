/**
 * DSRS v4 - Block-Level Field Classification
 * 
 * Classifies blocks by semantic type (NUMERIC_LINE, TEXT_LINE, SKU_LINE, TOTAL_LINE, ADDRESS_LINE)
 * Separates real totals from random numbers
 */

import { BlockNode } from './LayoutGraphBuilder';

export type BlockType = 'NUMERIC_LINE' | 'TEXT_LINE' | 'SKU_LINE' | 'TOTAL_LINE' | 'ADDRESS_LINE' | 'HEADER_LINE' | 'UNKNOWN';

export interface ClassifiedBlock extends BlockNode {
  semanticType: BlockType;
  confidence: number;
  likelyFields: string[]; // Fields this block likely contains
}

export interface BlockClassifierConfig {
  skuPattern: RegExp;
  totalPattern: RegExp;
  addressPattern: RegExp;
  headerPattern: RegExp;
  confidenceThreshold: number;
}

export const DEFAULT_BLOCK_CLASSIFIER_CONFIG: BlockClassifierConfig = {
  skuPattern: /^[A-Z]{2,4}\d{3,6}[A-Z]?$/i, // e.g., 23PTGB3, ABC1234
  totalPattern: /(total|grand|sum|balance|due|amount)/i,
  addressPattern: /(street|road|lane|drive|boulevard|ave|blvd|city|state|zip|postal)/i,
  headerPattern: /(invoice|bill|vendor|from|to|date|no\.|number)/i,
  confidenceThreshold: 0.6
};

export class BlockClassifier {
  private config: BlockClassifierConfig;

  constructor(config: BlockClassifierConfig = DEFAULT_BLOCK_CLASSIFIER_CONFIG) {
    this.config = config;
  }

  /**
   * Classify a block by semantic type
   */
  classifyBlock(block: BlockNode): ClassifiedBlock {
    const semanticType = this.detectSemanticType(block);
    const confidence = this.calculateConfidence(block, semanticType);
    const likelyFields = this.inferLikelyFields(semanticType);

    return {
      ...block,
      semanticType,
      confidence,
      likelyFields
    };
  }

  /**
   * Classify multiple blocks
   */
  classifyBlocks(blocks: BlockNode[]): ClassifiedBlock[] {
    return blocks.map(block => this.classifyBlock(block));
  }

  /**
   * Detect semantic type of a block
   */
  private detectSemanticType(block: BlockNode): BlockType {
    const text = block.text;
    const upperText = text.toUpperCase();

    // Check for TOTAL_LINE
    if (this.config.totalPattern.test(text)) {
      return 'TOTAL_LINE';
    }

    // Check for SKU_LINE
    if (this.config.skuPattern.test(text.trim())) {
      return 'SKU_LINE';
    }

    // Check for ADDRESS_LINE
    if (this.config.addressPattern.test(text)) {
      return 'ADDRESS_LINE';
    }

    // Check for HEADER_LINE
    if (this.config.headerPattern.test(text)) {
      return 'HEADER_LINE';
    }

    // Check for NUMERIC_LINE
    if (block.type === 'NUMERIC') {
      return 'NUMERIC_LINE';
    }

    // Check for TEXT_LINE
    if (block.type === 'TEXT') {
      return 'TEXT_LINE';
    }

    return 'UNKNOWN';
  }

  /**
   * Calculate confidence for classification
   */
  private calculateConfidence(block: BlockNode, semanticType: BlockType): number {
    let confidence = 0.5; // base confidence

    const text = block.text;
    const upperText = text.toUpperCase();

    switch (semanticType) {
      case 'TOTAL_LINE':
        if (/(grand total|amount due|balance due)/i.test(text)) confidence += 0.3;
        if (/\$\s*\d+/.test(text)) confidence += 0.2;
        break;

      case 'SKU_LINE':
        if (this.config.skuPattern.test(text.trim())) confidence += 0.4;
        if (block.type === 'MIXED') confidence += 0.1;
        break;

      case 'ADDRESS_LINE':
        if (/\d{5}(-\d{4})?/.test(text)) confidence += 0.2; // ZIP code
        if (/(street|road|lane|drive|boulevard)/i.test(text)) confidence += 0.2;
        break;

      case 'HEADER_LINE':
        if (/(invoice|vendor|from|to)/i.test(text)) confidence += 0.3;
        if (block.alignment === 'CENTER') confidence += 0.1;
        break;

      case 'NUMERIC_LINE':
        if (/\$\s*\d+/.test(text)) confidence += 0.2;
        if (/\d+\.\d{2}/.test(text)) confidence += 0.1;
        break;

      case 'TEXT_LINE':
        if (text.length > 20) confidence += 0.1;
        break;
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Infer likely fields from semantic type
   */
  private inferLikelyFields(semanticType: BlockType): string[] {
    switch (semanticType) {
      case 'TOTAL_LINE':
        return ['amount', 'subtotal', 'tax', 'shipping'];
      case 'SKU_LINE':
        return ['sku', 'description'];
      case 'ADDRESS_LINE':
        return ['bill_to', 'ship_to', 'vendor'];
      case 'HEADER_LINE':
        return ['invoice_number', 'vendor', 'invoice_date', 'bill_to', 'ship_to'];
      case 'NUMERIC_LINE':
        return ['amount', 'qty', 'unit_price', 'account_number'];
      case 'TEXT_LINE':
        return ['description', 'vendor', 'notes'];
      default:
        return [];
    }
  }

  /**
   * Filter blocks by semantic type
   */
  filterBlocksByType(blocks: ClassifiedBlock[], type: BlockType): ClassifiedBlock[] {
    return blocks.filter(block => block.semanticType === type);
  }

  /**
   * Get blocks by confidence threshold
   */
  getHighConfidenceBlocks(blocks: ClassifiedBlock[]): ClassifiedBlock[] {
    return blocks.filter(block => block.confidence >= this.config.confidenceThreshold);
  }

  /**
   * Update classifier configuration
   */
  updateConfig(config: Partial<BlockClassifierConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): BlockClassifierConfig {
    return { ...this.config };
  }

  /**
   * Log classification results
   */
  logClassificationResults(blocks: ClassifiedBlock[]): void {
    console.log('\n=== BLOCK CLASSIFICATION RESULTS ===');
    
    for (const block of blocks) {
      console.log(`\n${block.id}:`);
      console.log(`  Text: ${block.text.substring(0, 50)}...`);
      console.log(`  Semantic Type: ${block.semanticType}`);
      console.log(`  Confidence: ${block.confidence.toFixed(3)}`);
      console.log(`  Likely Fields: ${block.likelyFields.join(', ')}`);
    }
    
    console.log('\n=== END CLASSIFICATION RESULTS ===\n');
  }
}
