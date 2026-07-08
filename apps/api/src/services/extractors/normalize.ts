/**
 * Text normalization utilities for OCR-extracted invoice text.
 */

/**
 * Normalize OCR-fragmented digit sequences in amount/total contexts only.
 *
 * Uses a 2-line context window to detect total/amount lines (including Asian labels).
 * Skips lines that are clearly quantity lines (Qty, PCS, Units, etc.) to avoid
 * collapsing spaces between unrelated quantity tokens.
 *
 * Collapses spaces using a thousands-group-aware regex: only "digit space exactly 3 digits"
 * is collapsed, repeated until stable. This prevents collapsing "3 3 . 3 0" incorrectly,
 * while still fixing "1 234 567.00".
 */
export function normalizeOCRAmounts(text: string): string {
  const amountContextPattern = /TOTAL|GRAND|AMOUNT|DUE|BALANCE|NET|SAY\s+TOTAL|SUB\s*TOTAL|SUBTOTAL|合計|請求合計|お支払い金額|総額|总计|合计|金额合计|应付金额|합계|총액|USD|HKD|IDR|EUR|PHP|JPY|CNY|US\$|HK\$|\$|€|¥|£/i;
  const quantityLinePattern = /\b(?:QTY|QUANTITY|PCS|PIECES|UNITS|EA|EA\.?| EACH | PER )\b/i;
  const datePattern = /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/;

  const lines = text.split('\n');

  const normalizedLines = lines.map((line, index) => {
    // Skip lines that are clearly quantity lines
    if (quantityLinePattern.test(line)) {
      return line;
    }

    // Skip lines that contain a date pattern
    if (datePattern.test(line)) {
      return line;
    }

    const prevLine = lines[index - 1] || '';
    const nextLine = lines[index + 1] || '';
    const context = `${prevLine}\n${line}\n${nextLine}`;

    // Only normalize if the 3-line window looks like an amount/total context
    if (!amountContextPattern.test(context)) {
      return line;
    }

    // Collapse "digit space exactly 3 digits" in a loop (thousands separators)
    let collapsed = line;
    let previous;
    do {
      previous = collapsed;
      collapsed = collapsed.replace(/(\d)\s+(\d{3})(?=\s|,|\.|$)/g, '$1$2');
    } while (collapsed !== previous);

    // Also compact fragmented decimals like "3 3 . 3 0" if they're in an amount context
    collapsed = collapsed.replace(/(\d)\s*\.\s*(\d+)/g, '$1.$2');

    return collapsed;
  });

  return normalizedLines.join('\n');
}

/**
 * Normalize invoice text for downstream extraction.
 * Preserves line breaks for line-item and total detection.
 */
export function normalizeInvoiceText(text: string): string {
  let normalized = text;

  // Normalize full-width digits (０-９) to half-width (0-9) — common in Chinese invoices
  normalized = normalized.replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  // Normalize full-width comma (，) and period (．) to half-width
  normalized = normalized.replace(/\uff0c/g, ',');
  normalized = normalized.replace(/\uff0e/g, '.');

  // Merge broken lines (lines that end with a word and next line starts with lowercase)
  normalized = normalized.replace(/([a-zA-Z])\n([a-z])/g, '$1$2');

  // Merge broken MPO patterns (e.g., MPO153\n71 -> MPO15371)
  normalized = normalized.replace(/(MPO[\s_-]*\d+)\n(\d+)/gi, '$1$2');

  // Merge broken labels (e.g., INVOICE\nNO -> INVOICE NO)
  normalized = normalized.replace(/([A-Z]+)\n([A-Z:]+)/g, '$1 $2');

  // Normalize horizontal whitespace (tabs, multiple spaces) but PRESERVE line breaks.
  // Line breaks are needed by line-item extraction and AST multi-page total detection.
  normalized = normalized.replace(/[ \t]+/g, ' ');

  // Remove duplicate spaces (within lines)
  normalized = normalized.replace(/ {2,}/g, ' ');

  // Compact OCR-fragmented decimal numbers (e.g., "0 . 01000" -> "0.01000", "77 . 17" -> "77.17")
  normalized = normalized.replace(/(\d)\s*\.\s*(\d+)/g, '$1.$2');

  // Compact OCR-fragmented comma-separated numbers (e.g., "1 , 131" -> "1,131", "2 , 263" -> "2,263")
  let prevNormalized;
  do {
    prevNormalized = normalized;
    normalized = normalized.replace(/(\d)\s*,\s*(\d{3})(?=\D|$)/g, '$1,$2');
  } while (normalized !== prevNormalized);

  // Compact OCR-fragmented UOMs and currency symbols
  normalized = normalized.replace(/\bP\s+C\s+S\b/gi, 'PCS');
  normalized = normalized.replace(/\bU\s+N\s+I\s+T\b/gi, 'UNIT');
  normalized = normalized.replace(/\bE\s+A\s+C\s+H\b/gi, 'EACH');
  normalized = normalized.replace(/\bE\s+A\b/gi, 'EA');
  normalized = normalized.replace(/\bP\s+C\b/gi, 'PC');
  normalized = normalized.replace(/\bU\s+S\s*\$\b/gi, 'US$');
  normalized = normalized.replace(/\bH\s+K\s*\$\b/gi, 'HK$');
  normalized = normalized.replace(/\bC\s+F\s+R\b/gi, 'CFR');
  normalized = normalized.replace(/\bF\s+O\s+B\b/gi, 'FOB');

  // Normalize full-width colons (e.g., Chinese/Japanese ：) to half-width colons
  normalized = normalized.replace(/：/g, ':');

  // Fix OCR fragmentation around colons
  normalized = normalized.replace(/: +/g, ': ');

  // Compact OCR-fragmented digit sequences in amount/total contexts only.
  normalized = normalizeOCRAmounts(normalized);

  // Compact fragmented common labels (spaces between letters)
  normalized = normalized.replace(/\b(I)\s*\/\s*(V)\s*(N)\s*(O?)\s*(\.?)\b/gi, '$1/$2$3$4$5');
  normalized = normalized.replace(/\b(A)\s*\/\s*(C)\s*(N)\s*(O?)\s*(\.?)\b/gi, '$1/$2$3$4$5');
  normalized = normalized.replace(/\b(T)\s*\.\s*(T)\s*\.\b/gi, '$1.$2.');

  // Normalize labels where OCR removed the space (e.g., "I/VNO." -> "I/V NO.", "A/CNO." -> "A/C NO.")
  normalized = normalized.replace(/(I\/V)(NO\.?)/gi, '$1 $2');
  normalized = normalized.replace(/(A\/C)(NO\.?)/gi, '$1 $2');

  // Normalize OCR misreadings of "PO" (e.g., "P/0 #", "P/0#", "P/O #")
  normalized = normalized.replace(/\bP\s*[\/0]\s*O\s*#?\b/gi, 'PO#');

  // Compact spaced company-name fragments followed by a word (e.g., "K A J I DOME" -> "KAJIDOME")
  normalized = normalized.replace(/([A-Z])(?:\s+[A-Z]){2,}\s+([A-Z][a-zA-Z]+)\b/g, (match) => match.replace(/\s+/g, ''));

  // Compact spaced uppercase letter sequences (e.g., "R E M I T T A N C E" -> "REMITTANCE")
  normalized = normalized.replace(/([A-Z])(?:\s+[A-Z]){4,}/g, (match) => match.replace(/\s+/g, ''));

  // Remove spaces around dashes in letter-digit patterns (e.g., "T - 26908962" -> "T-26908962")
  normalized = normalized.replace(/([A-Z])\s*-\s*(\d{4,})/g, '$1-$2');

  // Heavily-spaced OCR (Kajidome-style): inject synthetic line breaks before table keywords
  const lineCount = normalized.split('\n').filter(l => l.trim()).length;
  if (lineCount <= 3) {
    normalized = normalized.replace(/\b(DESCRIPTION OF GOODS|HSCODE|QTY|UNIT PRICE|AMOUNT|FREIGHT|BANK|PAYMENT|ORIGIN|REMARKS)\b/gi, '\n$1');
    normalized = normalized.replace(/\b(USD|US\$|HKD|HK\$|EUR|€|JPY|¥)\s*([\d\s,.]+\d)/gi, '\n$1$2');
    normalized = normalized.replace(/\b(\d[\d\s,.]*(?:PCS|UNIT|EA|Each))\b/gi, '\n$1');
    normalized = normalized.replace(/\b(TOTAL)\b/gi, '\n$1');
  }

  return normalized.trim();
}
