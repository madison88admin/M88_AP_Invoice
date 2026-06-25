// ============================================================================
// DSRS v7.1: AST Validator + Repair Engine
// ============================================================================
// Concept: Treat AST as a partially corrupted program that must be validated,
// diagnosed, and repaired before execution.

import { InvoiceAST, ASTNode, ASTNodeType, TransactionNodeType } from './InvoiceAST';

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type ValidationRule = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

export interface ValidationIssue {
  rule: ValidationRule;
  severity: ValidationSeverity;
  message: string;
  node?: ASTNode;
  context?: string;
  recommendation: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface RepairAction {
  type: 'PRUNE' | 'RELINK' | 'RECONCILE' | 'RECALIBRATE';
  description: string;
  node?: ASTNode;
  before?: any;
  after?: any;
  confidenceDelta?: number;
}

export interface RepairReport {
  actions: RepairAction[];
  nodesRemoved: number;
  nodesRelinked: number;
  nodesReconciled: number;
  confidenceRecalibrated: number;
}

// ============================================================================
// AST VALIDATOR
// ============================================================================
export class InvoiceASTValidator {
  private readonly ARITHMETIC_TOLERANCE = 0.15; // 15%
  private readonly TOTAL_TOLERANCE = 0.05; // 5%
  private readonly MAX_UNIT_PRICE = 10000; // suspicious threshold
  private readonly MAX_QUANTITY = 100000; // suspicious threshold

  validate(ast: InvoiceAST): ValidationReport {
    console.log('[InvoiceASTValidator] Starting AST validation');
    const issues: ValidationIssue[] = [];

    // Structural integrity rules
    issues.push(...this.validateLineItemCompleteness(ast));
    issues.push(...this.validateFooterUniqueness(ast));
    issues.push(...this.validateOrphanNodes(ast));

    // Financial consistency rules
    issues.push(...this.validateArithmeticConsistency(ast));
    issues.push(...this.validateTotalReconciliation(ast));
    issues.push(...this.validateImpossibleValues(ast));

    const errorCount = issues.filter(i => i.severity === 'ERROR').length;
    const warningCount = issues.filter(i => i.severity === 'WARNING').length;
    const infoCount = issues.filter(i => i.severity === 'INFO').length;

    const report = {
      valid: errorCount === 0,
      issues,
      errorCount,
      warningCount,
      infoCount
    };

    console.log('[InvoiceASTValidator] Validation complete:', {
      valid: report.valid,
      errors: errorCount,
      warnings: warningCount,
      info: infoCount
    });

    return report;
  }

  // Rule V1: LINE_ITEM completeness
  private validateLineItemCompleteness(ast: InvoiceAST): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lineItems = this.collectNodes(ast.root, 'LINE_ITEM');

    for (const item of lineItems) {
      const requiredTypes: TransactionNodeType[] = ['QUANTITY', 'UNIT_PRICE', 'EXTENDED_PRICE'];
      const missing = requiredTypes.filter(type => !this.findChildByType(item, type));

      if (missing.length > 0) {
        const issue: ValidationIssue = {
          rule: 'V1',
          severity: 'ERROR',
          message: `LINE_ITEM missing required children: ${missing.join(', ')}`,
          node: item,
          context: item.context,
          recommendation: 'Attempt re-link from sibling nodes or prune if unrecoverable'
        };
        issues.push(issue);

        // Mark node as invalid
        item.metadata = { ...item.metadata, _valid: false, _missingChildren: missing };
      }
    }

    return issues;
  }

  // Rule V2: FOOTER uniqueness
  private validateFooterUniqueness(ast: InvoiceAST): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const grandTotals = this.collectNodes(ast.root, 'GRAND_TOTAL');

    if (grandTotals.length > 1) {
      // Sort by confidence, keep highest
      const sorted = [...grandTotals].sort((a, b) => b.confidence - a.confidence);
      const best = sorted[0];

      for (let i = 1; i < sorted.length; i++) {
        const duplicate = sorted[i];
        const issue: ValidationIssue = {
          rule: 'V2',
          severity: 'WARNING',
          message: `Multiple GRAND_TOTAL nodes detected. Best: ${best.value}, Duplicate: ${duplicate.value}`,
          node: duplicate,
          context: duplicate.context,
          recommendation: 'Mark duplicate as suspect total; do not override best grand total'
        };
        issues.push(issue);
        duplicate.metadata = { ...duplicate.metadata, _suspectTotal: true };
      }
    }

    return issues;
  }

  // Rule V3: Orphan numeric elimination
  private validateOrphanNodes(ast: InvoiceAST): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const allNodes = this.collectAllNodes(ast.root);

    for (const node of allNodes) {
      // Check if node is a numeric/financial node not linked to a structural block
      if (['LINE_ITEM', 'GRAND_TOTAL', 'SUBTOTAL', 'TAX', 'SHIPPING', 'DISCOUNT', 'QUANTITY_SUMMARY'].includes(node.type)) {
        const isLinkedToStructure = this.isLinkedToStructure(node);
        if (!isLinkedToStructure) {
          const issue: ValidationIssue = {
            rule: 'V3',
            severity: 'WARNING',
            message: `${node.type} node is not linked to any structural block (TABLE_ROW or FOOTER_BLOCK)`,
            node,
            context: node.context,
            recommendation: 'Re-link to nearest structural block or prune as orphan'
          };
          issues.push(issue);
          node.metadata = { ...node.metadata, _orphan: true };
        }
      }
    }

    return issues;
  }

  // Rule V4: Arithmetic consistency
  private validateArithmeticConsistency(ast: InvoiceAST): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lineItems = this.collectNodes(ast.root, 'LINE_ITEM');

    for (const item of lineItems) {
      const qtyNode = this.findChildByType(item, 'QUANTITY');
      const unitNode = this.findChildByType(item, 'UNIT_PRICE');
      const extNode = this.findChildByType(item, 'EXTENDED_PRICE');

      if (qtyNode && unitNode && extNode) {
        const qty = typeof qtyNode.value === 'number' ? qtyNode.value : 0;
        const unitPrice = typeof unitNode.value === 'number' ? unitNode.value : 0;
        const extendedPrice = typeof extNode.value === 'number' ? extNode.value : 0;

        const expected = qty * unitPrice;
        const variance = Math.abs(expected - extendedPrice) / (extendedPrice || 1);

        if (variance > this.ARITHMETIC_TOLERANCE) {
          const issue: ValidationIssue = {
            rule: 'V4',
            severity: 'WARNING',
            message: `Arithmetic mismatch: ${qty} × ${unitPrice} = ${expected}, but extendedPrice = ${extendedPrice} (variance: ${(variance * 100).toFixed(1)}%)`,
            node: item,
            context: item.context,
            recommendation: 'Reconcile extendedPrice with computed value if confidence improves'
          };
          issues.push(issue);
          item.metadata = { ...item.metadata, _arithmeticMismatch: true, _variance: variance };
        }
      }
    }

    return issues;
  }

  // Rule V5: Total reconciliation
  private validateTotalReconciliation(ast: InvoiceAST): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const grandTotals = this.collectNodes(ast.root, 'GRAND_TOTAL');
    const lineItems = this.collectNodes(ast.root, 'LINE_ITEM');

    if (grandTotals.length === 0 || lineItems.length === 0) {
      return issues;
    }

    const bestGrandTotal = grandTotals.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    const lineItemSum = lineItems.reduce((sum, item) => {
      const extNode = this.findChildByType(item, 'EXTENDED_PRICE');
      return sum + (typeof extNode?.value === 'number' ? extNode.value : 0);
    }, 0);

    const grandTotalValue = typeof bestGrandTotal.value === 'number' ? bestGrandTotal.value : 0;
    const discrepancy = Math.abs(grandTotalValue - lineItemSum);
    const variance = discrepancy / (grandTotalValue || 1);

    if (variance > this.TOTAL_TOLERANCE) {
      const issue: ValidationIssue = {
        rule: 'V5',
        severity: 'WARNING',
        message: `Total discrepancy: GRAND_TOTAL=${grandTotalValue}, SUM(lineItems)=${lineItemSum} (variance: ${(variance * 100).toFixed(1)}%)`,
        node: bestGrandTotal,
        context: 'footer_region',
        recommendation: 'Flag TOTAL_DISCREPANCY; do NOT override GRAND_TOTAL with computed sum'
      };
      issues.push(issue);
      bestGrandTotal.metadata = { ...bestGrandTotal.metadata, _totalDiscrepancy: true, _lineItemSum: lineItemSum };
    }

    return issues;
  }

  // Rule V6: Impossible values detection
  private validateImpossibleValues(ast: InvoiceAST): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lineItems = this.collectNodes(ast.root, 'LINE_ITEM');

    for (const item of lineItems) {
      const qtyNode = this.findChildByType(item, 'QUANTITY');
      const unitNode = this.findChildByType(item, 'UNIT_PRICE');
      const extNode = this.findChildByType(item, 'EXTENDED_PRICE');

      const qty = typeof qtyNode?.value === 'number' ? qtyNode.value : 0;
      const unitPrice = typeof unitNode?.value === 'number' ? unitNode.value : 0;
      const extendedPrice = typeof extNode?.value === 'number' ? extNode.value : 0;

      if (qty < 0 || unitPrice < 0 || extendedPrice < 0) {
        issues.push({
          rule: 'V6',
          severity: 'ERROR',
          message: `Negative value detected: qty=${qty}, unitPrice=${unitPrice}, extendedPrice=${extendedPrice}`,
          node: item,
          context: item.context,
          recommendation: 'Prune invalid line item or flag for manual review'
        });
        item.metadata = { ...item.metadata, _impossibleValue: true };
      }

      if (unitPrice > this.MAX_UNIT_PRICE) {
        issues.push({
          rule: 'V6',
          severity: 'WARNING',
          message: `Suspicious unit price: ${unitPrice} exceeds threshold ${this.MAX_UNIT_PRICE}`,
          node: item,
          context: item.context,
          recommendation: 'Verify unit price decimal placement or OCR error'
        });
        item.metadata = { ...item.metadata, _suspiciousUnitPrice: true };
      }

      if (qty > this.MAX_QUANTITY) {
        issues.push({
          rule: 'V6',
          severity: 'WARNING',
          message: `Suspicious quantity: ${qty} exceeds threshold ${this.MAX_QUANTITY}`,
          node: item,
          context: item.context,
          recommendation: 'Verify quantity is not a PO number or date'
        });
        item.metadata = { ...item.metadata, _suspiciousQuantity: true };
      }

      // Extreme variance across rows
      const allUnitPrices = lineItems
        .map(li => {
          const upNode = this.findChildByType(li, 'UNIT_PRICE');
          return typeof upNode?.value === 'number' ? upNode.value : 0;
        })
        .filter(v => v > 0);

      if (allUnitPrices.length > 1 && unitPrice > 0) {
        const avg = allUnitPrices.reduce((a, b) => a + b, 0) / allUnitPrices.length;
        const rowVariance = Math.abs(unitPrice - avg) / avg;

        if (rowVariance > 0.20) {
          item.metadata = { ...item.metadata, _extremeVariance: true, _rowVariance: rowVariance };
        }
      }
    }

    return issues;
  }

  // Helper: collect nodes by type
  private collectNodes(root: ASTNode, type: ASTNodeType): ASTNode[] {
    const result: ASTNode[] = [];
    const stack: ASTNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type === type) result.push(node);
      if (node.children) stack.push(...node.children);
    }

    return result;
  }

  // Helper: collect all nodes
  private collectAllNodes(root: ASTNode): ASTNode[] {
    const result: ASTNode[] = [];
    const stack: ASTNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      result.push(node);
      if (node.children) stack.push(...node.children);
    }

    return result;
  }

  // Helper: find child by type
  private findChildByType(parent: ASTNode, type: TransactionNodeType): ASTNode | undefined {
    if (!parent.children) return undefined;
    return parent.children.find(child => child.type === type);
  }

  // Helper: check if node is linked to a structural block
  private isLinkedToStructure(node: ASTNode): boolean {
    let current: ASTNode | undefined = node;
    while (current) {
      if (['TABLE_ROW', 'FOOTER_BLOCK', 'HEADER_BLOCK', 'DOCUMENT_ROOT'].includes(current.type)) {
        return true;
      }
      current = current.parent || undefined;
    }
    return false;
  }
}

// ============================================================================
// AST REPAIR ENGINE
// ============================================================================
export class InvoiceASTRepairEngine {
  private readonly ARITHMETIC_TOLERANCE = 0.15;
  private readonly RECALIBRATION = {
    cleanMatch: 0.10,
    repairedMatch: -0.05,
    fullyReconstructed: -0.20
  };

  repair(ast: InvoiceAST, report: ValidationReport): { ast: InvoiceAST; report: RepairReport } {
    console.log('[InvoiceASTRepairEngine] Starting repair with', report.issues.length, 'issues');

    const actions: RepairAction[] = [];
    let nodesRemoved = 0;
    let nodesRelinked = 0;
    let nodesReconciled = 0;
    let confidenceRecalibrated = 0;

    // Priority 1: Structural fixes (missing nodes)
    const structuralIssues = report.issues.filter(i => i.rule === 'V1');
    for (const issue of structuralIssues) {
      if (issue.node) {
        const relinked = this.relinkMissingChildren(issue.node, ast);
        if (relinked) {
          actions.push({
            type: 'RELINK',
            description: 'Re-linked missing children for LINE_ITEM',
            node: issue.node,
            confidenceDelta: this.RECALIBRATION.repairedMatch
          });
          nodesRelinked++;
        }
      }
    }

    // Priority 2: Re-linking (bad associations / orphans)
    const orphanIssues = report.issues.filter(i => i.rule === 'V3');
    for (const issue of orphanIssues) {
      if (issue.node) {
        const relinked = this.relinkToNearestStructure(issue.node, ast);
        if (relinked) {
          actions.push({
            type: 'RELINK',
            description: `Re-linked orphan ${issue.node.type} to structural block`,
            node: issue.node,
            confidenceDelta: this.RECALIBRATION.repairedMatch
          });
          nodesRelinked++;
        }
      }
    }

    // Priority 3: Value reconciliation DISABLED in lock mode
    // The repair engine must NEVER introduce a new value that is not already in the AST.
    // Arithmetic mismatches are flagged by the validator; they are NOT silently corrected.
    // If a node is irreparable, it will be pruned in Priority 5.
    console.log('[InvoiceASTRepairEngine] Value reconciliation skipped: lock mode preserves AST values only');

    // Priority 4: Confidence recalibration
    const recalibratedNodes = this.recalibrateConfidence(ast);
    confidenceRecalibrated = recalibratedNodes.length;
    for (const node of recalibratedNodes) {
      actions.push({
        type: 'RECALIBRATE',
        description: 'Recalibrated confidence based on repair state',
        node,
        confidenceDelta: 0 // logged individually
      });
    }

    // Priority 5: Pruning (always last)
    const pruneResult = this.pruneInvalidNodes(ast);
    nodesRemoved = pruneResult.removedCount;
    for (const node of pruneResult.removedNodes) {
      actions.push({
        type: 'PRUNE',
        description: `Pruned invalid ${node.type} node`,
        node
      });
    }

    const repairReport: RepairReport = {
      actions,
      nodesRemoved,
      nodesRelinked,
      nodesReconciled,
      confidenceRecalibrated
    };

    console.log('[InvoiceASTRepairEngine] Repair complete:', {
      actions: actions.length,
      nodesRemoved,
      nodesRelinked,
      nodesReconciled,
      confidenceRecalibrated
    });

    return { ast, report: repairReport };
  }

  // Repair Strategy A: Re-link missing children
  private relinkMissingChildren(node: ASTNode, ast: InvoiceAST): boolean {
    if (!node.children) node.children = [];

    const requiredTypes: TransactionNodeType[] = ['QUANTITY', 'UNIT_PRICE', 'EXTENDED_PRICE'];
    const meta = node.metadata || {};

    for (const type of requiredTypes) {
      const existing = node.children.find(child => child.type === type);
      if (!existing && meta[type.toLowerCase() as keyof typeof meta] !== undefined) {
        // Reconstruct from metadata
        const value = meta[type.toLowerCase() as keyof typeof meta];
        const newNode: ASTNode = {
          type,
          value: typeof value === 'number' ? value : undefined,
          confidence: 0.70,
          source: 'REPAIR_RECONSTRUCTION',
          context: `${node.context}_${type.toLowerCase()}`,
          parent: node
        };
        node.children.push(newNode);
      }
    }

    return node.children.length >= 3;
  }

  // Repair Strategy B: Re-link orphan to nearest structure
  private relinkToNearestStructure(node: ASTNode, ast: InvoiceAST): boolean {
    // Find nearest structural block by context similarity
    const structures = this.collectNodes(ast.root, 'TABLE_ROW')
      .concat(this.collectNodes(ast.root, 'FOOTER_BLOCK'))
      .concat(this.collectNodes(ast.root, 'HEADER_BLOCK'));

    if (structures.length === 0) return false;

    const nodeContext = node.context || '';
    let bestMatch = structures[0];
    let bestScore = 0;

    for (const struct of structures) {
      const structContext = struct.context || '';
      const score = this.contextSimilarity(nodeContext, structContext);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = struct;
      }
    }

    if (bestScore > 0 && bestMatch.children) {
      // Remove from current parent
      if (node.parent && node.parent.children) {
        node.parent.children = node.parent.children.filter(child => child !== node);
      }
      // Add to new parent
      node.parent = bestMatch;
      bestMatch.children.push(node);
      return true;
    }

    return false;
  }

  // Repair Strategy C: Reconcile arithmetic
  private reconcileArithmetic(node: ASTNode): boolean {
    if (!node.children) return false;

    const qtyNode = node.children.find(child => child.type === 'QUANTITY');
    const unitNode = node.children.find(child => child.type === 'UNIT_PRICE');
    const extNode = node.children.find(child => child.type === 'EXTENDED_PRICE');

    if (!qtyNode || !unitNode || !extNode) return false;

    const qty = typeof qtyNode.value === 'number' ? qtyNode.value : 0;
    const unitPrice = typeof unitNode.value === 'number' ? unitNode.value : 0;
    const extendedPrice = typeof extNode.value === 'number' ? extNode.value : 0;

    const expected = qty * unitPrice;
    const variance = Math.abs(expected - extendedPrice) / (extendedPrice || 1);

    if (variance > this.ARITHMETIC_TOLERANCE) {
      // Recompute and pick closest match
      const candidates = [extendedPrice, expected];
      const bestMatch = candidates.reduce((best, current) =>
        Math.abs(current - expected) < Math.abs(best - expected) ? current : best
      );

      if (bestMatch !== extendedPrice && bestMatch > 0) {
        const before = extNode.value;
        extNode.value = bestMatch;
        extNode.confidence = Math.max(0.60, extNode.confidence + this.RECALIBRATION.repairedMatch);
        extNode.source = 'REPAIR_RECONCILE';
        console.log('[InvoiceASTRepairEngine] Reconciled extendedPrice:', before, '→', bestMatch);
        return true;
      }
    }

    return false;
  }

  // Repair Strategy D: Confidence recalibration
  private recalibrateConfidence(ast: InvoiceAST): ASTNode[] {
    const recalibrated: ASTNode[] = [];
    const allNodes = this.collectAllNodes(ast.root);

    for (const node of allNodes) {
      const meta = node.metadata || {};
      const wasRepaired = meta._relinked || meta._reconciled || meta._reconstructed;
      const isClean = !meta._arithmeticMismatch && !meta._orphan && !meta._suspectTotal && !meta._missingChildren;

      if (isClean && node.confidence < 0.95) {
        node.confidence = Math.min(0.99, node.confidence + this.RECALIBRATION.cleanMatch);
        recalibrated.push(node);
      } else if (wasRepaired) {
        node.confidence = Math.max(0.50, node.confidence + this.RECALIBRATION.repairedMatch);
        recalibrated.push(node);
      } else if (meta._reconstructed) {
        node.confidence = Math.max(0.40, node.confidence + this.RECALIBRATION.fullyReconstructed);
        recalibrated.push(node);
      }
    }

    return recalibrated;
  }

  // Repair Strategy E: Prune invalid nodes
  private pruneInvalidNodes(ast: InvoiceAST): { removedCount: number; removedNodes: ASTNode[] } {
    const removedNodes: ASTNode[] = [];
    const allNodes = this.collectAllNodes(ast.root);

    for (const node of allNodes) {
      const meta = node.metadata || {};
      const shouldPrune =
        meta._impossibleValue === true ||
        meta._valid === false ||
        (meta._orphan === true && node.confidence < 0.5) ||
        (meta._suspectTotal === true && node.confidence < 0.8);

      if (shouldPrune && node.parent && node.parent.children) {
        node.parent.children = node.parent.children.filter(child => child !== node);
        removedNodes.push(node);
      }
    }

    return { removedCount: removedNodes.length, removedNodes };
  }

  // Helper: context similarity
  private contextSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const aParts = a.split('_');
    const bParts = b.split('_');
    const common = aParts.filter(part => bParts.includes(part));
    return common.length / Math.max(aParts.length, bParts.length);
  }

  // Helper: collect nodes by type
  private collectNodes(root: ASTNode, type: ASTNodeType): ASTNode[] {
    const result: ASTNode[] = [];
    const stack: ASTNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type === type) result.push(node);
      if (node.children) stack.push(...node.children);
    }

    return result;
  }

  // Helper: collect all nodes
  private collectAllNodes(root: ASTNode): ASTNode[] {
    const result: ASTNode[] = [];
    const stack: ASTNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      result.push(node);
      if (node.children) stack.push(...node.children);
    }

    return result;
  }
}
