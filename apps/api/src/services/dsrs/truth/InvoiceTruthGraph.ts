// ============================================================================
// DSRS v6: Invoice Truth Graph
// ============================================================================
// Concept: Build structure first, then compute truth
// Instead of: "if pattern matches → decide value"
// We do: "build graph → resolveGraph(nodes)"

export type NodeType = 
  | 'LINE_ITEM'
  | 'SUBTOTAL'
  | 'TAX'
  | 'SHIPPING'
  | 'DISCOUNT'
  | 'GRAND_TOTAL'
  | 'TOTAL_SUMMARY'
  | 'HEURISTIC_FALLBACK';

export type SourceType = 
  | 'TOTAL_LINE'
  | 'SUMMARY_BLOCK'
  | 'LINE_ITEM_RECONSTRUCTION'
  | 'SKU_ANCHOR'
  | 'CONTEXTUAL_PATTERN'
  | 'MAX_AMOUNT_FALLBACK';

export interface TruthNode {
  type: NodeType;
  value: number;
  confidence: number;
  source: SourceType;
  rawContext?: string;
  metadata?: {
    sku?: string;
    qty?: number;
    unitPrice?: number;
    lineTotal?: number;
    label?: string;
  };
}

export interface InvoiceTruthGraph {
  nodes: TruthNode[];
  lineItems: TruthNode[];
  subtotals: TruthNode[];
  taxes: TruthNode[];
  shippings: TruthNode[];
  discounts: TruthNode[];
  grandTotals: TruthNode[];
  totalSummaries: TruthNode[];
  heuristicFallbacks: TruthNode[];
}

export class InvoiceTruthGraphBuilder {
  private graph: InvoiceTruthGraph;

  constructor() {
    this.graph = {
      nodes: [],
      lineItems: [],
      subtotals: [],
      taxes: [],
      shippings: [],
      discounts: [],
      grandTotals: [],
      totalSummaries: [],
      heuristicFallbacks: []
    };
  }

  addNode(node: TruthNode): void {
    this.graph.nodes.push(node);
    
    // Categorize node
    switch (node.type) {
      case 'LINE_ITEM':
        this.graph.lineItems.push(node);
        break;
      case 'SUBTOTAL':
        this.graph.subtotals.push(node);
        break;
      case 'TAX':
        this.graph.taxes.push(node);
        break;
      case 'SHIPPING':
        this.graph.shippings.push(node);
        break;
      case 'DISCOUNT':
        this.graph.discounts.push(node);
        break;
      case 'GRAND_TOTAL':
        this.graph.grandTotals.push(node);
        break;
      case 'TOTAL_SUMMARY':
        this.graph.totalSummaries.push(node);
        break;
      case 'HEURISTIC_FALLBACK':
        this.graph.heuristicFallbacks.push(node);
        break;
    }
  }

  addLineItem(sku: string, qty: number, unitPrice: number, lineTotal: number, confidence: number, context: string): void {
    this.addNode({
      type: 'LINE_ITEM',
      value: lineTotal,
      confidence,
      source: 'SKU_ANCHOR',
      rawContext: context,
      metadata: { sku, qty, unitPrice, lineTotal }
    });
  }

  addGrandTotal(value: number, confidence: number, source: SourceType, context: string, label?: string): void {
    this.addNode({
      type: 'GRAND_TOTAL',
      value,
      confidence,
      source,
      rawContext: context,
      metadata: { label }
    });
  }

  addSubtotal(value: number, confidence: number, source: SourceType, context: string): void {
    this.addNode({
      type: 'SUBTOTAL',
      value,
      confidence,
      source,
      rawContext: context
    });
  }

  addTax(value: number, confidence: number, source: SourceType, context: string): void {
    this.addNode({
      type: 'TAX',
      value,
      confidence,
      source,
      rawContext: context
    });
  }

  addShipping(value: number, confidence: number, source: SourceType, context: string): void {
    this.addNode({
      type: 'SHIPPING',
      value,
      confidence,
      source,
      rawContext: context
    });
  }

  addDiscount(value: number, confidence: number, source: SourceType, context: string): void {
    this.addNode({
      type: 'DISCOUNT',
      value,
      confidence,
      source,
      rawContext: context
    });
  }

  addTotalSummary(value: number, confidence: number, source: SourceType, context: string): void {
    this.addNode({
      type: 'TOTAL_SUMMARY',
      value,
      confidence,
      source,
      rawContext: context
    });
  }

  addHeuristicFallback(value: number, confidence: number, source: SourceType, context: string): void {
    this.addNode({
      type: 'HEURISTIC_FALLBACK',
      value,
      confidence,
      source,
      rawContext: context
    });
  }

  getGraph(): InvoiceTruthGraph {
    return this.graph;
  }

  // Deduplicate line items based on qty + unitPrice + context
  deduplicateLineItems(): void {
    const seen = new Map<string, TruthNode>();
    const deduplicated: TruthNode[] = [];

    for (const item of this.graph.lineItems) {
      const key = `${item.metadata?.qty}_${item.metadata?.unitPrice}_${item.rawContext?.substring(0, 50)}`;
      
      if (!seen.has(key)) {
        seen.set(key, item);
        deduplicated.push(item);
      } else {
        console.log('[InvoiceTruthGraph] Deduplicating line item:', key);
      }
    }

    this.graph.lineItems = deduplicated;
    // Rebuild nodes array
    this.rebuildNodesArray();
  }

  private rebuildNodesArray(): void {
    this.graph.nodes = [
      ...this.graph.lineItems,
      ...this.graph.subtotals,
      ...this.graph.taxes,
      ...this.graph.shippings,
      ...this.graph.discounts,
      ...this.graph.grandTotals,
      ...this.graph.totalSummaries,
      ...this.graph.heuristicFallbacks
    ];
  }

  getStats(): {
    totalNodes: number;
    lineItems: number;
    grandTotals: number;
    subtotals: number;
    taxes: number;
  } {
    return {
      totalNodes: this.graph.nodes.length,
      lineItems: this.graph.lineItems.length,
      grandTotals: this.graph.grandTotals.length,
      subtotals: this.graph.subtotals.length,
      taxes: this.graph.taxes.length
    };
  }
}

export class InvoiceTruthResolver {
  // Trust hierarchy (v6 standard):
  // 1. GRAND TOTAL node (explicit label)
  // 2. TOTAL in summary block
  // 3. Subtotal + tax reconstruction
  // 4. Line item reconstruction
  // 5. Heuristic max fallback (last resort only)

  resolve(graph: InvoiceTruthGraph): {
    value: number | null;
    confidence: number;
    source: NodeType;
    explanation: string;
  } {
    console.log('[InvoiceTruthResolver] Resolving truth from graph');
    console.log('[InvoiceTruthResolver] Graph stats:', {
      totalNodes: graph.nodes.length,
      lineItems: graph.lineItems.length,
      grandTotals: graph.grandTotals.length,
      subtotals: graph.subtotals.length,
      taxes: graph.taxes.length
    });

    // PRIORITY 1: GRAND TOTAL node (explicit label)
    if (graph.grandTotals.length > 0) {
      // Pick highest confidence GRAND TOTAL
      const bestGrandTotal = graph.grandTotals.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );

      console.log('[InvoiceTruthResolver] Selected GRAND TOTAL:', bestGrandTotal.value, 'confidence:', bestGrandTotal.confidence);
      return {
        value: bestGrandTotal.value,
        confidence: bestGrandTotal.confidence,
        source: 'GRAND_TOTAL',
        explanation: `GRAND TOTAL node with label "${bestGrandTotal.metadata?.label || 'TOTAL'}" (confidence: ${bestGrandTotal.confidence.toFixed(2)})`
      };
    }

    // PRIORITY 2: TOTAL in summary block
    if (graph.totalSummaries.length > 0) {
      const bestSummary = graph.totalSummaries.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );

      console.log('[InvoiceTruthResolver] Selected TOTAL SUMMARY:', bestSummary.value, 'confidence:', bestSummary.confidence);
      return {
        value: bestSummary.value,
        confidence: bestSummary.confidence,
        source: 'TOTAL_SUMMARY',
        explanation: `TOTAL in summary block (confidence: ${bestSummary.confidence.toFixed(2)})`
      };
    }

    // PRIORITY 3: Subtotal + tax reconstruction
    if (graph.subtotals.length > 0) {
      const bestSubtotal = graph.subtotals.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );

      let total = bestSubtotal.value;
      let explanation = `Subtotal ${bestSubtotal.value}`;

      // Add tax if available
      if (graph.taxes.length > 0) {
        const bestTax = graph.taxes.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        total += bestTax.value;
        explanation += ` + Tax ${bestTax.value}`;
      }

      // Add shipping if available
      if (graph.shippings.length > 0) {
        const bestShipping = graph.shippings.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        total += bestShipping.value;
        explanation += ` + Shipping ${bestShipping.value}`;
      }

      // Subtract discount if available
      if (graph.discounts.length > 0) {
        const bestDiscount = graph.discounts.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        total -= bestDiscount.value;
        explanation += ` - Discount ${bestDiscount.value}`;
      }

      const avgConfidence = (bestSubtotal.confidence + 
        (graph.taxes.length > 0 ? graph.taxes[0].confidence : 0) +
        (graph.shippings.length > 0 ? graph.shippings[0].confidence : 0)) / 
        (1 + (graph.taxes.length > 0 ? 1 : 0) + (graph.shippings.length > 0 ? 1 : 0));

      console.log('[InvoiceTruthResolver] Reconstructed from subtotal+tax:', total, 'confidence:', avgConfidence);
      return {
        value: total,
        confidence: avgConfidence * 0.9, // Slightly lower confidence for reconstruction
        source: 'SUBTOTAL',
        explanation: `${explanation} (reconstructed, confidence: ${avgConfidence.toFixed(2)})`
      };
    }

    // PRIORITY 4: Line item reconstruction
    if (graph.lineItems.length > 0) {
      const lineItemSum = graph.lineItems.reduce((sum, item) => sum + item.value, 0);
      const avgConfidence = graph.lineItems.reduce((sum, item) => sum + item.confidence, 0) / graph.lineItems.length;

      console.log('[InvoiceTruthResolver] Reconstructed from line items:', lineItemSum, 'confidence:', avgConfidence);
      return {
        value: lineItemSum,
        confidence: avgConfidence * 0.85, // Lower confidence for line item reconstruction
        source: 'LINE_ITEM',
        explanation: `Sum of ${graph.lineItems.length} line items (confidence: ${avgConfidence.toFixed(2)})`
      };
    }

    // PRIORITY 5: Heuristic max fallback (last resort only)
    if (graph.heuristicFallbacks.length > 0) {
      const bestFallback = graph.heuristicFallbacks.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );

      console.log('[InvoiceTruthResolver] Using heuristic fallback:', bestFallback.value, 'confidence:', bestFallback.confidence);
      return {
        value: bestFallback.value,
        confidence: bestFallback.confidence * 0.5, // Very low confidence for fallback
        source: 'HEURISTIC_FALLBACK',
        explanation: `Heuristic fallback - last resort (confidence: ${bestFallback.confidence.toFixed(2)})`
      };
    }

    console.log('[InvoiceTruthResolver] No nodes available to resolve');
    return {
      value: null,
      confidence: 0,
      source: 'HEURISTIC_FALLBACK',
      explanation: 'No truth nodes available in graph'
    };
  }

  // Calculate qty shipped from valid line items only
  resolveQtyShipped(graph: InvoiceTruthGraph): {
    value: number | null;
    confidence: number;
    explanation: string;
  } {
    if (graph.lineItems.length === 0) {
      return {
        value: null,
        confidence: 0,
        explanation: 'No line items available for qty calculation'
      };
    }

    // Sum qty from all line items
    const totalQty = graph.lineItems.reduce((sum, item) => sum + (item.metadata?.qty || 0), 0);
    const avgConfidence = graph.lineItems.reduce((sum, item) => sum + item.confidence, 0) / graph.lineItems.length;

    console.log('[InvoiceTruthResolver] Qty shipped from line items:', totalQty, 'from', graph.lineItems.length, 'items');

    return {
      value: totalQty,
      confidence: avgConfidence,
      explanation: `Sum of qty from ${graph.lineItems.length} valid line items`
    };
  }
}
