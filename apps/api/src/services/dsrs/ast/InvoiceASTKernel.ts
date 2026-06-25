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
    output.debug = {
      ast: repairedAst,
      validation: validationReport
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
                        /\d+\s+Each\s+[\d.]+\s+[\d.]+/i.test(normalizedText);

  if (hasAveryTable) {
    console.log('[ASTKernel] buildInvoiceAST: detected Avery-style QTY SHIPPED table');
    const averyPattern = /(\d+)\s+Each\s+([\d.]+)\s+([\d.]+)/gi;
    const existingKeys = new Set(lineItems.map(i => `${i.quantity}_${i.unitPrice}_${i.extendedPrice}`));
    while ((match = averyPattern.exec(normalizedText)) !== null) {
      const quantity = parseInt(match[1], 10);
      const unitPrice = parseFloat(match[2]);
      const extendedPrice = parseFloat(match[3]);
      const key = `${quantity}_${unitPrice}_${extendedPrice}`;

      // Skip lines that look like totals/subtotals (e.g., "0.00 7.99")
      if (quantity <= 0 || unitPrice <= 0 || extendedPrice <= 0) continue;

      if (existingKeys.has(key)) {
        console.log('[ASTKernel] buildInvoiceAST: skipping duplicate Avery line item:', key);
        continue;
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
    }
  }

  // General fallback for USD/PCS-style line items only if no line items were provided at all.
  // This avoids overriding already-extracted SKU-based line items for other brands.
  if (lineItems.length === 0) {
    const generalLineItemPattern = /(\d+)\s+(?:USD|PCS|Pcs|EA|pc|pieces?)\s+([\d.]+)\s+([\d.]+)/gi;
    const existingKeys = new Set(lineItems.map(i => `${i.quantity}_${i.unitPrice}_${i.extendedPrice}`));
    while ((match = generalLineItemPattern.exec(normalizedText)) !== null) {
      const quantity = parseInt(match[1], 10);
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
  hasPer1000Pcs = /(?:1000\s*PCS|PER\s+1000\s*PCS|1000\s*Pcs|dalam\s+1000\s*Pcs)/i.test(normalizedText);
  if (hasPer1000Pcs) {
    console.log('[ASTKernel] buildInvoiceAST: detected per-1000-PCS pricing format');
    const per1000Pattern = /([\d.]+)\s+([\d.]+)\s+(\d+)\s+(?:PCS|Pcs|EA|Each|pieces?)/gi;
    const existingKeys = new Set(
      builder.getNodes().lineItems.map(i => `${i.metadata?.quantity}_${i.metadata?.unitPrice}_${i.metadata?.extendedPrice}`)
    );
    while ((match = per1000Pattern.exec(normalizedText)) !== null) {
      const firstDecimal = parseFloat(match[1]);
      const secondDecimal = parseFloat(match[2]);
      const quantity = parseInt(match[3], 10);

      if (quantity <= 0 || firstDecimal <= 0 || secondDecimal <= 0) continue;

      // The smaller decimal is the actual extended price (total); the larger is unit price per 1000 pcs.
      const extendedPrice = Math.min(firstDecimal, secondDecimal);
      const unitPrice = extendedPrice / quantity;
      const key = `${quantity}_${unitPrice}_${extendedPrice}`;

      if (existingKeys.has(key)) continue;
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

  // Add GRAND TOTAL nodes from TOTAL lines, with multi-page awareness.
  // If page boundaries are available, prefer the LAST page's total match (real fix for G&F Trading).
  const totalKeywords = ['total', 'say total', 'grand total', 'total amount', 'amount due', 'balance due', 'net total', 'net amount', 'sub total', 'subtotal'];

  // Collect all candidate total lines with their page index.
  // For each total line, prefer numbers with currency context (USD, $, HKD, etc.) over bare numbers.
  const totalCandidates: { pageIndex: number; line: string; amount: number; label: string; hasCurrencyContext: boolean }[] = [];
  const pageTexts = pages && pages.length > 0 ? pages : [normalizedText];

  // Currency context regex: symbol/label immediately before or after the number
  const currencyContextPattern = /(?:USD|HKD|IDR|EUR|PHP|JPY|US\$|HK\$|\$|€|¥)\s*([0-9,]+\.[0-9]{2,3})|([0-9,]+\.[0-9]{2,3})\s*(?:USD|HKD|IDR|EUR|PHP|JPY)/i;

  for (let pageIndex = 0; pageIndex < pageTexts.length; pageIndex++) {
    const pageText = pageTexts[pageIndex];
    const pageLines = pageText.split('\n');
    for (const line of pageLines) {
      const upperLine = line.toUpperCase();
      if (totalKeywords.some(keyword => upperLine.includes(keyword.toUpperCase()))) {
        const lineNumbers = line.match(/([0-9,]+\.[0-9]{2,3})/g);
        if (lineNumbers && lineNumbers.length > 0) {
          const parsedAmounts = lineNumbers
            .map((n: string) => parseFloat(n.replace(/,/g, '')))
            .filter((n: number) => n > 0 && n < 10000000);
          if (parsedAmounts.length > 0) {
            const currencyMatch = line.match(currencyContextPattern);
            const currencyAmount = currencyMatch
              ? parseFloat((currencyMatch[1] || currencyMatch[2]).replace(/,/g, ''))
              : null;
            const selectedAmount = currencyAmount && parsedAmounts.includes(currencyAmount)
              ? currencyAmount
              : Math.max(...parsedAmounts);
            const hasCurrencyContext = currencyAmount !== null;
            const label = line.match(/(TOTAL|GRAND|AMOUNT|DUE|BALANCE|NET)/i)?.[0] || 'TOTAL';
            totalCandidates.push({ pageIndex, line, amount: selectedAmount, label, hasCurrencyContext });
          }
        }
      }
    }
  }

  // Log all candidates for debugging
  if (totalCandidates.length > 0) {
    console.log('[ASTKernel] buildInvoiceAST: GRAND_TOTAL candidates:', totalCandidates.map(c => ({
      page: c.pageIndex,
      label: c.label,
      amount: c.amount,
      hasCurrencyContext: c.hasCurrencyContext,
      line: c.line.substring(0, 80)
    })));
  }

  // If multiple pages have total candidates, prefer the LAST page's match.
  // On the same page, prefer candidates with currency context, then the largest amount.
  if (totalCandidates.length > 0) {
    const maxPageIndex = Math.max(...totalCandidates.map(c => c.pageIndex));
    const lastPageCandidates = totalCandidates.filter(c => c.pageIndex === maxPageIndex);
    const selectedTotal = lastPageCandidates.reduce((best, current) => {
      if (current.hasCurrencyContext && !best.hasCurrencyContext) return current;
      if (best.hasCurrencyContext && !current.hasCurrencyContext) return best;
      return current.amount > best.amount ? current : best;
    });

    console.log('[ASTKernel] buildInvoiceAST: selected GRAND_TOTAL from page', selectedTotal.pageIndex, ':', selectedTotal.amount);
    builder.addNode(
      {
        type: 'GRAND_TOTAL',
        value: selectedTotal.amount,
        confidence: selectedTotal.hasCurrencyContext ? 0.99 : 0.98,
        source: 'TOTAL_LINE',
        context: `footer_region_page_${selectedTotal.pageIndex}`,
        metadata: { label: selectedTotal.label, pageIndex: selectedTotal.pageIndex, hasCurrencyContext: selectedTotal.hasCurrencyContext }
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
