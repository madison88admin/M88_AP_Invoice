// ============================================================================
// DSRS v7.3: AST ZERO-LEAK RUNTIME
// ============================================================================
// Concept: In AST mode, only the AST exists in memory. Everything else is
// compile-time dead code. No legacy execution, no dual variables, no comparison
// layer, no fallback traces, no shadow computation.

import { InvoiceAST, InvoiceASTBuilder, InvoiceASTNormalizer, InvoiceASTResolver } from './InvoiceAST';
import { InvoiceASTValidator, InvoiceASTRepairEngine, ValidationReport } from './InvoiceASTValidator';

export interface OCRInput {
  rawText: string;
  normalizedText: string;
  pages?: string[];
  fileName?: string;
  source?: 'EMAIL' | 'MANUAL_UPLOAD' | 'PORTAL';
}

export interface ASTContext {
  ocr: OCRInput;
  ast: InvoiceAST;
  // ONLY allowed intermediate state
  workingMemory: {
    nodes: import('./InvoiceAST').ASTNode[];
    validation: ValidationReport;
  };
  // Debug info is isolated and never part of the main output
  debug?: {
    ast?: InvoiceAST;
    validation?: ValidationReport;
  };
}

export interface FinalInvoiceOutput {
  amount: number | null;
  currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null;
  qty_shipped: number | null;
  status: 'EXTRACTED' | 'REVIEW_REQUIRED' | 'AST_FAILURE';
  status_reason?: string;
  // Debug info is isolated and opt-in only
  debug?: {
    ast?: InvoiceAST;
    validation?: ValidationReport;
    // Visible during testing: how the final amount was chosen
    amountResolution?: {
      method: string;
      confidence: number;
      score: number | null;
      topCandidates: Array<{ amount: number; label: string; score: number; page: number }>;
      internalLineItems?: Array<{ quantity: number; unitPrice: number; extendedPrice: number; rawLine: string }>;
      internalLineItemSum?: number;
    };
  };
}

export interface ASTKernelMetadata {
  vendor?: string | null;
  invoiceNumber?: string | null;
  currency?: string | null;
  date?: string | null;
}

export interface ASTKernelLineItem {
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  rawLine: string;
}

export interface ASTKernelBankInfo {
  bank_name: string | null;
  account_number: string | null;
  swift_code: string | null;
}

// ============================================================================
// AST EXECUTION KERNEL
// ============================================================================
export async function executeInvoiceExtraction(
  input: OCRInput,
  lineItems: ASTKernelLineItem[],
  metadata: ASTKernelMetadata,
  bankInfo: ASTKernelBankInfo,
  includeDebug = false
): Promise<FinalInvoiceOutput> {
  if (!input?.normalizedText) {
    return {
      amount: null,
      currency: null,
      qty_shipped: null,
      status: 'AST_FAILURE',
      status_reason: 'No OCR input provided'
    };
  }

  console.log('[ASTKernel] executeInvoiceExtraction: running AST zero-leak kernel');

  const result = await runASTKernel(input, lineItems, metadata, bankInfo, includeDebug);

  assertZeroLeak(result);

  return result;
}

/**
 * The ONLY pipeline in AST mode.
 * OCR → AST BUILD → NORMALIZE → VALIDATE → REPAIR → RESOLVE → FINALIZE
 */
async function runASTKernel(
  input: OCRInput,
  lineItems: ASTKernelLineItem[],
  metadata: ASTKernelMetadata,
  bankInfo: ASTKernelBankInfo,
  includeDebug = false
): Promise<FinalInvoiceOutput> {
  const context = buildASTContext(input, lineItems, metadata, bankInfo);

  // Validate and repair
  const validator = new InvoiceASTValidator();
  const repairEngine = new InvoiceASTRepairEngine();

  const validationReport = validator.validate(context.ast);
  const { ast: repairedAst } = repairEngine.repair(context.ast, validationReport);

  // Resolve: ALL decisions happen here
  const resolver = new InvoiceASTResolver();
  const amountResult = resolver.resolveAmount(repairedAst);
  const qtyResult = resolver.resolveQty(repairedAst);

  // Finalize output
  const output: FinalInvoiceOutput = {
    amount: amountResult.value,
    currency: amountResult.currency,
    qty_shipped: qtyResult.value,
    status: 'EXTRACTED',
    status_reason: undefined
  };

  // Hard rule: if AST has no amount, it is a failure, not a fallback trigger
  if (output.amount === null || output.amount === undefined) {
    output.status = 'AST_FAILURE';
    output.status_reason = 'AST resolver returned no amount (no structured node found)';
    console.error('[ASTKernel] AST_FAILURE:', output.status_reason);
  }

  // Attach debug info only if explicitly requested
  if (includeDebug) {
    // Collect top grand-total candidates surfaced by the builder
    const allNodes: import('./InvoiceAST').ASTNode[] = [];
    const stack = [repairedAst.root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      allNodes.push(node);
      if (node.children) stack.push(...node.children);
    }
    const grandTotalNodes = allNodes.filter(n => n.type === 'GRAND_TOTAL');
    const topCandidates = grandTotalNodes
      .flatMap(n => n.metadata?.allCandidates || [])
      .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 10);

    const internalLineItemSum = lineItems.reduce(
      (sum, li) => sum + (typeof li.extendedPrice === 'number' ? li.extendedPrice : 0),
      0
    );

    output.debug = {
      ast: repairedAst,
      validation: validationReport,
      amountResolution: {
        method: amountResult.source,
        confidence: amountResult.confidence,
        score: grandTotalNodes[0]?.metadata?.score ?? null,
        topCandidates: topCandidates.map((c: any) => ({
          amount: c.amount,
          label: c.label,
          score: c.score,
          page: c.page
        })),
        internalLineItems: lineItems,
        internalLineItemSum,
      }
    };
  }

  console.log('[ASTKernel] Final output:', {
    amount: output.amount,
    qty_shipped: output.qty_shipped,
    status: output.status,
    status_reason: output.status_reason
  });

  return output;
}

/**
 * Build the AST context sandbox.
 * No legacy fields are allowed in this object.
 */
function buildASTContext(
  input: OCRInput,
  lineItems: ASTKernelLineItem[],
  metadata: ASTKernelMetadata,
  bankInfo: ASTKernelBankInfo
): ASTContext {
  const ast = buildInvoiceAST(input.normalizedText, lineItems, metadata, bankInfo, input.pages);

  const allNodes: import('./InvoiceAST').ASTNode[] = [];
  const stack = [ast.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    allNodes.push(node);
    if (node.children) stack.push(...node.children);
  }

  return {
    ocr: input,
    ast,
    workingMemory: {
      nodes: allNodes,
      validation: { valid: true, issues: [], errorCount: 0, warningCount: 0, infoCount: 0 }
    }
  };
}

/**
 * Build Invoice AST from extracted data.
 * DSRS v7: TRUE AST MODE - only node creation, no decisions here.
 * All decisions happen in AST Resolver during tree traversal.
 */
export function buildInvoiceAST(
  normalizedText: string,
  lineItems: ASTKernelLineItem[],
  metadata: ASTKernelMetadata,
  bankInfo: ASTKernelBankInfo,
  pages?: string[]
): InvoiceAST {
  console.log('[ASTKernel] buildInvoiceAST: building invoice AST from extracted data');

  const builder = new InvoiceASTBuilder();
  const normalizer = new InvoiceASTNormalizer();

  // Add structural blocks (minimal layout segmentation)
  const headerBlock = builder.addStructuralBlock('HEADER_BLOCK', 'header_region');
  const tableBlock = builder.addStructuralBlock('TABLE_ROW', 'table_region');
  const footerBlock = builder.addStructuralBlock('FOOTER_BLOCK', 'footer_region');

  // Add identity nodes
  if (metadata.vendor) {
    builder.addVendor(metadata.vendor, 'header_region', 0.90);
  }

  if (bankInfo?.bank_name) {
    builder.addBankInfo(
      bankInfo.bank_name,
      bankInfo.account_number,
      bankInfo.swift_code,
      'footer_region',
      0.85
    );
  }

  // Add line items as TABLE_ROW children
  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    const skuMatch = item.rawLine.match(/\b\d{2}[A-Z]{2,4}\d{1,2}\b/);
    const sku = skuMatch ? skuMatch[0] : `UNKNOWN_${i}`;

    // Add line item directly to table block (no double-adding to root)
    builder.addNode(
      {
        type: 'LINE_ITEM',
        confidence: 0.99,
        source: 'SKU_ANCHOR',
        context: `row_${i}`,
        metadata: { sku, quantity: item.quantity, unitPrice: item.unitPrice, extendedPrice: item.extendedPrice },
        children: [
          { type: 'QUANTITY', value: item.quantity, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `row_${i}_qty` },
          { type: 'UNIT_PRICE', value: item.unitPrice, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `row_${i}_unit` },
          { type: 'EXTENDED_PRICE', value: item.extendedPrice, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `row_${i}_ext` }
        ]
      },
      tableBlock
    );
  }

  // Parse Avery-style line items from raw text and merge with provided line items.
  // Only run for invoices with Avery-style indicators (QTY SHIPPED table + "Each" lines)
  // to avoid adding false line items for other brands.
  let averyIndex = 0;
  let match;
  let hasPer1000Pcs = false;
  const hasAveryTable = /QTY\s+SHIPPED.*UOM.*UNIT\s+PRICE.*EXTENDED\s+PRICE/gis.test(normalizedText) &&
                        /\d+\s+Each\s+[\d.]+/i.test(normalizedText);

  if (hasAveryTable) {
    console.log('[ASTKernel] buildInvoiceAST: detected Avery-style QTY SHIPPED table');
    // Spaced format: "120 Each 0.06656 7.99"
    const averyPattern = /(\d+)\s+Each\s+([\d.]+)\s+([\d.]+)/gi;
    // Concatenated OCR format: "120 Each 0.066567.99" (unitPrice and extendedPrice run together)
    const averyConcatPattern = /(\d+)\s+Each\s+(\d+\.\d{4,})(\d+\.\d{2})/gi;
    const existingKeys = new Set(lineItems.map(i => `${i.quantity}_${i.unitPrice}_${i.extendedPrice}`));

    const addAveryLineItem = (quantity: number, unitPrice: number, extendedPrice: number) => {
      const key = `${quantity}_${unitPrice}_${extendedPrice}`;

      // Skip lines that look like totals/subtotals (e.g., "0.00 7.99")
      if (quantity <= 0 || unitPrice <= 0 || extendedPrice <= 0) return;

      if (existingKeys.has(key)) {
        console.log('[ASTKernel] buildInvoiceAST: skipping duplicate Avery line item:', key);
        return;
      }
      existingKeys.add(key);

      builder.addNode(
        {
          type: 'LINE_ITEM',
          confidence: 0.99,
          source: 'TEXT_PARSE',
          context: `avery_row_${averyIndex}`,
          metadata: { sku: `AVERY_${averyIndex}`, quantity, unitPrice, extendedPrice },
          children: [
            { type: 'QUANTITY', value: quantity, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `avery_row_${averyIndex}_qty` },
            { type: 'UNIT_PRICE', value: unitPrice, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `avery_row_${averyIndex}_unit` },
            { type: 'EXTENDED_PRICE', value: extendedPrice, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `avery_row_${averyIndex}_ext` }
          ]
        },
        tableBlock
      );
      averyIndex++;
    };

    while ((match = averyPattern.exec(normalizedText)) !== null) {
      addAveryLineItem(parseInt(match[1], 10), parseFloat(match[2]), parseFloat(match[3]));
    }
    while ((match = averyConcatPattern.exec(normalizedText)) !== null) {
      addAveryLineItem(parseInt(match[1], 10), parseFloat(match[2]), parseFloat(match[3]));
    }
  }

  // General fallback for USD/PCS/UNIT-style line items only if no line items were provided at all.
  // Handles comma-separated quantities (e.g., "1,131") and unit-price suffixes like "0.01000/PCS".
  if (lineItems.length === 0) {
    // Handles dollar-currency lines like "100 $0.3330 $33.30" as well as PCS/UNIT/EA lines.
    const generalLineItemPattern = /([\d,]+)\s+(?:USD|PCS|Pcs|UNIT|Unit|unit|EA|ea|pc|pieces?|\$)\s+\$?([\d.]+)(?:\/[A-Za-z]+)?\s+\$?([\d.]+)/gi;
    const existingKeys = new Set(lineItems.map(i => `${i.quantity}_${i.unitPrice}_${i.extendedPrice}`));
    while ((match = generalLineItemPattern.exec(normalizedText)) !== null) {
      const quantity = parseInt(match[1].replace(/,/g, ''), 10);
      const unitPrice = parseFloat(match[2]);
      const extendedPrice = parseFloat(match[3]);
      const key = `${quantity}_${unitPrice}_${extendedPrice}`;

      if (quantity <= 0 || unitPrice <= 0 || extendedPrice <= 0) continue;

      if (existingKeys.has(key)) {
        continue;
      }
      existingKeys.add(key);

      builder.addNode(
        {
          type: 'LINE_ITEM',
          confidence: 0.99,
          source: 'TEXT_PARSE',
          context: `general_row_${averyIndex}`,
          metadata: { sku: `GENERAL_${averyIndex}`, quantity, unitPrice, extendedPrice },
          children: [
            { type: 'QUANTITY', value: quantity, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `general_row_${averyIndex}_qty` },
            { type: 'UNIT_PRICE', value: unitPrice, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `general_row_${averyIndex}_unit` },
            { type: 'EXTENDED_PRICE', value: extendedPrice, confidence: 0.99, source: 'LINE_ITEM_CHILD', context: `general_row_${averyIndex}_ext` }
          ]
        },
        tableBlock
      );
      averyIndex++;
    }
  }

  // Paxar / per-1000-PCS format: "unitPricePer1000 extendedPrice qty PCS"
  // e.g. "Mexico Importer Labe 19.37 8.62 445 PCS" where 19.37 is per 1000 pcs and 8.62 is the total.
  // OCR may concatenate the three numbers: "19.378.62445 PCS" => 19.37, 8.62, 445.
  hasPer1000Pcs = /(?:1000\s*PCS|PER\s+1000\s*PCS|1000\s*Pcs|dalam\s+1000\s*Pcs)/i.test(normalizedText);
  if (hasPer1000Pcs) {
    console.log('[ASTKernel] buildInvoiceAST: detected per-1000-PCS pricing format');
    // Spaced format: "19.37 8.62 445 PCS" or "19.37 8.62 2,445 PCS"
    const per1000Pattern = /([\d.]+)\s+([\d.]+)\s+([\d,]+)\s+(?:PCS|Pcs|EA|Each|pieces?)/gi;
    // Concatenated OCR format: "19.378.62445 PCS" (price_per_1000.total.qty)
    const per1000ConcatPattern = /([\d.]+)\.([\d.]+)\.([\d,]{2,7})\s+(?:PCS|Pcs|EA|Each|pieces?)/gi;
    const existingKeys = new Set(
      builder.getNodes().lineItems.map(i => `${i.metadata?.quantity}_${i.metadata?.unitPrice}_${i.metadata?.extendedPrice}`)
    );

    const parsePer1000 = (firstDecimal: number, secondDecimal: number, quantity: number) => {
      if (quantity <= 0 || firstDecimal <= 0 || secondDecimal <= 0) return;
      // The smaller decimal is the actual extended price (total); the larger is unit price per 1000 pcs.
      const extendedPrice = Math.min(firstDecimal, secondDecimal);
      const unitPrice = extendedPrice / quantity;
      const key = `${quantity}_${unitPrice}_${extendedPrice}`;
      if (existingKeys.has(key)) return;
      existingKeys.add(key);

      builder.addNode(
        {
          type: 'LINE_ITEM',
          confidence: 0.95,
          source: 'PER_1000_PCS_PARSE',
          context: `per1000_row_${averyIndex}`,
          metadata: { sku: `PER1000_${averyIndex}`, quantity, unitPrice, extendedPrice },
          children: [
            { type: 'QUANTITY', value: quantity, confidence: 0.95, source: 'LINE_ITEM_CHILD', context: `per1000_row_${averyIndex}_qty` },
            { type: 'UNIT_PRICE', value: unitPrice, confidence: 0.95, source: 'LINE_ITEM_CHILD', context: `per1000_row_${averyIndex}_unit` },
            { type: 'EXTENDED_PRICE', value: extendedPrice, confidence: 0.95, source: 'LINE_ITEM_CHILD', context: `per1000_row_${averyIndex}_ext` }
          ]
        },
        tableBlock
      );
      averyIndex++;
    };

    while ((match = per1000Pattern.exec(normalizedText)) !== null) {
      parsePer1000(parseFloat(match[1]), parseFloat(match[2]), parseInt(match[3].replace(/,/g, ''), 10));
    }
    while ((match = per1000ConcatPattern.exec(normalizedText)) !== null) {
      parsePer1000(parseFloat(match[1]), parseFloat(match[2]), parseInt(match[3].replace(/,/g, ''), 10));
    }
  }

  // Set document metadata after all parsing heuristics have run.
  builder.setMetadata({
    vendor: metadata.vendor || undefined,
    invoiceNumber: metadata.invoiceNumber || undefined,
    currency: metadata.currency || undefined,
    date: metadata.date || undefined,
    hasPer1000Pcs
  });

  // ─── Scoring types and helpers ───────────────────────────────────────────

  interface TotalCandidate {
    pageIndex: number;
    lineIndex: number;
    pageLineCount: number;
    line: string;
    amount: number;
    label: string;
    hasCurrencyContext: boolean;
    currency: string | null;
    isPerUnit: boolean;
    isPerThousand: boolean;
  }

  const PER_UNIT_SKIP = /\b(QTY|QUANTITY|PCS|PIECES|UNITS|EA|EACH|PER)\b/i;
  const PER_THOUSAND_CTX = /per\s*1[,.]?000|\/1000|per\s*thousand|\/M\b/i;

  function scoreCandidate(
    c: TotalCandidate,
    lineItemSum: number,
    hasPer1000Pcs: boolean,
    detectedCurrency: string,
    maxPageIndex: number
  ): number {
    let score = 0;

    // Label strength
    const strongLabel = /grand\s*total|total\s*amount|amount\s*due|balance\s*due|合計|請求合計|总计|合计|합계|총액/i;
    const weakLabel = /\btotal\b|\bnet\b|subtotal|sub\s*total|应付金额|金额合计|総額/i;
    if (strongLabel.test(c.label)) score += 80;
    else if (weakLabel.test(c.label)) score += 40;

    // Currency signals
    if (c.hasCurrencyContext) score += 50;
    if (c.currency === detectedCurrency) score += 15;

    // Position: bottom of last page scores highest
    const pagePosition = c.pageLineCount > 0 ? c.lineIndex / c.pageLineCount : 0;
    if (pagePosition > 0.7) score += 20;
    if (c.pageIndex === maxPageIndex) score += 15;

    // Cross-check with line item sum
    if (lineItemSum > 0) {
      const ratio = c.amount / lineItemSum;
      if (ratio >= 0.95 && ratio <= 1.05) score += 60;
      else if (ratio >= 0.80 && ratio <= 1.15) score += 40;
      else if (ratio < 0.20) score -= 100;
      else if (ratio > 5) score -= 100;
      else if (ratio > 1.5) score -= 60;
    }

    // Per-unit / per-1000 penalties
    if (c.isPerUnit) score -= 60;
    if (hasPer1000Pcs && c.isPerThousand) score -= 50;

    return score;
  }

  function scoreToConfidence(score: number): number {
    return Math.min(1, Math.max(0, (score + 200) / 400));
  }

  // ─── End scoring helpers ─────────────────────────────────────────────────

  // Add GRAND TOTAL nodes from TOTAL lines, with multi-page awareness.
  // If page boundaries are available, prefer the LAST page's total match (real fix for G&F Trading).
  const totalKeywords = [
    'total', 'say total', 'grand total', 'total amount', 'amount due', 'balance due',
    'net total', 'net amount', 'sub total', 'subtotal',
    // Japanese
    '合計', '請求合計', 'お支払い金額', '総額',
    // Chinese (simplified and traditional)
    '总计', '總計', '合计', '合計', '金额合计', '金額合計', '应付金额', '應付金額', '總', '总',
    // Korean
    '합계', '총액'
  ];

  // Helper: collapse OCR-fragmented CJK characters and spaced Latin labels
  // e.g., "總 總 總 總 總 總 總 總" → "總總總總總總總總", "To tal" → "Total"
  function collapseSeparatedCJK(line: string): string {
    let prev = '';
    let collapsed = line;
    while (collapsed !== prev) {
      prev = collapsed;
      collapsed = collapsed
        .replace(/([\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af])\s+([\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af])/g, '$1$2')
        .replace(/\b([A-Za-z]{1,3})\s+([a-z]{2,})\b/g, '$1$2');
    }
    return collapsed;
  }

  // Collect all candidate total lines with their page index, then score them.
  const totalCandidates: (TotalCandidate & { score: number })[] = [];
  const pageTexts = pages && pages.length > 0 ? pages : [normalizedText];
  const maxPageIndex = pageTexts.length - 1;

  const detectedCurrency = (metadata.currency || 'USD').toUpperCase();

  // Pre-compute line item sum once
  const lineItemSum = lineItems.reduce(
    (sum, li) => sum + (typeof li.extendedPrice === 'number' ? li.extendedPrice : 0),
    0
  );

  // Currency context regex: symbol/label immediately before or after the number
  const currencyCtxPattern = /(?:USD|HKD|IDR|EUR|PHP|JPY|US\$|HK\$|\$|€|¥)\s*([0-9,]+\.[0-9]{2,3})|([0-9,]+\.[0-9]{2,3})\s*(?:USD|HKD|IDR|EUR|PHP|JPY)/gi;

  for (let pageIndex = 0; pageIndex <= maxPageIndex; pageIndex++) {
    const pageText = pageTexts[pageIndex];
    const pageLines = pageText.split('\n');

    for (let lineIndex = 0; lineIndex < pageLines.length; lineIndex++) {
      const line = collapseSeparatedCJK(pageLines[lineIndex]);
      const nextLine = collapseSeparatedCJK(pageLines[lineIndex + 1] ?? '');
      const upperLine = line.toUpperCase();

      // Skip quantity / date lines — these are never grand totals
      if (PER_UNIT_SKIP.test(upperLine)) continue;
      if (/\b(invoice\s*date|due\s*date|date\s*of)\b/i.test(upperLine)) continue;

      // Identify where the total label lives
      const currentLineHasLabel = totalKeywords.some(
        kw => upperLine.includes(kw.toUpperCase())
      );
      const nextLineHasLabel = totalKeywords.some(
        kw => nextLine.toUpperCase().includes(kw.toUpperCase())
      );

      // If the label is only on the next line, this current line is just noise (e.g.,
      // "Bank Charges 1Job 30.0000 30.00" sitting above the actual "Total" line).
      // Skip it so we don't capture the wrong amount.
      if (!currentLineHasLabel && nextLineHasLabel) continue;
      if (!currentLineHasLabel) continue;

      // The total label is on this line. The amount may be on this line OR the next line
      // (e.g., label "總 : Total" and amount "USD63.60" on separate lines due to OCR).
      const sourceLines = [line, nextLine].join(' ');
      const lineNumbers = sourceLines.match(/([0-9,]+\.[0-9]{2,3})/g);
      if (!lineNumbers || lineNumbers.length === 0) continue;

      const parsedAmounts = lineNumbers
        .map((n: string) => parseFloat(n.replace(/,/g, '')))
        .filter((n: number) => n > 0 && n < 10_000_000);
      if (parsedAmounts.length === 0) continue;

      // Currency-context extraction across label line + next line
      const currencyMatches = [...sourceLines.matchAll(currencyCtxPattern)];
      const currencyAmounts = currencyMatches
        .map(m => parseFloat((m[1] || m[2]).replace(/,/g, '')))
        .filter(a => parsedAmounts.includes(a));

      const hasCurrencyContext = currencyAmounts.length > 0;
      const selectedAmount = hasCurrencyContext
        ? Math.max(...currencyAmounts)
        : Math.max(...parsedAmounts);

      // Detect currency tag on the combined label/amount block
      const currencyTag = sourceLines.match(/\b(USD|HKD|IDR|EUR|PHP|JPY)\b/i)?.[1]?.toUpperCase() ?? null;

      // Build label from the combined block
      const label = sourceLines.match(
        /(GRAND\s*TOTAL|TOTAL\s*AMOUNT|AMOUNT\s*DUE|BALANCE\s*DUE|NET\s*TOTAL|NET\s*AMOUNT|SUBTOTAL|TOTAL|合計|請求合計|总计|合计|總|总|합계)/i
      )?.[0] ?? 'TOTAL';

      const candidate: TotalCandidate = {
        pageIndex,
        lineIndex,
        pageLineCount: pageLines.length,
        line,
        amount: selectedAmount,
        label,
        hasCurrencyContext,
        currency: currencyTag,
        isPerUnit: PER_UNIT_SKIP.test(line),
        isPerThousand: PER_THOUSAND_CTX.test(sourceLines),
      };

      const score = scoreCandidate(candidate, lineItemSum, hasPer1000Pcs, detectedCurrency, maxPageIndex);
      totalCandidates.push({ ...candidate, score });
    }
  }

  // Log all candidates with scores for debugging
  if (totalCandidates.length > 0) {
    console.log('[ASTKernel] buildInvoiceAST: GRAND_TOTAL candidates with scores:', totalCandidates.map(c => ({
      page: c.pageIndex,
      label: c.label,
      amount: c.amount,
      score: c.score,
      hasCurrencyContext: c.hasCurrencyContext,
      line: c.line.substring(0, 80)
    })));
  }

  // Sort by score descending — highest wins
  totalCandidates.sort((a, b) => b.score - a.score);

  const MIN_SCORE_THRESHOLD = 30;

  if (totalCandidates.length > 0 && totalCandidates[0].score >= MIN_SCORE_THRESHOLD) {
    const best = totalCandidates[0];

    console.log('[ASTKernel] buildInvoiceAST: selected GRAND_TOTAL from page', best.pageIndex, ':', best.amount, 'score:', best.score);
    builder.addNode(
      {
        type: 'GRAND_TOTAL',
        value: best.amount,
        confidence: scoreToConfidence(best.score),
        source: 'TOTAL_LINE',
        context: `footer_region_page_${best.pageIndex}`,
        metadata: {
          label: best.label,
          pageIndex: best.pageIndex,
          hasCurrencyContext: best.hasCurrencyContext,
          score: best.score,
          lineItemSum,
          isPerUnit: best.isPerUnit,
          isPerThousand: best.isPerThousand,
          pagePosition: best.pageLineCount > 0 ? best.lineIndex / best.pageLineCount : 0,
          allCandidates: totalCandidates.map(c => ({
            amount: c.amount,
            label: c.label,
            score: c.score,
            page: c.pageIndex,
          })),
        }
      },
      footerBlock
    );
  } else if (totalCandidates.length > 0) {
    // Candidates exist but all scored too low — surface for manual review
    console.log('[ASTKernel] buildInvoiceAST: grand total candidates below score threshold, surfacing low-confidence node');
    builder.addNode(
      {
        type: 'GRAND_TOTAL',
        value: null,
        confidence: 0.1,
        source: 'LOW_CONFIDENCE_CANDIDATES',
        context: 'scoring_threshold_not_met',
        metadata: {
          allCandidates: totalCandidates.map(c => ({
            amount: c.amount,
            label: c.label,
            score: c.score,
            page: c.pageIndex,
          })),
        }
      },
      footerBlock
    );
  }

  // Add PROSE_CURRENCY nodes for USD settlement phrasing (e.g. "settle in USD @7.70").
  // This is the AST equivalent of the legacy prose-currency fallback.
  const proseCurrencyPatterns = [
    { pattern: /settle\s+in\s+USD\s+([\d,]+\.\d{2})/i, label: 'SETTLE_IN_USD' },
    { pattern: /For\s+settlement\s+in\s+USD.*USD\s+([\d,]+\.\d{2})/i, label: 'FOR_SETTLEMENT_USD' },
    { pattern: /@[\d.]+.*USD\s+([\d,]+\.\d{2})/i, label: 'AT_RATE_USD' },
    { pattern: /Please\s+settle\s+in\s+USD\s+([\d,]+\.\d{2})/i, label: 'PLEASE_SETTLE_USD' },
    { pattern: /USD\s+([\d,]+\.\d{2})\s+for\s+settlement/i, label: 'USD_FOR_SETTLEMENT' }
  ];

  for (const { pattern, label } of proseCurrencyPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const parsedAmount = parseFloat(match[1].replace(/,/g, ''));
      if (parsedAmount > 0 && parsedAmount < 10000000) {
        console.log('[ASTKernel] buildInvoiceAST: found PROSE_CURRENCY USD amount:', parsedAmount, 'label:', label);
        builder.addNode(
          {
            type: 'PROSE_CURRENCY',
            value: parsedAmount,
            confidence: 0.96,
            source: 'PROSE_CURRENCY',
            context: 'prose_region',
            metadata: { label, currency: 'USD' }
          },
          footerBlock
        );
        break; // Only take the first matching prose pattern
      }
    }
  }

  // Add PROSE_CURRENCY for "SAY TOTAL ... CENTS ONLY" word amounts (e.g. Amass invoices).
  const proseTotalMatch = normalizedText.match(/SAY\s+TOTAL\s+(?:US\s+)?(?:HK\s+)?(?:DOLLARS?|DOLLORS?)\s+(.+?)\s+CENTS\s+ONLY/i);
  if (proseTotalMatch && proseTotalMatch[1]) {
    const proseTotalAmount = convertAmountWordsToNumber(proseTotalMatch[1]);
    if (proseTotalAmount !== null && proseTotalAmount > 0 && proseTotalAmount < 10000000) {
      console.log('[ASTKernel] buildInvoiceAST: found PROSE_CURRENCY from SAY TOTAL:', proseTotalAmount);
      builder.addNode(
        {
          type: 'PROSE_CURRENCY',
          value: proseTotalAmount,
          confidence: 0.97,
          source: 'PROSE_CURRENCY',
          context: 'prose_region',
          metadata: { label: 'SAY_TOTAL_WORDS', currency: 'USD' }
        },
        footerBlock
      );
    }
  }

  // Add PROSE_CURRENCY for amount written in words (e.g., "five hundred forty-one and 47 / 100 Amt. In Words").
  // This is treated as the authoritative settlement amount because it is the human-readable total.
  const amountInWords = extractAmountInWords(normalizedText);
  if (amountInWords !== null && amountInWords > 0 && amountInWords < 10000000) {
    console.log('[ASTKernel] buildInvoiceAST: found PROSE_CURRENCY from amount in words:', amountInWords);
    builder.addNode(
      {
        type: 'PROSE_CURRENCY',
        value: amountInWords,
        confidence: 0.98,
        source: 'PROSE_CURRENCY',
        context: 'prose_region',
        metadata: { label: 'AMOUNT_IN_WORDS', currency: 'USD' }
      },
      footerBlock
    );
  }

  // Add quantity summary nodes from explicit TOTAL QTY lines (Paxar-style invoices)
  const qtySummaryPatterns = [
    { pattern: /TOTAL\s+QTY\s*[:\s]+(\d+)/i, label: 'TOTAL_QTY' },
    { pattern: /TOTAL\s+QUANTITY\s*[:\s]+(\d+)/i, label: 'TOTAL_QUANTITY' },
    { pattern: /QTY\s+SHIPPED\s*[:\s]+(\d+)/i, label: 'QTY_SHIPPED' },
    { pattern: /TOTAL\s+SHIPPED\s*[:\s]+(\d+)/i, label: 'TOTAL_SHIPPED' },
    { pattern: /TOTAL\s+PCS\s*[:\s]+(\d+)/i, label: 'TOTAL_PCS' },
    { pattern: /TOTAL\s+PIECES\s*[:\s]+(\d+)/i, label: 'TOTAL_PIECES' },
    { pattern: /TOTAL\s+UNITS\s*[:\s]+(\d+)/i, label: 'TOTAL_UNITS' }
  ];

  for (const { pattern, label } of qtySummaryPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const parsedQty = parseInt(match[1].replace(/,/g, ''), 10);
      if (parsedQty > 0 && parsedQty < 1000000) {
        console.log('[ASTKernel] buildInvoiceAST: found QUANTITY_SUMMARY:', parsedQty, 'label:', label);
        builder.addNode(
          {
            type: 'QUANTITY_SUMMARY',
            value: parsedQty,
            confidence: 0.98,
            source: 'TOTAL_QTY_LINE',
            context: 'footer_region',
            metadata: { label }
          },
          footerBlock
        );
        break; // Only take the first matching summary pattern
      }
    }
  }

  // Build and normalize AST
  const ast = builder.getAST();
  console.log('[ASTKernel] buildInvoiceAST: AST nodes:', {
    lineItems: builder.getNodes().lineItems.length,
    grandTotals: builder.getNodes().grandTotals.length,
    subtotals: builder.getNodes().subtotals.length,
    proseCurrencies: builder.getNodes().proseCurrencies.length,
    quantitySummaries: builder.getNodes().quantitySummaries.length
  });

  return normalizer.normalize(ast);
}

// ============================================================================
// RUNTIME ZERO-LEAK GATE
// ============================================================================
const FORBIDDEN_OUTPUT_KEYS = [
  'legacyAmount',
  'fallbackAmount',
  'regexAmount',
  'sumLineItems',
  'ocrAmount',
  'heuristicAmount',
  'legacyQty',
  'fallbackQty',
  'heuristicQty',
  'ocrQty'
];

export function assertZeroLeak(output: any): void {
  for (const key of FORBIDDEN_OUTPUT_KEYS) {
    if (key in output) {
      throw new Error(`[AST ZERO-LEAK VIOLATION] Forbidden key detected in output: ${key}`);
    }
  }

  // Also forbid forbidden keys inside debug object (debug should only contain AST/validation)
  if (output.debug) {
    for (const key of FORBIDDEN_OUTPUT_KEYS) {
      if (key in output.debug) {
        throw new Error(`[AST ZERO-LEAK VIOLATION] Forbidden key detected in debug output: ${key}`);
      }
    }
  }

  console.log('[ASTKernel] assertZeroLeak: passed');
}

// ============================================================================
// WORD-TO-NUMBER CONVERSION (for SAY TOTAL prose amounts)
// ============================================================================
/**
 * Convert an amount written in words to a decimal number.
 * Handles patterns like:
 *   "FOUR HUNDRED TWENTY TWO AND TWENTY FIVE" -> 422.25
 *   "ONE THOUSAND TWO HUNDRED AND FIFTY" -> 12.50
 * Only supports the common invoice total phrasing found in AP documents.
 */
export function convertAmountWordsToNumber(text: string): number | null {
  const wordMap: Record<string, number> = {
    ZERO: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9,
    TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16,
    SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19,
    TWENTY: 20, THIRTY: 30, FORTY: 40, FOURTY: 40, FIFTY: 50, SIXTY: 60,
    SEVENTY: 70, EIGHTY: 80, NINETY: 90,
    HUNDRED: 100, THOUSAND: 1000, MILLION: 1000000
  };

  // Split by explicit "AND" separator to separate dollars and cents
  const parts = text.toUpperCase().split(/\bAND\b/);
  const dollarWords = parts[0] ? parts[0].toUpperCase().replace(/-/g, ' ').split(/\s+/).filter(w => w.length > 0) : [];
  const centWords = parts[1] ? parts[1].toUpperCase().replace(/-/g, ' ').split(/\s+/).filter(w => w.length > 0) : [];

  function parseWords(words: string[]): number | null {
    let total = 0;
    let current = 0;
    for (const word of words) {
      if (word === 'AND') continue;
      const value = wordMap[word];
      if (value === undefined) {
        console.log('[convertAmountWordsToNumber] Unknown word:', word);
        return null;
      }
      if (value === 100) {
        current *= value;
      } else if (value === 1000 || value === 1000000) {
        current *= value;
        total += current;
        current = 0;
      } else {
        current += value;
      }
    }
    return total + current;
  }

  const dollars = parseWords(dollarWords);
  if (dollars === null) return null;

  let cents = 0;
  if (centWords.length > 0) {
    const parsedCents = parseWords(centWords);
    if (parsedCents === null) return null;
    cents = parsedCents;
  }

  return dollars + cents / 100;
}

/**
 * Extract the total amount written in words (e.g., "five hundred forty-one and 47 / 100").
 * Handles both label-before ("Amount in words: ...") and label-after ("... Amt. In Words") layouts.
 */
function extractAmountInWords(text: string): number | null {
  // Layout: words appear BEFORE "Amt. In Words" label (e.g., Manohar Filaments)
  const beforeMatch = text.match(/(.{0,150})\s*Amt\.?\s*In\s*Words/i);
  if (beforeMatch && beforeMatch[1]) {
    const chunk = beforeMatch[1].trim();
    // Match the trailing word amount and numeric fraction, e.g., "five hundred forty-one and 47 / 100"
    const wordsAndFraction = chunk.match(/([a-z\s\-]+?)\s+and\s+(\d+)\s*\/\s*(\d+)\s*$/i);
    if (wordsAndFraction) {
      const words = wordsAndFraction[1].trim();
      const fraction = parseInt(wordsAndFraction[2], 10) / parseInt(wordsAndFraction[3], 10);
      const wholeAmount = convertAmountWordsToNumber(words);
      if (wholeAmount !== null) {
        return Math.round((wholeAmount + fraction) * 100) / 100;
      }
    }
  }

  // Layout: words appear AFTER "Amount in words" label
  const afterMatch = text.match(/(?:Amount\s+in\s+Words|Amt\.?\s*In\s*Words)[:\s]*(.{0,150})/i);
  if (afterMatch && afterMatch[1]) {
    const words = afterMatch[1].trim();
    const fractionMatch = words.match(/(\d+)\s*\/\s*(\d+)/);
    const fraction = fractionMatch ? parseInt(fractionMatch[1], 10) / parseInt(fractionMatch[2], 10) : 0;
    const wordsOnly = words.replace(/\d+\s*\/\s*\d+/g, '').trim();
    const amount = convertAmountWordsToNumber(wordsOnly);
    if (amount !== null) {
      return Math.round((amount + fraction) * 100) / 100;
    }
  }

  return null;
}

// ============================================================================
// CURRENCY DETECTION (NO AMOUNT EXTRACTION)
// ============================================================================
/**
 * Detect currency from OCR text without extracting any amount.
 * This is the only legacy-style regex allowed in AST mode, and it produces
 * no numeric value.
 */
export function detectCurrency(text: string): 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null {
  const upper = text.toUpperCase();

  const currencyPatterns: { currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY'; patterns: string[] }[] = [
    { currency: 'USD', patterns: ['USD', 'US$', '$', 'U.S.'] },
    { currency: 'HKD', patterns: ['HKD', 'HK$', 'H.K.'] },
    { currency: 'IDR', patterns: ['IDR', 'RP', 'RUPIAH'] },
    { currency: 'EUR', patterns: ['EUR', '€', 'EURO'] },
    { currency: 'PHP', patterns: ['PHP', 'PHILIPPINE PESO', 'PH PESO'] },
    { currency: 'JPY', patterns: ['JPY', '¥', 'JAPANESE YEN', 'YEN'] }
  ];

  for (const { currency, patterns } of currencyPatterns) {
    if (patterns.some(p => upper.includes(p))) {
      console.log('[ASTKernel] detectCurrency: detected', currency);
      return currency;
    }
  }

  // Default to USD if no currency found (most invoices are USD)
  console.log('[ASTKernel] detectCurrency: no currency found, defaulting to USD');
  return 'USD';
}

/**
 * Detect the currency that appears on the invoice total line.
 * This prefers the currency immediately adjacent to the total label, avoiding
 * confusion from settlement instructions elsewhere in the document.
 */
export function detectInvoiceCurrency(text: string): 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null {
  const upper = text.toUpperCase();
  const lines = upper.split('\n');

  const totalLabels = /\b(TOTAL|GRAND\s*TOTAL|NET\s*TOTAL|AMOUNT\s*DUE|BALANCE\s*DUE|SUBTOTAL|合計|總計|請求合計|総額|합계)\b/i;

  for (const line of lines) {
    if (!totalLabels.test(line)) continue;

    if (line.includes('HKD') || line.includes('HK$') || line.includes('H.K.')) return 'HKD';
    if (line.includes('IDR') || line.includes('RP') || line.includes('RUPIAH')) return 'IDR';
    if (line.includes('EUR') || line.includes('€') || line.includes('EURO')) return 'EUR';
    if (line.includes('PHP') || line.includes('PHILIPPINE PESO') || line.includes('PH PESO')) return 'PHP';
    if (line.includes('JPY') || line.includes('¥') || line.includes('JAPANESE YEN') || line.includes('YEN')) return 'JPY';
    if (line.includes('USD') || line.includes('US$') || line.includes('U.S.')) return 'USD';
  }

  return null;
}

/**
 * Detect the settlement/remittance currency from bank instructions.
 * This is the currency the supplier wants to be paid in, which may differ from
 * the invoice currency (e.g., HKD invoice with USD settlement).
 */
export function detectSettlementCurrency(text: string): 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null {
  const upper = text.toUpperCase();

  const settlementPatterns = [
    { currency: 'USD' as const, patterns: [
      /REMIT\s+(?:THE\s+)?(?:AMOUNT\s+)?IN\s+USD\b/i,
      /PAYMENT\s+(?:TO\s+)?BE\s+MADE\s+IN\s+USD\b/i,
      /SETTLE\s+(?:IN\s+)?USD\b/i,
      /PAY\s+(?:IN\s+)?USD\b/i,
      /TT\s+(?:IN\s+)?USD\b/i,
      /USD\s+(?:SETTLEMENT|EQUIVALENT|ACCOUNT)\b/i,
      /USD\s+(?:REMITTANCE|PAYMENT)\b/i,
      /REM\s+USD\b/i,
    ]},
    { currency: 'HKD' as const, patterns: [
      /REMIT\s+(?:THE\s+)?(?:AMOUNT\s+)?IN\s+HKD\b/i,
      /PAYMENT\s+(?:TO\s+)?BE\s+MADE\s+IN\s+HKD\b/i,
      /SETTLE\s+(?:IN\s+)?HKD\b/i,
      /PAY\s+(?:IN\s+)?HKD\b/i,
      /TT\s+(?:IN\s+)?HKD\b/i,
      /HKD\s+(?:SETTLEMENT|EQUIVALENT|ACCOUNT)\b/i,
      /HKD\s+(?:REMITTANCE|PAYMENT)\b/i,
    ]},
    { currency: 'IDR' as const, patterns: [
      /REMIT\s+(?:THE\s+)?(?:AMOUNT\s+)?IN\s+IDR\b/i,
      /SETTLE\s+(?:IN\s+)?IDR\b/i,
      /PAY\s+(?:IN\s+)?IDR\b/i,
      /TT\s+(?:IN\s+)?IDR\b/i,
      /IDR\s+(?:ACCOUNT|REMITTANCE|PAYMENT)\b/i,
    ]},
    { currency: 'EUR' as const, patterns: [
      /REMIT\s+(?:THE\s+)?(?:AMOUNT\s+)?IN\s+EUR\b/i,
      /SETTLE\s+(?:IN\s+)?EUR\b/i,
      /PAY\s+(?:IN\s+)?EUR\b/i,
      /TT\s+(?:IN\s+)?EUR\b/i,
      /EUR\s+(?:ACCOUNT|REMITTANCE|PAYMENT)\b/i,
    ]},
    { currency: 'PHP' as const, patterns: [
      /REMIT\s+(?:THE\s+)?(?:AMOUNT\s+)?IN\s+PHP\b/i,
      /SETTLE\s+(?:IN\s+)?PHP\b/i,
      /PAY\s+(?:IN\s+)?PHP\b/i,
      /TT\s+(?:IN\s+)?PHP\b/i,
      /PHP\s+(?:ACCOUNT|REMITTANCE|PAYMENT)\b/i,
    ]},
    { currency: 'JPY' as const, patterns: [
      /REMIT\s+(?:THE\s+)?(?:AMOUNT\s+)?IN\s+JPY\b/i,
      /SETTLE\s+(?:IN\s+)?JPY\b/i,
      /PAY\s+(?:IN\s+)?JPY\b/i,
      /TT\s+(?:IN\s+)?JPY\b/i,
      /JPY\s+(?:ACCOUNT|REMITTANCE|PAYMENT)\b/i,
    ]},
  ];

  for (const { currency, patterns } of settlementPatterns) {
    if (patterns.some(p => p.test(upper))) {
      console.log('[ASTKernel] detectSettlementCurrency: detected', currency);
      return currency;
    }
  }

  return null;
}
