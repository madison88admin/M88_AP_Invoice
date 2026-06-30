// ============================================================================
// DSRS v7: Invoice Abstract Syntax Tree (AST)
// ============================================================================
// Core Idea: EVERYTHING is a node. NOTHING is a "final field" during parsing.
// Final values are resolved ONLY during root traversal.

export type FinancialNodeType =
  | 'LINE_ITEM'
  | 'GRAND_TOTAL'
  | 'SUBTOTAL'
  | 'TAX'
  | 'SHIPPING'
  | 'DISCOUNT'
  | 'ADJUSTMENT'
  | 'PROSE_CURRENCY'
  | 'QUANTITY_SUMMARY';

export type IdentityNodeType =
  | 'VENDOR'
  | 'BILL_TO'
  | 'SHIP_TO'
  | 'BANK_INFO';

export type TransactionNodeType =
  | 'QUANTITY'
  | 'UNIT_PRICE'
  | 'EXTENDED_PRICE';

export type StructuralNodeType =
  | 'TABLE_ROW'
  | 'TABLE_COLUMN'
  | 'FOOTER_BLOCK'
  | 'HEADER_BLOCK'
  | 'DOCUMENT_ROOT';

export type ASTNodeType = FinancialNodeType | IdentityNodeType | TransactionNodeType | StructuralNodeType;

export interface ASTNode {
  type: ASTNodeType;
  value?: number | string | null;
  children?: ASTNode[];
  confidence: number;
  source: string;
  context: string;
  metadata?: Record<string, any>;
  parent?: ASTNode | null;
}

export interface InvoiceAST {
  documentType: 'INVOICE';
  root: ASTNode;
  metadata: {
    vendor?: string;
    invoiceNumber?: string;
    currency?: string;
    date?: string;
    hasPer1000Pcs?: boolean;
  };
}

export class InvoiceASTBuilder {
  private root: ASTNode;
  private lineItems: ASTNode[] = [];
  private grandTotals: ASTNode[] = [];
  private subtotals: ASTNode[] = [];
  private taxes: ASTNode[] = [];
  private shippings: ASTNode[] = [];
  private discounts: ASTNode[] = [];
  private proseCurrencies: ASTNode[] = [];
  private quantitySummaries: ASTNode[] = [];
  private vendors: ASTNode[] = [];
  private billTos: ASTNode[] = [];
  private shipTos: ASTNode[] = [];
  private bankInfos: ASTNode[] = [];
  private structuralNodes: ASTNode[] = [];

  constructor() {
    this.root = {
      type: 'DOCUMENT_ROOT',
      confidence: 1.0,
      source: 'DOCUMENT_ROOT',
      context: 'root',
      children: []
    };
  }

  // Add a node as child of another node (defaults to root)
  addNode(node: ASTNode, parent: ASTNode = this.root): ASTNode {
    const nodeWithParent = { ...node, parent };
    
    if (!parent.children) {
      parent.children = [];
    }
    parent.children.push(nodeWithParent);

    // Categorize for fast lookup
    this.categorizeNode(nodeWithParent);
    return nodeWithParent;
  }

  private categorizeNode(node: ASTNode): void {
    switch (node.type) {
      case 'LINE_ITEM':
        this.lineItems.push(node);
        break;
      case 'GRAND_TOTAL':
        this.grandTotals.push(node);
        break;
      case 'SUBTOTAL':
        this.subtotals.push(node);
        break;
      case 'TAX':
        this.taxes.push(node);
        break;
      case 'SHIPPING':
        this.shippings.push(node);
        break;
      case 'DISCOUNT':
        this.discounts.push(node);
        break;
      case 'PROSE_CURRENCY':
        this.proseCurrencies.push(node);
        break;
      case 'QUANTITY_SUMMARY':
        this.quantitySummaries.push(node);
        break;
      case 'VENDOR':
        this.vendors.push(node);
        break;
      case 'BILL_TO':
        this.billTos.push(node);
        break;
      case 'SHIP_TO':
        this.shipTos.push(node);
        break;
      case 'BANK_INFO':
        this.bankInfos.push(node);
        break;
      case 'TABLE_ROW':
      case 'TABLE_COLUMN':
      case 'FOOTER_BLOCK':
      case 'HEADER_BLOCK':
      case 'DOCUMENT_ROOT':
        this.structuralNodes.push(node);
        break;
    }
  }

  // Build a line item with transaction children
  addLineItem(
    quantity: number,
    unitPrice: number,
    extendedPrice: number,
    context: string,
    sku?: string,
    confidence?: number
  ): ASTNode {
    // Calculate confidence from math validation
    const calculated = quantity * unitPrice;
    const variance = Math.abs(calculated - extendedPrice) / (extendedPrice || 1);
    const lineItemConfidence = confidence ?? (variance < 0.15 ? 0.99 : 0.70);

    const lineItem: ASTNode = {
      type: 'LINE_ITEM',
      confidence: lineItemConfidence,
      source: 'SKU_ANCHOR',
      context,
      metadata: { sku, quantity, unitPrice, extendedPrice },
      children: [
        {
          type: 'QUANTITY',
          value: quantity,
          confidence: 0.99,
          source: 'LINE_ITEM_CHILD',
          context: `${context}_qty`,
          parent: undefined
        },
        {
          type: 'UNIT_PRICE',
          value: unitPrice,
          confidence: 0.99,
          source: 'LINE_ITEM_CHILD',
          context: `${context}_unit`,
          parent: undefined
        },
        {
          type: 'EXTENDED_PRICE',
          value: extendedPrice,
          confidence: 0.99,
          source: 'LINE_ITEM_CHILD',
          context: `${context}_ext`,
          parent: undefined
        }
      ]
    };

    return this.addNode(lineItem);
  }

  addGrandTotal(value: number, context: string, label?: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'GRAND_TOTAL',
      value,
      confidence: confidence ?? 0.98,
      source: 'TOTAL_LINE',
      context,
      metadata: { label }
    };
    return this.addNode(node);
  }

  addSubtotal(value: number, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'SUBTOTAL',
      value,
      confidence: confidence ?? 0.90,
      source: 'SUBTOTAL_LINE',
      context
    };
    return this.addNode(node);
  }

  addTax(value: number, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'TAX',
      value,
      confidence: confidence ?? 0.85,
      source: 'TAX_LINE',
      context
    };
    return this.addNode(node);
  }

  addShipping(value: number, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'SHIPPING',
      value,
      confidence: confidence ?? 0.85,
      source: 'SHIPPING_LINE',
      context
    };
    return this.addNode(node);
  }

  addDiscount(value: number, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'DISCOUNT',
      value,
      confidence: confidence ?? 0.85,
      source: 'DISCOUNT_LINE',
      context
    };
    return this.addNode(node);
  }

  addQuantitySummary(value: number, context: string, label?: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'QUANTITY_SUMMARY',
      value,
      confidence: confidence ?? 0.95,
      source: 'TOTAL_QTY_LINE',
      context,
      metadata: { label }
    };
    return this.addNode(node);
  }

  addVendor(name: string, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'VENDOR',
      value: name,
      confidence: confidence ?? 0.90,
      source: 'VENDOR_BLOCK',
      context
    };
    return this.addNode(node);
  }

  addBillTo(text: string, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'BILL_TO',
      value: text,
      confidence: confidence ?? 0.85,
      source: 'BILL_TO_BLOCK',
      context
    };
    return this.addNode(node);
  }

  addShipTo(text: string, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'SHIP_TO',
      value: text,
      confidence: confidence ?? 0.85,
      source: 'SHIP_TO_BLOCK',
      context
    };
    return this.addNode(node);
  }

  addBankInfo(bankName: string, accountNumber: string | null, swiftCode: string | null, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type: 'BANK_INFO',
      value: bankName,
      confidence: confidence ?? 0.85,
      source: 'BANK_BLOCK',
      context,
      metadata: { accountNumber, swiftCode }
    };
    return this.addNode(node);
  }

  addStructuralBlock(type: StructuralNodeType, context: string, confidence?: number): ASTNode {
    const node: ASTNode = {
      type,
      confidence: confidence ?? 0.90,
      source: 'LAYOUT_SEGMENTATION',
      context,
      children: []
    };
    return this.addNode(node);
  }

  setMetadata(metadata: InvoiceAST['metadata']): void {
    this.metadata = metadata;
  }

  private metadata: InvoiceAST['metadata'] = {};

  getAST(): InvoiceAST {
    return {
      documentType: 'INVOICE',
      root: this.root,
      metadata: this.metadata
    };
  }

  getNodes(): {
    lineItems: ASTNode[];
    grandTotals: ASTNode[];
    subtotals: ASTNode[];
    taxes: ASTNode[];
    shippings: ASTNode[];
    discounts: ASTNode[];
    proseCurrencies: ASTNode[];
    quantitySummaries: ASTNode[];
    vendors: ASTNode[];
    billTos: ASTNode[];
    shipTos: ASTNode[];
    bankInfos: ASTNode[];
  } {
    return {
      lineItems: this.lineItems,
      grandTotals: this.grandTotals,
      subtotals: this.subtotals,
      taxes: this.taxes,
      shippings: this.shippings,
      discounts: this.discounts,
      proseCurrencies: this.proseCurrencies,
      quantitySummaries: this.quantitySummaries,
      vendors: this.vendors,
      billTos: this.billTos,
      shipTos: this.shipTos,
      bankInfos: this.bankInfos
    };
  }
}

export class InvoiceASTNormalizer {
  // AST Normalizer: deduplicate, link, validate structure
  normalize(ast: InvoiceAST): InvoiceAST {
    console.log('[InvoiceASTNormalizer] Starting AST normalization');
    
    // Deduplicate line items
    this.deduplicateLineItems(ast.root);
    
    // Remove total/summary rows that are not real line items
    this.removeTotalLineItems(ast.root);
    
    // Validate line item math (qty * unitPrice ≈ extendedPrice)
    this.validateLineItems(ast.root);
    
    // Link structural nodes
    this.linkStructuralNodes(ast.root);
    
    console.log('[InvoiceASTNormalizer] AST normalization complete');
    return ast;
  }

  private deduplicateLineItems(root: ASTNode): void {
    const seen = new Set<string>();
    const nodes = this.collectNodes(root, 'LINE_ITEM');
    
    for (const node of nodes) {
      const meta = node.metadata || {};
      // Use SKU + financials as deduplication key so identical line items from overlapping
      // SKU windows are merged, regardless of row index context.
      const key = `${meta.sku || 'UNKNOWN'}_${meta.quantity}_${meta.unitPrice}_${meta.extendedPrice}`;
      
      if (seen.has(key)) {
        console.log('[InvoiceASTNormalizer] Deduplicating line item:', key);
        // Mark as duplicate by lowering confidence
        node.confidence = 0.1;
      } else {
        seen.add(key);
      }
    }
  }

  private removeTotalLineItems(root: ASTNode): void {
    const nodes = this.collectNodes(root, 'LINE_ITEM');
    if (nodes.length < 2) return;

    const quantities = nodes.map(n => (n.metadata?.quantity || 0) as number);

    // Only remove a line item if its quantity equals the sum of ALL other line items.
    // This avoids false positives like removing a duplicate 75 or removing 120 because
    // 50 + 70 = 120.
    for (let i = 0; i < nodes.length; i++) {
      const target = quantities[i];
      const sumOfOthers = quantities.reduce((sum, val, idx) => idx === i ? sum : sum + val, 0);
      if (sumOfOthers > 0 && Math.abs(target - sumOfOthers) < 0.01) {
        console.log('[InvoiceASTNormalizer] Marking total line item as duplicate:', target, 'sum of others:', sumOfOthers);
        nodes[i].confidence = 0.1;
      }
    }
  }

  private validateLineItems(root: ASTNode): void {
    const nodes = this.collectNodes(root, 'LINE_ITEM');
    
    for (const node of nodes) {
      const meta = node.metadata || {};
      const calculated = (meta.quantity || 0) * (meta.unitPrice || 0);
      const variance = Math.abs(calculated - (meta.extendedPrice || 0)) / ((meta.extendedPrice || 1));
      
      if (variance > 0.20) {
        console.log('[InvoiceASTNormalizer] Line item math validation failed:', meta, 'variance:', variance);
        node.confidence *= 0.5;
      }
    }
  }

  private linkStructuralNodes(root: ASTNode): void {
    // Link line items to their nearest table row/structural context
    const lineItems = this.collectNodes(root, 'LINE_ITEM');
    const tableRows = this.collectNodes(root, 'TABLE_ROW');
    
    for (const lineItem of lineItems) {
      // Find closest table row by context similarity
      const closestRow = tableRows.find(row => row.context === lineItem.context.split('_')[0]);
      if (closestRow && !lineItem.parent) {
        this.attachToParent(lineItem, closestRow);
      }
    }
  }

  private attachToParent(node: ASTNode, parent: ASTNode): void {
    // Remove from current parent
    if (node.parent && node.parent.children) {
      node.parent.children = node.parent.children.filter(child => child !== node);
    }
    
    // Add to new parent
    node.parent = parent;
    if (!parent.children) {
      parent.children = [];
    }
    parent.children.push(node);
  }

  private collectNodes(root: ASTNode, type: ASTNodeType): ASTNode[] {
    const result: ASTNode[] = [];
    const stack: ASTNode[] = [root];
    
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      
      if (node.type === type) {
        result.push(node);
      }
      
      if (node.children) {
        stack.push(...node.children);
      }
    }
    
    return result;
  }
}

export class InvoiceASTResolver {
  // AST Resolver: ALL decisions happen here
  // Rule: EVERYTHING must resolve from tree traversal
  // Hard rule: if a value is not inside a structured node, it does NOT exist

  resolveAmount(ast: InvoiceAST): {
    value: number | null;
    currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null;
    confidence: number;
    source: string;
    explanation: string;
  } {
    console.log('[InvoiceASTResolver] Resolving amount from AST');

    const nodes = this.getCategorizedNodes(ast.root);
    const detectedCurrency = ast.metadata?.currency || 'USD';

    // PRIORITY 0: PROSE_CURRENCY override.
    // If the invoice text contains explicit USD settlement phrasing (e.g. "settle in USD @7.70"),
    // that prose figure is the authoritative settlement amount and takes priority over any
    // labeled total (especially when the labeled total is in a different currency like HKD).
    // This fixes invoices like Perfect China where the labeled total is HKD but the real USD
    // settlement amount is embedded in prose.
    const validProseCurrencies = nodes.proseCurrencies.filter(n => n.confidence >= 0.7);
    if (validProseCurrencies.length > 0) {
      const bestProse = validProseCurrencies.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );
      console.log('[InvoiceASTResolver] Selected PROSE_CURRENCY USD override:', bestProse.value);
      return {
        value: typeof bestProse.value === 'number' ? Math.round(bestProse.value * 100) / 100 : null,
        currency: 'USD',
        confidence: bestProse.confidence,
        source: 'PROSE_CURRENCY',
        explanation: `Prose USD settlement amount override (label: ${bestProse.metadata?.label || 'USD'})`
      };
    }

    // PRIORITY 1: GRAND_TOTAL node — now score-ranked, not just confidence-filtered.
    // The builder attaches a score to each candidate based on label strength, currency,
    // page position, and line-item-sum cross-check.
    const grandTotalNodes = nodes.grandTotals
      .filter(n => (n.confidence ?? 0) >= 0.3)
      .sort((a, b) => (b.metadata?.score ?? 0) - (a.metadata?.score ?? 0));

    if (grandTotalNodes.length > 0) {
      const bestGrandTotal = grandTotalNodes[0];

      // If scoring threshold was not met, the builder stores a null-value node.
      // Fall through to line-item sum instead of trusting low-confidence candidates.
      if (bestGrandTotal.value !== null && typeof bestGrandTotal.value === 'number') {
        const grandTotalValue = bestGrandTotal.value;

        // Sanity check: if line items sum to a much larger plausible total, the GRAND_TOTAL
        // may have picked a unit price due to layout interleaving. Prefer line item sum.
        const validLineItems = nodes.lineItems.filter(n => n.confidence >= 0.7);
        const lineItemSum = validLineItems.reduce((total, item) => {
          const extNode = this.findChildByType(item, 'EXTENDED_PRICE');
          return total + (typeof extNode?.value === 'number' ? extNode.value : 0);
        }, 0);

        if (validLineItems.length > 0 && lineItemSum > 0 && grandTotalValue > 0) {
          if (grandTotalValue < lineItemSum * 0.2) {
            console.log('[InvoiceASTResolver] GRAND_TOTAL suspiciously small:', grandTotalValue, '< 20% of line item sum:', lineItemSum, 'using LINE_ITEM_SUM');
            return {
              value: Math.round(lineItemSum * 100) / 100,
              currency: detectedCurrency as any,
              confidence: 0.75,
              source: 'LINE_ITEM_SUM',
              explanation: `Grand total ${grandTotalValue} < 20% of line item sum ${lineItemSum}; used line item sum instead`
            };
          }
          if (grandTotalValue > lineItemSum * 5) {
            console.log('[InvoiceASTResolver] GRAND_TOTAL suspiciously large:', grandTotalValue, '> 5x line item sum:', lineItemSum, 'using LINE_ITEM_SUM');
            return {
              value: Math.round(lineItemSum * 100) / 100,
              currency: detectedCurrency as any,
              confidence: 0.75,
              source: 'LINE_ITEM_SUM',
              explanation: `Grand total ${grandTotalValue} > 5x line item sum ${lineItemSum}; used line item sum instead`
            };
          }
          // Per-1000-PCS invoices (e.g., Paxar) often have a unit price that looks like a total.
          if (ast.metadata?.hasPer1000Pcs && grandTotalValue > lineItemSum * 1.5) {
            console.log('[InvoiceASTResolver] GRAND_TOTAL suspiciously large for per-1000-PCS invoice:', grandTotalValue, '> 1.5x line item sum:', lineItemSum, 'using LINE_ITEM_SUM');
            return {
              value: Math.round(lineItemSum * 100) / 100,
              currency: detectedCurrency as any,
              confidence: 0.75,
              source: 'LINE_ITEM_SUM',
              explanation: `Per-1000-PCS invoice: grand total ${grandTotalValue} > 1.5x line item sum ${lineItemSum}; used line item sum instead`
            };
          }
        }

        console.log('[InvoiceASTResolver] Selected GRAND_TOTAL:', bestGrandTotal.value, 'score:', bestGrandTotal.metadata?.score);
        return {
          value: Math.round(grandTotalValue * 100) / 100,
          currency: detectedCurrency as any,
          confidence: bestGrandTotal.confidence,
          source: 'GRAND_TOTAL',
          explanation: `Score ${bestGrandTotal.metadata?.score ?? 'N/A'} | label: ${bestGrandTotal.metadata?.label || 'TOTAL'} | page ${bestGrandTotal.metadata?.pageIndex ?? 'unknown'}`
        };
      }
    }

    // PRIORITY 2: SUM(all LINE_ITEM.extended_price)
    const validLineItems = nodes.lineItems.filter(n => n.confidence >= 0.7);
    if (validLineItems.length > 0) {
      const sum = validLineItems.reduce((total, item) => {
        const extNode = this.findChildByType(item, 'EXTENDED_PRICE');
        return total + (typeof extNode?.value === 'number' ? extNode.value : 0);
      }, 0);

      const avgConfidence = validLineItems.reduce((acc, item) => acc + item.confidence, 0) / validLineItems.length;

      console.log('[InvoiceASTResolver] Sum of line items:', sum);
      return {
        value: Math.round(sum * 100) / 100,
        currency: detectedCurrency as any,
        confidence: avgConfidence * 0.95,
        source: 'LINE_ITEM_SUM',
        explanation: `Sum of ${validLineItems.length} valid line items from AST`
      };
    }

    // PRIORITY 3: SUBTOTAL + TAX - DISCOUNT
    if (nodes.subtotals.length > 0) {
      const bestSubtotal = nodes.subtotals.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      let total = typeof bestSubtotal.value === 'number' ? bestSubtotal.value : 0;
      let explanation = `Subtotal ${total}`;

      const validTaxes = nodes.taxes.filter(n => n.confidence >= 0.7);
      if (validTaxes.length > 0) {
        const bestTax = validTaxes.reduce((best, current) =>
          current.confidence > best.confidence ? current : best
        );
        total += typeof bestTax.value === 'number' ? bestTax.value : 0;
        explanation += ` + Tax ${bestTax.value}`;
      }

      const validDiscounts = nodes.discounts.filter(n => n.confidence >= 0.7);
      if (validDiscounts.length > 0) {
        const bestDiscount = validDiscounts.reduce((best, current) =>
          current.confidence > best.confidence ? current : best
        );
        total -= typeof bestDiscount.value === 'number' ? bestDiscount.value : 0;
        explanation += ` - Discount ${bestDiscount.value}`;
      }

      console.log('[InvoiceASTResolver] Reconstructed from subtotal:', total);
      return {
        value: total,
        currency: detectedCurrency as any,
        confidence: bestSubtotal.confidence * 0.90,
        source: 'SUBTOTAL_RECONSTRUCTION',
        explanation: `${explanation} (reconstructed from AST)`
      };
    }

    // PRIORITY 4: fallback DISABLED by default
    console.log('[InvoiceASTResolver] No structured amount found in AST - fallback disabled');
    return {
      value: null,
      currency: null,
      confidence: 0,
      source: 'NO_STRUCTURED_NODE',
      explanation: 'No structured amount node found in AST; fallback disabled'
    };
  }

  resolveQty(ast: InvoiceAST): {
    value: number | null;
    confidence: number;
    explanation: string;
  } {
    console.log('[InvoiceASTResolver] Resolving qty from AST');
    
    const nodes = this.getCategorizedNodes(ast.root);
    
    // ONLY: SUM(lineItem.quantity)
    // NEVER: OCR integers, random token integers, footer numbers, PO numbers
    const validLineItems = nodes.lineItems.filter(n => n.confidence >= 0.7);
    
    if (validLineItems.length === 0) {
      // FALLBACK (still structured): explicit quantity summary lines like "TOTAL QTY : 445 PCS"
      const validSummaries = nodes.quantitySummaries.filter(n => n.confidence >= 0.7);
      if (validSummaries.length > 0) {
        // Prefer the highest-confidence summary
        const bestSummary = validSummaries.reduce((best, current) =>
          current.confidence > best.confidence ? current : best
        );
        console.log('[InvoiceASTResolver] Qty from QUANTITY_SUMMARY:', bestSummary.value);
        return {
          value: typeof bestSummary.value === 'number' ? bestSummary.value : null,
          confidence: bestSummary.confidence,
          explanation: `Quantity from explicit summary line (${bestSummary.metadata?.label || 'TOTAL_QTY'})`
        };
      }

      return {
        value: null,
        confidence: 0,
        explanation: 'No valid LINE_ITEM or QUANTITY_SUMMARY nodes found in AST'
      };
    }
    
    let totalQty = 0;
    let totalConfidence = 0;
    
    for (const item of validLineItems) {
      const qtyNode = this.findChildByType(item, 'QUANTITY');
      if (qtyNode && typeof qtyNode.value === 'number') {
        totalQty += qtyNode.value;
        totalConfidence += item.confidence;
      }
    }
    
    const avgConfidence = validLineItems.length > 0 ? totalConfidence / validLineItems.length : 0;
    
    console.log('[InvoiceASTResolver] Qty from line items:', totalQty);
    return {
      value: totalQty,
      confidence: avgConfidence,
      explanation: `Sum of qty from ${validLineItems.length} valid LINE_ITEM nodes in AST`
    };
  }

  private getCategorizedNodes(root: ASTNode): {
    lineItems: ASTNode[];
    grandTotals: ASTNode[];
    subtotals: ASTNode[];
    taxes: ASTNode[];
    discounts: ASTNode[];
    shippings: ASTNode[];
    proseCurrencies: ASTNode[];
    quantitySummaries: ASTNode[];
  } {
    const lineItems: ASTNode[] = [];
    const grandTotals: ASTNode[] = [];
    const subtotals: ASTNode[] = [];
    const taxes: ASTNode[] = [];
    const discounts: ASTNode[] = [];
    const shippings: ASTNode[] = [];
    const proseCurrencies: ASTNode[] = [];
    const quantitySummaries: ASTNode[] = [];

    const stack: ASTNode[] = [root];
    
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      
      switch (node.type) {
        case 'LINE_ITEM':
          lineItems.push(node);
          break;
        case 'GRAND_TOTAL':
          grandTotals.push(node);
          break;
        case 'SUBTOTAL':
          subtotals.push(node);
          break;
        case 'TAX':
          taxes.push(node);
          break;
        case 'DISCOUNT':
          discounts.push(node);
          break;
        case 'SHIPPING':
          shippings.push(node);
          break;
        case 'PROSE_CURRENCY':
          proseCurrencies.push(node);
          break;
        case 'QUANTITY_SUMMARY':
          quantitySummaries.push(node);
          break;
      }

      if (node.children) {
        stack.push(...node.children);
      }
    }

    return { lineItems, grandTotals, subtotals, taxes, discounts, shippings, proseCurrencies, quantitySummaries };
  }

  private findChildByType(parent: ASTNode, type: TransactionNodeType): ASTNode | undefined {
    if (!parent.children) return undefined;
    return parent.children.find(child => child.type === type);
  }
}
