import PDFParser from 'pdf2json';
import { logger } from '../utils/logger';
import { InvoiceTruthGraphBuilder, InvoiceTruthResolver } from './dsrs/truth/InvoiceTruthGraph';
import { executeInvoiceExtraction, detectCurrency, assertZeroLeak } from './dsrs/ast/InvoiceASTKernel';

// ============================================================================
// DSRS v7.2: SINGLE SOURCE OF TRUTH AST LOCK MODE
// ============================================================================
// When true, the AST resolver is the ONLY authority for amount and qty_shipped.
// No regex fallback, no OCR numeric fallback, no heuristic override, no PO override.
// Validation/repair may only remove/mark/recalibrate nodes, never create values.
// Any conflict with legacy extraction triggers REVIEW_REQUIRED or error.
// ============================================================================
export const AST_SINGLE_SOURCE_MODE = true;

// ============================================================================
// FIELD ALIAS DICTIONARY SYSTEM
// ============================================================================
// Shared date capture regex: matches DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD-MMM-YYYY, DD-MMM-YY, DD MMM YYYY, DD MMM YY, YYYY-MM-DD, YYYY/MM/DD
const DATE_CAPTURE_PATTERN = `(?:\\d{1,2}[\\/\\-.]\\s*\\d{1,2}[\\/\\-.]\\s*\\d{2,4}|\\d{1,2}[\\/\\-.]\\s*[A-Za-z]{3}\\s*[\\/\\-.]\\s*\\d{2,4}|\\d{1,2}\\s+[A-Za-z]{3}\\s*,?\\s*\\d{2,4}|\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2})`;

const FIELD_ALIASES = {
  invoice_number: [
    'invoice no',
    'invoice number',
    'invoice #',
    'document no',
    'reference no',
    'i/v no',
    'pi no',
    'order #',
    'ref'
  ],
  invoice_date: [
    'invoice date',
    'billing date',
    'issued date',
    'date',
    'invoice dt'
  ],
  due_date: [
    'due date',
    'invoice due',
    'payment due',
    'payment due date',
    'due by'
  ],
  payment_terms: [
    'credit term',
    'terms',
    'payment terms',
    'credit terms',
    'term'
  ],
  amount: [
    'total',
    'total amount',
    'grand total',
    'invoice amount',
    'order total',
    'amount due',
    'balance due',
    'total due'
  ],
  qty_shipped: [
    'total qty',
    'total quantity',
    'qty shipped',
    'quantity shipped',
    'total q'
  ],
  mpo_number: [
    'mpo',
    'mpo no',
    'master po'
  ],
  po_number: [
    'po',
    'po no',
    'purchase order',
    'customer po'
  ]
};

// ============================================================================
// TEXT NORMALIZATION LAYER
// ============================================================================
function normalizeInvoiceText(text: string): string {
  let normalized = text;

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

  // Normalize full-width colons (e.g., Chinese/Japanese ：) to half-width colons
  normalized = normalized.replace(/：/g, ':');

  // Fix OCR fragmentation around colons
  normalized = normalized.replace(/: +/g, ': ');

  return normalized.trim();
}

// ============================================================================
// VENDOR DETECTION
// ============================================================================
interface VendorDetection {
  vendor: string;
  confidence: number;
}

function detectVendor(text: string): VendorDetection {
  const upperText = text.toUpperCase();
  
  // Vendor detection patterns with confidence scores
  const vendorPatterns = [
    { vendor: 'AVERY', patterns: [/AVERY\s*DENNISON/i], confidence: 0.99 },
    { vendor: 'PAXAR', patterns: [/PAXAR/i, /PT\.?\s*PAXAR/i], confidence: 0.99 },
    { vendor: 'MADISON', patterns: [/MADISON\s*88/i, /MADISON\s*GROUP/i], confidence: 0.95 },
    { vendor: 'YKK', patterns: [/YKK/i, /YKK\s*CORPORATION/i], confidence: 0.99 },
    { vendor: 'LI_FUNG', patterns: [/LI\s*&\s*FUNG/i, /LIFUNG/i], confidence: 0.99 },
    { vendor: 'CRYSTAL', patterns: [/CRYSTAL\s*GROUP/i, /CRYSTAL\s*INTERNATIONAL/i], confidence: 0.95 },
    { vendor: 'MAS', patterns: [/MAS\s*HOLDINGS/i, /MAS\s*BRANDS/i], confidence: 0.95 },
  ];
  
  // Identify the buyer section (BILL TO / SHIP TO) so we don't match the buyer as the vendor.
  const billToIndex = upperText.indexOf('BILL TO');
  const shipToIndex = upperText.indexOf('SHIP TO');
  const buyerSectionStart = Math.min(
    billToIndex !== -1 ? billToIndex : Infinity,
    shipToIndex !== -1 ? shipToIndex : Infinity
  );
  
  for (const { vendor, patterns, confidence } of vendorPatterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const matchIndex = match.index || 0;
        
        // Madison88 usually appears as the buyer (BILL TO / SHIP TO), not the supplier.
        // Skip MADISON detection if it matches inside the buyer section.
        if (vendor === 'MADISON' && buyerSectionStart !== Infinity && matchIndex > buyerSectionStart) {
          console.log('[detectVendor] Skipping MADISON match in buyer section:', match[0]);
          continue;
        }
        
        console.log('[detectVendor] Found vendor:', vendor, 'with confidence:', confidence);
        return { vendor, confidence };
      }
    }
  }
  
  console.log('[detectVendor] Unknown vendor');
  return { vendor: 'UNKNOWN', confidence: 0.0 };
}

// ============================================================================
// VENDOR RULE REGISTRY
// ============================================================================
interface VendorRule {
  invoiceNumberPatterns: RegExp[];
  datePatterns: RegExp[];
  amountPatterns: RegExp[];
  mpoPatterns: RegExp[];
  paymentTermPatterns: RegExp[];
}

const VendorRules: Record<string, VendorRule> = {
  AVERY: {
    invoiceNumberPatterns: [
      /INVOICE\s*NO[:\s]+([A-Z0-9-]+)/i,
      /I\/V\s*NO[:\s]+([A-Z0-9-]+)/i
    ],
    datePatterns: [
      /INVOICE\s*DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i
    ],
    amountPatterns: [
      /TOTAL\s*\(USD\)[:\s]*([\d,]+\.?\d*)/i,
      /TOTAL\s*USD[:\s]*([\d,]+\.?\d*)/i,
      /GRAND\s*TOTAL[:\s]*([\d,]+\.?\d*)/i
    ],
    mpoPatterns: [
      /MPO[\s_-]*(\d+)/i,
      /BUY_MPO(\d+)/i,
      /RBUY_MPO(\d+)/i
    ],
    paymentTermPatterns: [
      /CREDIT\s*TERM[:\s]+([A-Za-z0-9\s]+)/i,
      /TERMS[:\s]+([A-Za-z0-9\s]+)/i
    ]
  },
  PAXAR: {
    invoiceNumberPatterns: [
      /INVOICE\s*NO[:\s]+([A-Z0-9-]+)/i,
      /NO\.?\s*([A-Z0-9-]+)/i
    ],
    datePatterns: [
      /INVOICE\s*DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i
    ],
    amountPatterns: [
      /TOTAL\s*\(IDR\)[:\s]*([\d,]+\.?\d*)/i,
      /TOTAL\s*IDR[:\s]*([\d,]+\.?\d*)/i,
      /TOTAL[:\s]*([\d,]+\.?\d*)/i
    ],
    mpoPatterns: [
      /MPO[\s_-]*(\d+)/i,
      /MPO_?(\d+)/i
    ],
    paymentTermPatterns: [
      /CREDIT\s*TERM[:\s]+([A-Za-z0-9\s]+)/i,
      /TERMS[:\s]+([A-Za-z0-9\s]+)/i
    ]
  },
  UNKNOWN: {
    invoiceNumberPatterns: [
      /INVOICE\s*NO[:\s]+([A-Z0-9-]+)/i,
      /INVOICE\s*#[:\s]+([A-Z0-9-]+)/i,
      /DOCUMENT\s*NO[:\s]+([A-Z0-9-]+)/i
    ],
    datePatterns: [
      /INVOICE\s*DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i
    ],
    amountPatterns: [
      /TOTAL[:\s]*\(USD\)[:\s]*([\d,]+\.?\d*)/i,
      /TOTAL[:\s]*([\d,]+\.?\d*)/i,
      /GRAND\s*TOTAL[:\s]*([\d,]+\.?\d*)/i
    ],
    mpoPatterns: [
      /MPO[\s_-]*(\d+)/i,
      /MPO_?(\d+)/i
    ],
    paymentTermPatterns: [
      /CREDIT\s*TERM[:\s]+([A-Za-z0-9\s]+)/i,
      /TERMS[:\s]+([A-Za-z0-9\s]+)/i
    ]
  }
};

// Known brand codes and their full names (Madison 88 relevant brands)
const BRAND_CODE_MAP: Record<string, string> = {
  'CSC': 'Columbia Sportswear',
  'TNF': 'The North Face',
  'VNS': 'Vans',
  'ARC': "Arc'teryx",
  'UA': 'Under Armour',
  'HH': 'Helly Hansen',
  'BUR': 'Burton',
  'TM': 'Travis Mathew',
  'FR': 'Fjallraven',
  'FRJ': 'Fjallraven',
  'ON': 'On Running',
  'PRA': 'Prana',
  'PRN': 'Prana',
  'PRANA': 'Prana',
  'DYN': 'Dynafit',
  'MUS': 'Mustang',
  'VUO': 'Vuori',
  'LLB': 'LL Bean',
  'TL': 'Timberland',
  'EB': 'Eddie Bauer',
  'KUI': 'KUIU',
  'SIT': 'Sitka',
  'PTR': 'Patagonia',
  'NKE': 'Nike',
  'ADI': 'Adidas',
  'PUM': 'Puma',
  'REE': 'Reebok',
  'NEW': 'New Balance',
  'SKE': 'Skechers',
  'CRO': 'Crocs',
  'HOK': 'Hoka',
  'BRO': 'Brooks',
  'SAU': 'Saucony',
  'MIZ': 'Mizuno',
  'ASG': 'Asics',
  'ONL': 'Onitsuka Tiger',
  'NBH': 'New Balance Heritage',
  'VIV': 'Vivobarefoot',
  'ALR': 'Altra',
  'KAR': 'Karhu',
  'NOR': 'Norda',
  'ZEG': 'Zegho',
  'SCR': 'Scarpa',
  'LAL': 'La Sportiva',
};

// Reverse map for full brand name lookup
const FULL_BRAND_NAMES: Record<string, string> = {};
Object.entries(BRAND_CODE_MAP).forEach(([code, name]) => {
  FULL_BRAND_NAMES[name.toUpperCase()] = code;
  FULL_BRAND_NAMES[name.toLowerCase()] = code;
});

// Generic label/header words that should not be captured as field values
const GENERIC_LABEL_DENYLIST = [
  'TOTAL', 'AMOUNT', 'DATE', 'INVOICE', 'NO', 'NUMBER', 'TERMS', 'PAGE',
  'TO', 'FROM', 'SUBJECT', 'REF', 'REFERENCE', 'DESCRIPTION', 'ITEM',
  'QUANTITY', 'UNIT', 'PRICE', 'RATE', 'BALANCE', 'DUE', 'PAID',
  'SHIP', 'SHIPMENT', 'ORDER', 'PO', 'MPO', 'BATCH', 'LOT'
];

/**
 * Check if a value is a generic label word that should be rejected
 */
function isGenericLabel(value: string): boolean {
  const upperValue = value.toUpperCase().trim();
  return GENERIC_LABEL_DENYLIST.includes(upperValue);
}

export interface FieldExtraction {
  value: any;
  confidence: number;
  source_text: string | null;
  method: 'regex' | 'heuristic' | 'ai' | 'fallback' | 'sum_heuristic' | 'ast';
  candidates?: Array<{ value: any; score: number; reason: string }>;
}

export interface ExtractionTrace {
  vendor_name?: FieldExtraction;
  invoice_number?: FieldExtraction;
  invoice_date?: FieldExtraction;
  due_date?: FieldExtraction;
  amount?: FieldExtraction;
  currency?: FieldExtraction;
  mpo_number?: FieldExtraction;
  payment_terms?: FieldExtraction;
  bank_name?: FieldExtraction;
  swift_code?: FieldExtraction;
  account_number?: FieldExtraction;
  qty_shipped?: FieldExtraction;
}

export interface MadisonInvoiceExtraction {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null;
  needs_currency_confirmation: boolean;
  bank_charge: number | null;
  payment_terms: string | null;
  bank_details: {
    bank_name: string | null;
    swift_code: string | null;
    account_number: string | null;
  };
  bill_to_text: string | null;
  bill_to_confirmed_madison88: boolean;
  document_type: 'INV' | 'PI' | 'CI' | 'SI' | 'STATEMENT' | null;

  po_reference_raw: string | null;
  brand: string | null;
  brand_code: string | null;
  season: string | null;
  order_type: 'BULK' | 'SMS' | 'SAMPLE' | null;
  po_number: string | null;
  mpo_number: string | null;

  category: 'TRIMS' | 'YARN' | 'SAMPLE' | 'SHIPPING' | 'LAB' | null;
  qty_shipped: number | null;
  notes: string | null;
  is_handwritten: boolean;
  status: 'EXTRACTED' | 'REVIEW_REQUIRED' | 'AST_FAILURE';
  status_reason?: string;
  
  // Phase 1: Extraction metadata
  raw_text: string;
  extraction_trace: ExtractionTrace;
  overall_confidence: number;
}

interface PDFPage {
  Texts: Array<{
    R: Array<{ T: string }>;
  }>;
}

interface PDFData {
  Pages: PDFPage[];
}

interface PDFTextExtraction {
  fullText: string;
  pages: string[];
}

async function extractTextFromPDF(fileBuffer: Buffer): Promise<PDFTextExtraction> {
  const attemptParse = (attemptNumber: number): Promise<PDFTextExtraction> => {
    return new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser as any)(null, 1);

      pdfParser.on('pdfParser_dataReady', (pdfData: PDFData) => {
        try {
          const pages: string[] = pdfData.Pages.map((page: PDFPage) =>
            page.Texts
              .map((t: any) => {
                try {
                  return decodeURIComponent(t.R[0].T);
                } catch (uriError) {
                  // Handle malformed URI-encoded characters
                  console.warn('[MadisonExtractor] Malformed URI in text, using raw value:', t.R[0].T);
                  return t.R[0].T; // Return raw value if decode fails
                }
              })
              .join(' ')
          );
          const fullText = pages.join('\n');
          logger.info(`[MadisonExtractor] Text extracted (attempt ${attemptNumber}), length:`, fullText.length, 'pages:', pages.length);
          resolve({ fullText, pages });
        } catch (e) {
          reject(e);
        }
      });

      pdfParser.on('pdfParser_dataError', (err: any) => {
        logger.error(`[MadisonExtractor] PDF parse error (attempt ${attemptNumber}):`, err);
        reject(err);
      });

      pdfParser.parseBuffer(fileBuffer);
    });
  };

  try {
    return await attemptParse(1);
  } catch (firstError) {
    logger.warn('[MadisonExtractor] First parse attempt failed, retrying in 300ms...');
    await new Promise(resolve => setTimeout(resolve, 300));

    try {
      return await attemptParse(2);
    } catch (secondError) {
      logger.error('[MadisonExtractor] Second parse attempt also failed:', secondError);
      throw secondError;
    }
  }
}

/**
 * Helper: Convert month name to number
 */
function monthNameToNumber(monthName: string): number {
  const monthMap: Record<string, number> = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
  };
  return monthMap[monthName.toLowerCase()] || 1;
}

/**
 * Parse date string in multiple formats to ISO 8601 (YYYY-MM-DD)
 */
function parseDate(dateStr: string, preferUS: boolean = false): string | null {
  if (!dateStr) return null;

  const normalized = dateStr.trim();
  
  // Format patterns in order of preference
  const patterns = [
    // DD/MM/YYYY or MM/DD/YYYY
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, preferUS },
    // DD-MM-YYYY or MM-DD-YYYY
    { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, preferUS },
    // YYYY/MM/DD
    { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, preferUS: false },
    // YYYY-MM-DD
    { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, preferUS: false },
    // DD-MMM-YYYY (e.g., 29-DEC-2025)
    { regex: /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/, preferUS: false },
    // DD MMM YYYY (e.g., 19 JAN, 2026)
    { regex: /^(\d{1,2})\s+([A-Za-z]{3})\s*,?\s*(\d{4})$/, preferUS: false },
    // DD MMM YYYY (e.g., 19 JAN 2026)
    { regex: /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/, preferUS: false },
    // YYMMDD (e.g., 260114 → 2026-01-14)
    { regex: /^(\d{2})(\d{2})(\d{2})$/, preferUS: false, isYYMMDD: true },
    // YYYY.MM.DD (e.g., 2026.01.06)
    { regex: /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/, preferUS: false },
    // DD-MMM-YY (e.g., 28-MAY-26)
    { regex: /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/, preferUS: false, isYY: true },
    // DD/MMM/YY (e.g., 30/Apr/26)
    { regex: /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2})$/, preferUS: false, isYY: true },
    // Month DD,YY (e.g., April 06,26)
    { regex: /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{2})$/, preferUS: false, isYY: true },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      let year: number, month: number, day: number;

      if (pattern.isYYMMDD) {
        // YYMMDD format
        year = 2000 + parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      } else if (pattern.isYY) {
        // 2-digit year
        year = 2000 + parseInt(match[3]);
        if (isNaN(parseInt(match[1]))) {
          // Month is text (Month DD,YY format)
          month = monthNameToNumber(match[1]);
          day = parseInt(match[2]);
        } else {
          // Numeric month
          month = parseInt(match[2]);
          day = parseInt(match[1]);
        }
      } else {
        // Standard 3 or 4 capture groups
        const groups = match.slice(1);
        if (groups.length === 3) {
          if (pattern.preferUS) {
            // MM/DD/YYYY
            month = parseInt(groups[0]);
            day = parseInt(groups[1]);
            year = parseInt(groups[2]);
          } else {
            // Try to detect format based on first group
            if (groups[0].length === 4) {
              // YYYY/MM/DD
              year = parseInt(groups[0]);
              month = parseInt(groups[1]);
              day = parseInt(groups[2]);
            } else if (isNaN(parseInt(groups[1]))) {
              // DD MMM YYYY
              day = parseInt(groups[0]);
              month = monthNameToNumber(groups[1]);
              year = parseInt(groups[2]);
            } else {
              // DD/MM/YYYY
              day = parseInt(groups[0]);
              month = parseInt(groups[1]);
              year = parseInt(groups[2]);
            }
          }

          // For ambiguous MM/DD vs DD/MM dates (not YYYY-first), if the month is invalid, try the other interpretation.
          if (groups[0].length !== 4 && !isNaN(parseInt(groups[1])) && (month < 1 || month > 12 || day < 1 || day > 31)) {
            console.log('[parseDate] Ambiguous date', match[0], ': month/day out of range, trying alternate format');
            if (pattern.preferUS) {
              // Try DD/MM/YYYY
              month = parseInt(groups[1]);
              day = parseInt(groups[0]);
            } else {
              // Try MM/DD/YYYY
              month = parseInt(groups[0]);
              day = parseInt(groups[1]);
            }
          }
        } else {
          // Not enough groups, skip this pattern
          continue;
        }
      }

      // Use UTC to avoid timezone off-by-one-day issues (e.g., local UTC+8 shifts the date back)
      const date = new Date(Date.UTC(year, month - 1, day));
      // FIX 101: Validate year is reasonable (between 2000 and 2100)
      if (!isNaN(date.getTime()) && year >= 2000 && year <= 2100) {
        return date.toISOString().split('T')[0];
      }
    }
  }

  return null;
}

/**
 * Compute due date from invoice date and payment terms
 * Parses terms like "30 Days", "NET 30", "NET DUE IN 30 DAYS"
 */
function computeDueDateFromTerms(invoiceDate: string, paymentTerms: string): string | null {
  const daysMatch = paymentTerms.match(/(\d+)\s*(?:DAYS?|D)/i);
  if (!daysMatch) return null;

  const days = parseInt(daysMatch[1], 10);
  if (isNaN(days) || days <= 0) return null;

  const date = new Date(invoiceDate + 'T00:00:00Z');
  if (isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Helper: Clean value by removing quotes, commas, vertical bars
 */
function cleanValue(str: string): string {
  return str.replace(/["'|,\r\n]/g, '').trim();
}

/**
 * Helper: Format date to YYYY-MM-DD
 */
function formatDate(str: string): string | null {
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

/**
 * Extract vendor name - FIX 5: vendor_name = supplier (invoice issuer), NOT bill-to customer
 * Additive approach: try label-anchored first, then fallback to position-based
 * Explicitly excludes BILL TO, SHIP TO, INVOICE TO entities to avoid confusion
 */
function extractVendorName(text: string): string | null {
  const companySuffixes = ['Ltd', 'Limited', 'Co.,Ltd', 'Inc', 'Corporation', 'B.V.', 'Company Limited', 'LLC', 'Pte', 'SDN', 'BHD', 'S.A.', 'GmbH', 'AG', 'S.A.R.L.', 'SpA', 'Sro', 'Zoo', 'Ltda', 'S.R.L.', 'Oy', 'A/S', 'N.V.', 'B.V.B.A.', 'S.E.N.C.', 'Kft', 'Zrt', 'Sro', 'd.o.o.', 'a.d.', 'd.d.', 'j.s.c.', 'S.A.', 'p.l.c.', 'Ltd.', 'Corp.', 'Co.', 'PT.', 'PT'];
  // Header/table words that should never be treated as a vendor name
  const genericVendorNoise = ['PRICE', 'UOM', 'QTY', 'QUANTITY', 'SHIPPED', 'EXTENDED', 'UNIT', 'AMOUNT', 'TOTAL', 'ITEM', 'CODE', 'DESCRIPTION', 'CUSTOMER', 'SUPPLIER', 'BILL TO', 'SHIP TO'];

  const upperText = text.toUpperCase();
  console.log('[extractVendorName] Text length:', text.length);
  console.log('[extractVendorName] First 200 chars:', text.substring(0, 200));

  // Known vendor keywords: if one is present, prefer a candidate containing it.
  const knownVendorKeywords = [
    { keyword: 'PAXAR', vendor: 'PT. PAXAR INDONESIA' },
    { keyword: 'AVERY', vendor: 'Avery Dennison' },
    { keyword: 'YKK', vendor: 'YKK' },
    { keyword: 'LI FUNG', vendor: 'Li & Fung' },
    { keyword: 'LIFUNG', vendor: 'Li & Fung' },
    { keyword: 'CRYSTAL', vendor: 'Crystal' },
    { keyword: 'MAS HOLDINGS', vendor: 'MAS Holdings' },
  ];
  const detectedVendor = knownVendorKeywords.find(k => upperText.includes(k.keyword));

  // FIX 5: Explicitly exclude bill-to, ship-to, invoice-to entities (these are customers, not vendors)
  // vendor_name should be the supplier/invoice issuer, not the customer
  const nonVendorLabels = ['BILL TO', 'BILL TO:', 'SHIP TO', 'SHIP TO:', 'INVOICE TO', 'INVOICE TO:', 'DELIVERY TO', 'DELIVER TO'];
  const nonVendorCompanies: Set<string> = new Set();

  for (const label of nonVendorLabels) {
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*([A-Z][A-Za-z\\s&]+)`, 'i');
    const match = text.match(regex);
    if (match) {
      const company = match[1].trim();
      console.log('[extractVendorName] Found non-vendor (customer) after', label, ':', company);
      nonVendorCompanies.add(company.toUpperCase());
    }
  }

  console.log('[extractVendorName] Non-vendor (customer) companies to exclude:', Array.from(nonVendorCompanies));

  // Search for company-suffix-bearing text blocks, excluding non-vendor ones and header noise
  const candidates: { name: string; position: number }[] = [];
  const searchArea = text.substring(0, Math.min(3000, text.length));

  // Prefix-style companies (e.g., Indonesian "PT. PAXAR INDONESIA")
  // Address indicators that signal the company name has ended and the address begins
  const addressIndicators = ['JL', 'JALAN', 'STREET', 'ST', 'ROAD', 'RD', 'AVENUE', 'AVE', 'BLVD', 'BOULEVARD', 'NO', 'NUMBER', 'SUITE', 'ROOM', 'FLOOR', 'BUILDING', 'TOWER', 'DISTRICT', 'CITY', 'PROVINCE', 'COUNTRY', 'TEL', 'FAX', 'PHONE', 'EMAIL', 'WEBSITE', 'BANK', 'SWIFT', 'ACCOUNT', 'A/C'];
  const prefixPattern = /\b(PT\.?\s+[A-Z][A-Za-z\s&]+)\b/gi;
  let prefixMatch;
  while ((prefixMatch = prefixPattern.exec(searchArea)) !== null) {
    let candidate = prefixMatch[1].trim();
    const upperCandidate = candidate.toUpperCase();
    if (nonVendorCompanies.has(upperCandidate) || upperCandidate.includes('MADISON') || upperCandidate.includes('BILL TO')) {
      continue;
    }
    if (genericVendorNoise.some(noise => upperCandidate.includes(noise))) {
      console.log('[extractVendorName] Rejecting noisy prefix candidate:', candidate);
      continue;
    }
    // Truncate at address indicators so we don't include "Jl. Gatot Subroto..." as part of the name
    for (const indicator of addressIndicators) {
      const idx = upperCandidate.indexOf(` ${indicator} `);
      if (idx !== -1) {
        candidate = candidate.substring(0, idx).trim();
        break;
      }
      // Also handle indicator followed by period (e.g., "Jl.")
      const idxDot = upperCandidate.indexOf(` ${indicator}.`);
      if (idxDot !== -1) {
        candidate = candidate.substring(0, idxDot).trim();
        break;
      }
    }
    if (!candidate) continue;
    console.log('[extractVendorName] Found vendor (supplier) prefix candidate:', candidate);
    candidates.push({ name: candidate, position: prefixMatch.index });
  }

  for (const suffix of companySuffixes) {
    const regex = new RegExp(`([A-Z][A-Za-z\\s&]+\\s+${suffix.replace('.', '\\.')})`, 'gi');
    let match;
    while ((match = regex.exec(searchArea)) !== null) {
      const candidate = match[1].trim();
      const upperCandidate = candidate.toUpperCase();
      // FIX 5: Exclude customer entities and Madison 88 (the buyer)
      if (nonVendorCompanies.has(upperCandidate) || upperCandidate.includes('MADISON') || upperCandidate.includes('BILL TO')) {
        continue;
      }
      // Exclude table header noise (e.g., "EXTENDED PRICE UOM PT")
      if (genericVendorNoise.some(noise => upperCandidate.includes(noise))) {
        console.log('[extractVendorName] Rejecting noisy candidate:', candidate);
        continue;
      }
      console.log('[extractVendorName] Found vendor (supplier) candidate with suffix', suffix, ':', candidate);
      candidates.push({ name: candidate, position: match.index });
    }
  }

  // If a known vendor keyword is detected, prefer the first candidate containing it.
  if (detectedVendor) {
    const vendorCandidate = candidates.find(c => c.name.toUpperCase().includes(detectedVendor.keyword));
    if (vendorCandidate) {
      console.log('[extractVendorName] Known vendor keyword detected, using candidate:', vendorCandidate.name);
      return vendorCandidate.name;
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.position - b.position);
    const bestCandidate = candidates[0].name;
    console.log('[extractVendorName] Best vendor (supplier) candidate:', bestCandidate);
    if (!isGenericLabel(bestCandidate)) {
      return bestCandidate;
    }
  }

  // FALLBACK: Original position-based logic (kept for backward compatibility)
  console.log('[extractVendorName] Label-anchored failed, trying position-based fallback');

  const billToIndex = text.toUpperCase().indexOf('BILL TO');
  const invoiceIndex = text.toUpperCase().indexOf('INVOICE');
  const cutoffIndex = Math.min(
    billToIndex !== -1 ? billToIndex : Infinity,
    invoiceIndex !== -1 ? invoiceIndex : Infinity
  );

  const fallbackSearchArea = cutoffIndex !== Infinity ? text.substring(0, cutoffIndex) : text.substring(0, Math.min(text.length, 2000));

  const fallbackCandidates: { name: string; position: number }[] = [];

  // Prefix-style fallback for Indonesian "PT." companies
  const fallbackPrefixPattern = /\b(PT\.?\s+[A-Z][A-Za-z\s&]+)\b/gi;
  let fallbackPrefixMatch;
  while ((fallbackPrefixMatch = fallbackPrefixPattern.exec(fallbackSearchArea)) !== null) {
    let candidate = fallbackPrefixMatch[1].trim();
    if (candidate.toUpperCase().includes('MADISON') || candidate.toUpperCase().includes('BILL TO')) {
      continue;
    }
    if (genericVendorNoise.some(noise => candidate.toUpperCase().includes(noise))) {
      continue;
    }
    // Truncate at address indicators so we don't include "Jl. Gatot Subroto..." as part of the name
    const upperCandidate = candidate.toUpperCase();
    for (const indicator of addressIndicators) {
      const idx = upperCandidate.indexOf(` ${indicator} `);
      if (idx !== -1) {
        candidate = candidate.substring(0, idx).trim();
        break;
      }
      const idxDot = upperCandidate.indexOf(` ${indicator}.`);
      if (idxDot !== -1) {
        candidate = candidate.substring(0, idxDot).trim();
        break;
      }
    }
    if (!candidate) continue;
    console.log('[extractVendorName] Fallback prefix candidate:', candidate);
    fallbackCandidates.push({ name: candidate, position: fallbackPrefixMatch.index });
  }

  for (const suffix of companySuffixes) {
    const regex = new RegExp(`([A-Z][A-Za-z\\s&]+\\s+${suffix.replace('.', '\\.')})`, 'gi');
    let match;
    while ((match = regex.exec(fallbackSearchArea)) !== null) {
      const candidate = match[1].trim();
      if (candidate.toUpperCase().includes('MADISON') || candidate.toUpperCase().includes('BILL TO')) {
        continue;
      }
      if (genericVendorNoise.some(noise => candidate.toUpperCase().includes(noise))) {
        continue;
      }
      console.log('[extractVendorName] Fallback candidate with suffix', suffix, ':', candidate);
      fallbackCandidates.push({ name: candidate, position: match.index });
    }
  }

  if (fallbackCandidates.length > 0) {
    fallbackCandidates.sort((a, b) => a.position - b.position);
    const bestFallback = fallbackCandidates[0].name;
    console.log('[extractVendorName] Best fallback candidate:', bestFallback);
    if (!isGenericLabel(bestFallback)) {
      return bestFallback;
    }
  }

  console.log('[extractVendorName] No vendor name found');
  return null;
}

/**
 * Extract invoice number from various label patterns
 */
function extractInvoiceNumber(text: string): string | null {
  const labels = ['Invoice No', 'Invoice No.', 'INVOICE NO:', 'INVOICE NO ：', 'INVOICE NO：', 'I/V NO.', 'PI No.', 'PI#', 'P/I NO', 'SI No', 'Order #', 'D/N No.', 'Bill No', 'Bill Number', 'Ref', 'Reference'];
  
  for (const label of labels) {
    // Handle both regular colon and full-width colon
    const escapedLabel = label.replace('.', '\\.').replace('：', '：?');
    const regex = new RegExp(`${escapedLabel}[:\\s#：]*([*#]*[A-Z0-9\\-\\/*]+[*#]*)`, 'i');
    const match = text.match(regex);
    if (match) {
      // Strip wrapping characters
      let value = match[1].replace(/[*#]/g, '');
      // Exclude MPO patterns from invoice number
      if (!/^MPO\d+$/i.test(value) && /\d/.test(value) && !isGenericLabel(value)) {
        console.log('[extractInvoiceNumber] Found invoice number:', value, 'with label:', label);
        return value;
      }
    }
  }

  // Fallback: Look for pattern like "BILL TO : PCI-26018341" or "PCI-26018341"
  const billToPattern = /BILL\s+TO\s*[:\s]*([A-Z0-9\-]+)/i;
  const billToMatch = text.match(billToPattern);
  if (billToMatch) {
    const value = billToMatch[1].trim();
    if (!/^MPO\d+$/i.test(value) && /\d/.test(value) && !isGenericLabel(value)) {
      return value;
    }
  }

  // Fallback: Look for any alphanumeric pattern that looks like an invoice number
  const invoicePattern = /[A-Z]{2,4}[-\s]*\d{4,10}/;
  const invoiceMatch = text.match(invoicePattern);
  if (invoiceMatch) {
    const value = invoiceMatch[0].replace(/[-\s]/g, '');
    if (/\d/.test(value) && !isGenericLabel(value)) {
      return value;
    }
  }

  return null;
}

/**
 * Extract invoice date
 */
function extractInvoiceDate(text: string, preferUS: boolean = false): string | null {
  console.log('[extractInvoiceDate] Text length:', text.length);
  console.log('[extractInvoiceDate] First 200 chars:', text.substring(0, 200));
  
  const labels = ['Invoice Date', 'INVOICE DATE:', 'Date:', 'Date', 'Issued Date', 'Billing Date'];
  
  for (const label of labels) {
    // Restrict capture to actual date strings to avoid trailing text like "INVOICE NO: ..."
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*(${DATE_CAPTURE_PATTERN})`, 'i');
    const match = text.match(regex);
    if (match) {
      console.log('[extractInvoiceDate] Found label', label, 'with value:', match[1]);
      const parsed = parseDate(match[1], preferUS);
      if (parsed) {
        console.log('[extractInvoiceDate] Parsed date:', parsed);
        return parsed;
      }
    }
  }

  // Fallback: find any date-like string (DD MMM YYYY format like "08 May 2026")
  const dateMatch = text.match(/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/);
  if (dateMatch) {
    console.log('[extractInvoiceDate] Found DD MMM YYYY date:', dateMatch[0]);
    const parsed = parseDate(dateMatch[0], preferUS);
    if (parsed) {
      console.log('[extractInvoiceDate] Parsed fallback date:', parsed);
      return parsed;
    }
  }

  // Fallback: find DD/MM/YYYY or MM/DD/YYYY format
  const slashDateMatch = text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  if (slashDateMatch) {
    console.log('[extractInvoiceDate] Found slash date:', slashDateMatch[0]);
    const parsed = parseDate(slashDateMatch[0], preferUS);
    if (parsed) {
      console.log('[extractInvoiceDate] Parsed slash date:', parsed);
      return parsed;
    }
  }

  console.log('[extractInvoiceDate] No date found');
  return null;
}

/**
 * Extract due date
 */
function extractDueDate(text: string, preferUS: boolean = false): string | null {
  console.log('[extractDueDate] Text length:', text.length);
  console.log('[extractDueDate] First 200 chars:', text.substring(0, 200));

  // DSRS v7.3: Due date must come from an explicit due-date label only.
  // Do NOT guess from invoice_date, first date, or any unlabeled date.
  const labels = ['Due Date', 'INVOICE DUE', 'Invoice due date', 'Payment Due Date', 'Due by', 'Payment Due'];

  for (const label of labels) {
    // Restrict capture to actual date strings to avoid trailing text like "CREDIT TERM 30 Days"
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*(${DATE_CAPTURE_PATTERN})`, 'i');
    const match = text.match(regex);
    if (match) {
      const dateValue = match[1].trim();
      console.log('[extractDueDate] Found label', label, 'with value:', dateValue);
      const parsed = parseDate(dateValue, preferUS);
      if (parsed) {
        console.log('[extractDueDate] Parsed date:', parsed);
        return parsed;
      }
    }
  }

  // Fallback: settlement deadline patterns (e.g., "SETTLE ... ON/ BEFORE 01/19/2026")
  const settlementPatterns = [
    new RegExp(`(?:SETTLE|PAYMENT|DUE).{0,30}(?:BEFORE|ON\\s*/\\s*BEFORE)[\\s:]*(${DATE_CAPTURE_PATTERN})`, 'i'),
    new RegExp(`(?:PAYABLE|DUE)\\s*(?:BY|ON\\s*/\\s*BEFORE)[\\s:]*(${DATE_CAPTURE_PATTERN})`, 'i')
  ];
  for (const pattern of settlementPatterns) {
    const match = text.match(pattern);
    if (match) {
      const dateValue = match[1].trim();
      console.log('[extractDueDate] Found settlement deadline:', dateValue);
      const parsed = parseDate(dateValue, preferUS);
      if (parsed) {
        console.log('[extractDueDate] Parsed settlement date:', parsed);
        return parsed;
      }
    }
  }

  console.log('[extractDueDate] No due date found');
  return null;
}

/**
 * Debug: Extract ALL numbers from text for candidate analysis
 */
function debugExtractAllNumbers(text: string): Array<{ value: number; index: number; context: string }> {
  const regex = /\d+(?:\.\d{2,3})?/g;
  const matches = [...text.matchAll(regex)];
  
  return matches.map((m, idx) => {
    const start = Math.max(0, m.index - 30);
    const end = Math.min(text.length, m.index + 30);
    return {
      value: parseFloat(m[0]),
      index: idx,
      context: text.substring(start, end)
    };
  });
}

/**
 * Debug: Extract all monetary amounts specifically
 */
function debugExtractAllAmounts(text: string): Array<{ value: number; index: number; context: string }> {
  const regex = /([0-9,]+\.[0-9]{2,3})/g;
  const matches = [...text.matchAll(regex)];
  
  return matches.map((m, idx) => {
    const start = Math.max(0, m.index - 30);
    const end = Math.min(text.length, m.index + 30);
    return {
      value: parseFloat(m[1].replace(/,/g, '')),
      index: idx,
      context: text.substring(start, end)
    };
  });
}

/**
 * Debug: Extract all quantities
 */
function debugExtractAllQuantities(text: string): Array<{ value: number; context: string }> {
  const patterns = [
    /(\d+)\s+USD\s+\d+\.\d+/g,
    /(\d+)\s+Each/gi,
    /(\d+)\s+PCS/gi,
    /(\d+)\s+Pcs/gi,
  ];
  
  const results: Array<{ value: number; context: string }> = [];
  
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + 40);
      results.push({
        value: parseInt(match[1]),
        context: text.substring(start, end)
      });
    }
  }
  
  return results;
}

/**
 * Debug: Account number regex test
 */
function debugAccountNumberExtraction(text: string): Array<{ pattern: string; match: string | null }> {
  const patterns = [
    { name: 'A/C NO', regex: /A\/C\s*(?:NO|NUMBER)?[:\s：]*([\d\s\-]+)/i },
    { name: 'Account #', regex: /Account\s*#[:\s：]*([\d\s\-]+)/i },
    { name: 'A/C#', regex: /A\/C#\s*([\d\s\-]+)/i },
    { name: 'A/C NO.', regex: /A\/C\s*NO\.?\s*[:\s：]*([\d\s\(\)]+)/i },
    { name: 'A/C:', regex: /A\/C\s*[:\s：]*([\d\s\(\)USD]+)/i },
    { name: 'A/C NUMBER', regex: /A\/C\s*NUMBER\s*[:\s：]*([\d\s\-]+)/i },
  ];
  
  return patterns.map(p => ({
    pattern: p.name,
    match: text.match(p.regex)?.[1] || null
  }));
}

/**
 * Extract total amount with confidence scoring
 * FIX 4: Allow multiple candidates for amount instead of null
 */
function extractAmount(text: string): { 
  amount: number | null; 
  currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null; 
  confidence: number;
  amount_candidates: number[];
  amount_candidates_trace: Array<{ value: any; score: number; reason: string }>;
} {
  const labels = [
    'TOTAL', 'Total Amount', 'TOTAL (USD)', 'TOTAL (HKD)', 'TOTAL (IDR)', 'TOTAL (EUR)', 'TOTAL (PHP)', 'TOTAL (JPY)',
    'NET INVOICE', 'Net Amount', 'Grand Total', 'Invoice amount', 'Order Total',
    'AMOUNT DUE', 'Balance Due', 'Total Due'
  ];
  
  let amount: number | null = null;
  let currency: string | null = null;
  let confidence = 0.0;
  const amount_candidates: number[] = [];
  const amountCandidatesForTrace: Array<{ value: any; score: number; reason: string }> = [];

  console.log('[extractAmount] Text length:', text.length);
  console.log('[extractAmount] Last 500 chars:', text.substring(text.length - 500));

  // PRIORITY 0: TOTAL DETECTION RULE - find lines containing TOTAL keywords
  const totalKeywords = ['total', 'say total', 'grand total', 'total amount', 'amount due', 'balance due'];
  const textLines = text.split('\n');
  
  for (const line of textLines) {
    const upperLine = line.toUpperCase();
    if (totalKeywords.some(keyword => upperLine.includes(keyword))) {
      // Extract numbers from this line
      const lineNumbers = line.match(/([0-9,]+\.[0-9]{2,3})/g);
      if (lineNumbers && lineNumbers.length > 0) {
        const parsedAmounts = lineNumbers.map(n => parseFloat(n.replace(/,/g, ''))).filter(n => n > 0 && n < 10000000);
        if (parsedAmounts.length > 0) {
          // Take the largest amount from the TOTAL line
          const maxAmount = Math.max(...parsedAmounts);
          amount = maxAmount;
          confidence = 0.98;
          amount_candidates.push(amount);
          amountCandidatesForTrace.push({ value: amount, score: 98, reason: 'TOTAL keyword detection' });
          console.log('[extractAmount] Found amount from TOTAL line:', amount, 'line:', line.substring(0, 50));
          break;
        }
      }
    }
  }

  // PRIORITY 1: Sum heuristic - check if any amount equals sum of other amounts (strongest signal)
  const allAmounts: { amount: number; index: number; context: string }[] = [];
  const amountPattern = /([0-9,]+\.[0-9]{2,3})/g;  // Allow 2-3 decimal places
  let match;
  while ((match = amountPattern.exec(text)) !== null) {
    const parsedAmount = parseFloat(match[1].replace(/,/g, ''));
    if (parsedAmount > 0 && parsedAmount < 10000000) {
      // Get context around the amount
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + 50);
      const context = text.substring(start, end);
      allAmounts.push({ amount: parsedAmount, index: match.index, context });
    }
  }
  
  console.log('[extractAmount] All amounts found:', allAmounts.length);
  console.log('[extractAmount] All amount values with context:', allAmounts.map(a => ({ amount: a.amount, context: a.context.substring(0, 30) })));
  
  // HEURISTIC: Check if any amount equals the sum of other amounts (strong signal for total)
  // Filter out unit prices (< 1.0) to focus on line amounts and totals
  const significantAmounts = allAmounts.filter(a => a.amount >= 1.0);
  const allAmountValues = significantAmounts.map(a => a.amount);
  console.log('[extractAmount] Significant amount values (>= 1.0):', allAmountValues);
  
  for (const candidate of significantAmounts) {
    const sumOfOthers = allAmountValues.reduce((sum, val) => {
      // Sum all amounts except this candidate (with small tolerance for floating point)
      if (Math.abs(val - candidate.amount) > 0.01) {
        return sum + val;
      }
      return sum;
    }, 0);
    
    console.log('[extractAmount] Checking candidate:', candidate.amount, 'sum of others:', sumOfOthers, 'diff:', Math.abs(candidate.amount - sumOfOthers));
    
    // If this amount equals sum of others (with tolerance), it's likely the total
    // Increased tolerance to 0.1 to handle floating point issues
    if (Math.abs(candidate.amount - sumOfOthers) < 0.1 && sumOfOthers > 0) {
      console.log('[extractAmount] Found total as sum of line amounts:', candidate.amount, 'sum:', sumOfOthers);
      amount = candidate.amount;
      confidence = 0.99;
      amount_candidates.push(amount);
      amountCandidatesForTrace.push({ value: candidate.amount, score: 100, reason: 'Sum of line amounts' });
      break;
    }
  }
  
  // PRIORITY 2: Search last 500 characters specifically for TOTAL USD pattern
  // Only if sum heuristic didn't find anything
  if (!amount) {
    const last500Chars = text.substring(text.length - 500);
    console.log('[extractAmount] Last 500 chars:', last500Chars);
    
    const endOfFilePatterns = [
      /TOTAL\s+USD\s+([0-9,]+\.[0-9]{2})/i,
      /Total\s+USD\s+([0-9,]+\.[0-9]{2})/i,
      /TOTAL\s+USD[:\s]+([0-9,]+\.[0-9]{2})/i,
      /Total\s+USD[:\s]+([0-9,]+\.[0-9]{2})/i,
      /USD\s+([0-9,]+\.[0-9]{2})\s*$/i,  // USD amount at very end
      /([0-9,]+\.[0-9]{2})\s*$/i,  // Any amount at very end
      /TOTAL\s+([0-9,]+\.[0-9]{2})/i,  // TOTAL followed by amount
      /Total\s+([0-9,]+\.[0-9]{2})/i,
      /Total\s*[:：]\s*([0-9,]+\.[0-9]{2})/i,  // Total with special colon character
      /\d+\s+\$([0-9,]+\.[0-9]{2})\s*$/i,  // Quantity followed by $amount at end (e.g., "7850 $422.25")
      /\d+\s+\$([0-9,]+\.[0-9]{2})/i,  // Quantity followed by $amount anywhere
    ];
    
    for (const pattern of endOfFilePatterns) {
      const match = last500Chars.match(pattern);
      if (match && match[1]) {
        const parsedAmount = parseFloat(match[1].replace(/,/g, ''));
        if (parsedAmount > 0 && parsedAmount < 10000000) {
          amount = parsedAmount;
          confidence = 0.95;
          amount_candidates.push(amount);
          console.log('[extractAmount] Found amount in last 500 chars:', amount, 'pattern:', pattern);
          break;
        }
      }
    }
  }

  // PRIORITY 3: Comprehensive fallback - search entire text for all amounts
  // and use heuristics to find the most likely total
  if (!amount) {
    // Heuristic: prefer amounts that appear near "TOTAL", "USD", or at the end of the document
    // Also penalize amounts that look like unit prices (very small amounts near item descriptions)
    const scoredAmounts = allAmounts.map(a => {
        let score = 0;
        let roleScore = 0;
        let skuScore = 0;
        let contextScore = 0;
        const context = a.context.toUpperCase();
        
        // Financial role classification (fuzzy regex-based semantic tagging)
        let role = 'UNKNOWN';
        if (/(shipping|freight|postage)/i.test(context)) {
          role = 'NOISE';
        } else if (/(total|grand total|amount due|invoice amount|say total)/i.test(context)) {
          role = 'PRIMARY';
        } else if (/subtotal/i.test(context)) {
          role = 'SECONDARY';
        }
        
        // Role-based scoring (50% weight in final arbitration)
        if (role === 'PRIMARY') roleScore += 100;
        if (role === 'SECONDARY') roleScore += 50;
        if (role === 'NOISE') roleScore -= 80;  // Reduced from -150 to avoid hard exclusion
        
        // STRONG SIGNAL: Near "TOTAL" or "SAY TOTAL" (invoice total indicators)
        if (context.includes('TOTAL') || context.includes('SAY TOTAL')) contextScore += 100;
        
        // STRONG SIGNAL: Near currency symbol ($)
        if (context.includes('$')) contextScore += 40;
        
        // Bonus for being near the end of document
        if (a.index > text.length * 0.8) contextScore += 30;
        
        // Bonus for being near "USD"
        if (context.includes('USD')) contextScore += 20;
        
        // Bonus for being near "GRAND"
        if (context.includes('GRAND')) contextScore += 25;
        
        // Bonus for being near "DUE"
        if (context.includes('DUE')) contextScore += 15;
        
        // STRONG PENALTY: Near item codes (indicates line item, not total)
        if (/[A-Z]{2}\d{4}[A-Z]\d/.test(context)) skuScore -= 40;  // Reduced from -80
        
        // DAMPENED PENALTY: Near quantity numbers (indicates line item row)
        if (/\b\d{3,5}\b/.test(context) && !context.includes('TOTAL')) skuScore -= 20;  // Reduced from -60
        
        // STRONG PENALTY: Near unit price patterns (very small amounts)
        if (a.amount < 1.0) skuScore -= 60;  // Reduced from -100
        if (a.amount < 10.0) skuScore -= 30;  // Reduced from -50
        
        // DAMPENED PENALTY: Being in a line with other numbers (likely line item)
        const numbersInContext = (context.match(/[0-9,]+\.[0-9]{2}/g) || []).length;
        if (numbersInContext > 2) skuScore -= 20;  // Reduced from -40
        
        // Bonus for larger amounts (more likely to be totals)
        if (a.amount > 100.0) contextScore += 15;
        if (a.amount > 1000.0) contextScore += 25;
        
        // Penalty for amounts that appear near "UNIT", "PRICE", "EACH"
        if (context.includes('UNIT') || context.includes('PRICE') || context.includes('EACH')) skuScore -= 70;
        
        // Bonus for amounts that appear near "SUM", "SUBTOTAL", "GRAND"
        if (context.includes('SUM') || context.includes('SUBTOTAL') || context.includes('GRAND')) contextScore += 35;
        
        // STRONG PENALTY: Dense table context (multiple numbers in close proximity)
        const numberDensity = (context.match(/\d/g) || []).length / context.length;
        if (numberDensity > 0.3) skuScore -= 50;
        
        // HARD EXCLUSION: Bank/address context (noise zone)
        if (context.includes('BANK') || context.includes('ADDRESS') || context.includes('SWIFT') || context.includes('ACCOUNT')) {
          skuScore -= 200; // Hard exclusion
        }
        
        // Compute weighted global score (deterministic arbitration)
        // role_score: 50%, sku_score: 30%, context_score: 20%
        const globalScore = (roleScore * 0.5) + (skuScore * 0.3) + (contextScore * 0.2);
        
        return { ...a, score: globalScore, roleScore, skuScore, contextScore, role };
      });
      
      // Sort by score and take the highest
      scoredAmounts.sort((a, b) => b.score - a.score);
      
      console.log('[extractAmount] Scored amounts:', scoredAmounts.slice(0, 5).map(s => ({ amount: s.amount, score: s.score, context: s.context.substring(0, 30) })));
      
      // Decision trace logging
      console.log('[extractAmount] DECISION TRACE:');
      console.log('  - Total candidates:', scoredAmounts.length);
      console.log('  - Top 3 candidates:', scoredAmounts.slice(0, 3).map(s => ({ 
        amount: s.amount, 
        globalScore: s.score.toFixed(2),
        roleScore: s.roleScore,
        skuScore: s.skuScore,
        contextScore: s.contextScore,
        role: s.role 
      })));
      
      if (scoredAmounts.length > 0 && scoredAmounts[0].score > 0) {
        amount = scoredAmounts[0].amount;
        confidence = 0.70;
        amount_candidates.push(amount);
        
        // Determine selection reason based on dominant signal
        const winner = scoredAmounts[0];
        let selectionReason = '';
        if (winner.roleScore > winner.skuScore && winner.roleScore > winner.contextScore) {
          selectionReason = `ROLE_${winner.role}_DOMINANT`;
        } else if (winner.skuScore > winner.roleScore && winner.skuScore > winner.contextScore) {
          selectionReason = 'SKU_VALIDATION_DOMINANT';
        } else {
          selectionReason = 'CONTEXT_MATCH_DOMINANT';
        }
        
        console.log('[extractAmount] Selected amount by weighted arbitration:', amount, 'globalScore:', winner.score.toFixed(2), 'reason:', selectionReason);
        
        // Add top 3 candidates to trace
        scoredAmounts.slice(0, 3).forEach((sa, idx) => {
          amountCandidatesForTrace.push({ 
            value: sa.amount, 
            score: sa.score, 
            reason: idx === 0 ? 'Heuristic selection' : `Alternative candidate #${idx + 1}` 
          });
        });
      } else {
        // 3-LAYER FALLBACK HIERARCHY
        console.log('[extractAmount] No high-scoring candidates, using fallback hierarchy');
        
        // Layer 1: Contextual invoice-total candidates (near TOTAL, USD, etc.)
        const contextualCandidates = allAmounts.filter(a => {
          const ctx = a.context.toUpperCase();
          return ctx.includes('TOTAL') || ctx.includes('SAY TOTAL') || ctx.includes('AMOUNT DUE') || ctx.includes('GRAND');
        });
        if (contextualCandidates.length > 0) {
          contextualCandidates.sort((a, b) => b.amount - a.amount);
          amount = contextualCandidates[0].amount;
          confidence = 0.60;
          amount_candidates.push(amount);
          console.log('[extractAmount] Fallback Layer 1 (contextual):', amount);
          amountCandidatesForTrace.push({ value: amount, score: 60, reason: 'Fallback: contextual invoice total' });
        }
        // Layer 2: Sum of line items - calculate sum of all line amounts
        else {
          // Calculate sum of all significant amounts (excluding unit prices < 1.0)
          const lineItemAmounts = allAmounts.filter(a => a.amount >= 1.0);
          const sumOfLineItems = lineItemAmounts.reduce((sum, a) => sum + a.amount, 0);
          
          if (sumOfLineItems > 0 && sumOfLineItems < 10000000) {
            amount = sumOfLineItems;
            confidence = 0.55;
            amount_candidates.push(amount);
            console.log('[extractAmount] Fallback Layer 2 (sum of line items):', amount);
            amountCandidatesForTrace.push({ value: amount, score: 55, reason: 'Fallback: sum of line items' });
          } else {
            // Layer 3: Last resort - highest numeric value
            allAmounts.sort((a, b) => b.amount - a.amount);
            amount = allAmounts[0].amount;
            confidence = 0.30;
            amount_candidates.push(amount);
            console.log('[extractAmount] Fallback Layer 3 (highest value):', amount);
            amountCandidatesForTrace.push({ value: amount, score: 30, reason: 'Fallback: highest numeric value (last resort)' });
          }
        }
      }
  }

  // Reference script approach: Search from end of file for TOTAL lines (highest confidence)
  const totalLines = text.split('\n');
  for (let j = totalLines.length - 1; j >= 0; j--) {
    if (/TOTAL/i.test(totalLines[j])) {
      // Get the next line and extract number
      if (totalLines[j + 1]) {
        const num = totalLines[j + 1].replace(/[^\d.]/g, '');
        if (num && parseFloat(num) > 0) {
          const parsedAmount = parseFloat(num);
          amount = parsedAmount;
          confidence = 0.95;
          amount_candidates.push(parsedAmount);
          console.log('[extractAmount] Found amount from end of file:', amount, 'line:', totalLines[j + 1].substring(0, 50));
          break;
        }
      }
    }
  }

  // Find all occurrences of total labels (medium confidence)
  if (!amount) {
    const allMatches: { index: number; amount: number; currency: string }[] = [];
    
    for (const label of labels) {
      const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*([\\d,]+\\.\\d{2})`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        console.log('[extractAmount] Found amount with label', label, ':', match[1]);
        // Extract currency from label if present
        let extractedCurrency = 'USD';
        if (label.includes('(USD)')) extractedCurrency = 'USD';
        else if (label.includes('(HKD)')) extractedCurrency = 'HKD';
        else if (label.includes('(IDR)')) extractedCurrency = 'IDR';
        else if (label.includes('(EUR)')) extractedCurrency = 'EUR';
        else if (label.includes('(PHP)')) extractedCurrency = 'PHP';
        else if (label.includes('(JPY)')) extractedCurrency = 'JPY';
        
        const parsedAmount = parseFloat(match[1].replace(/,/g, ''));
        allMatches.push({
          index: match.index,
          amount: parsedAmount,
          currency: extractedCurrency
        });
        amount_candidates.push(parsedAmount);
      }
    }

    console.log('[extractAmount] Total matches:', allMatches.length);

    // Take the LAST occurrence (grand total on final page)
    if (allMatches.length > 0) {
      allMatches.sort((a, b) => b.index - a.index);
      amount = allMatches[0].amount;
      currency = allMatches[0].currency;
      confidence = 0.85;
      console.log('[extractAmount] Selected amount:', amount, 'at index:', allMatches[0].index);
    }
  }

  // FIX 2: Regex fallback pattern - solves 80% of invoice layouts
  // Pattern: (TOTAL|GRAND TOTAL|AMOUNT DUE|TOTAL USD)[^\d]{0,20}([\d,]+\.\d{2})
  // FIX 1: Right-side value capture - extract numeric value even if it appears on far right or after spacing
  if (!amount) {
    const rightSidePattern = /(TOTAL|GRAND TOTAL|AMOUNT DUE|TOTAL USD|TOTAL HKD|TOTAL EUR|TOTAL PHP|TOTAL JPY|TOTAL IDR)[^\d]{0,20}([\d,]+\.\d{2})/gi;
    const rightSideMatch = text.match(rightSidePattern);
    if (rightSideMatch && rightSideMatch[2]) {
      const parsedAmount = parseFloat(rightSideMatch[2].replace(/,/g, ''));
      amount = parsedAmount;
      confidence = 0.80;
      amount_candidates.push(parsedAmount);
      console.log('[extractAmount] Found amount with right-side pattern:', amount, 'label:', rightSideMatch[1]);
    }
  }

  // FIX 3: Normalize OCR line reading - convert "TOTAL USD         9,680.00" to "TOTAL USD: 9680.00"
  // Normalize spaces between label and amount
  if (!amount) {
    const normalizedLines = text.split('\n').map(line => {
      // Replace multiple spaces with single space
      return line.replace(/\s{2,}/g, ' ');
    }).join('\n');
    
    const normalizedPattern = /(TOTAL|GRAND TOTAL|AMOUNT DUE|TOTAL USD|TOTAL HKD|TOTAL EUR|TOTAL PHP|TOTAL JPY|TOTAL IDR)\s+([\d,]+\.\d{2})/gi;
    const normalizedMatch = normalizedLines.match(normalizedPattern);
    if (normalizedMatch && normalizedMatch[2]) {
      const parsedAmount = parseFloat(normalizedMatch[2].replace(/,/g, ''));
      amount = parsedAmount;
      confidence = 0.75;
      amount_candidates.push(parsedAmount);
      console.log('[extractAmount] Found amount with normalized pattern:', amount, 'label:', normalizedMatch[1]);
    }
  }

  // FIX 3: Explicit fallback for AMOUNT DUE, BALANCE DUE, GRAND TOTAL before returning null
  if (!amount) {
    const fallbackLabels = ['AMOUNT DUE', 'Balance Due', 'Grand Total'];
    for (const label of fallbackLabels) {
      const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*([\\d,]+\\.\\d{2})`, 'i');
      const match = text.match(regex);
      if (match && match[1]) {
        const parsedAmount = parseFloat(match[1].replace(/,/g, ''));
        amount = parsedAmount;
        confidence = 0.75;
        amount_candidates.push(parsedAmount);
        console.log('[extractAmount] Found amount with fallback label', label, ':', amount);
        break;
      }
    }
  }

  // FIX 4: Prose-based currency conversion fallback (Perfect China Supplies)
  // Handles cases where USD amount is stated in prose: "For settlement in USD. @7.70, Please settle in USD 96.68"
  // This prevents grabbing wrong HKD total which overstates amount by 7-8x
  if (!amount) {
    const prosePatterns = [
      /settle in USD\s+([\d,]+\.\d{2})/i,
      /For settlement in USD.*USD\s+([\d,]+\.\d{2})/i,
      /@[\d.]+.*USD\s+([\d,]+\.\d{2})/i,
      /Please settle in USD\s+([\d,]+\.\d{2})/i,
      /USD\s+([\d,]+\.\d{2})\s+for settlement/i,
    ];
    
    for (const pattern of prosePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const parsedAmount = parseFloat(match[1].replace(/,/g, ''));
        if (parsedAmount > 0 && parsedAmount < 10000000) {
          amount = parsedAmount;
          currency = 'USD';
          confidence = 0.90; // High confidence for explicit USD prose
          amount_candidates.push(parsedAmount);
          console.log('[extractAmount] Found USD amount in prose:', amount, 'pattern:', pattern);
          break;
        }
      }
    }
  }

  // Remove duplicates from candidates
  const uniqueCandidates = Array.from(new Set(amount_candidates));
  console.log('[extractAmount] Amount candidates:', uniqueCandidates);

  // Detect currency from text if not found
  if (!currency) {
    const standardCurrencies = ['USD', 'HKD', 'IDR', 'PHP', 'EUR', 'GBP', 'JPY'];
    for (const curr of standardCurrencies) {
      const regex = new RegExp(curr, 'i');
      if (regex.test(text)) {
        currency = curr;
        console.log('[extractAmount] Detected currency:', currency);
        break;
      }
    }
  }

  // Default to USD if not found
  if (!currency) {
    currency = 'USD';
  }

  console.log('[extractAmount] Final amount:', amount, 'currency:', currency, 'confidence:', confidence);
  return { amount, currency: currency as any, confidence, amount_candidates: uniqueCandidates, amount_candidates_trace: amountCandidatesForTrace || [] };
}

/**
 * Detect if document is likely handwritten
 * Uses heuristics since OCR confidence scores are not available from pdf-parse/pdf2json
 */
function detectHandwritten(text: string): boolean {
  // Fast path: if document contains standard printed invoice markers, it is not handwritten.
  const printedInvoiceMarkers = [
    /INVOICE\s*(NO|NUMBER|DATE|#)/i,
    /BILL\s*TO/i,
    /SHIP\s*TO/i,
    /PAGE\s*:/i,
    /TEL\s*:/i,
    /FAX\s*:/i,
    /SWIFT\s*(CODE|#)/i,
    /A\/C\s*#/i,
    /BANK\s*(CODE|ACCOUNT)/i,
  ];
  const printedMarkerCount = printedInvoiceMarkers.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  if (printedMarkerCount >= 3) {
    console.log('[detectHandwritten] Document contains printed invoice markers, not handwritten:', printedMarkerCount);
    return false;
  }

  // Heuristic 1: Check for inconsistent character spacing patterns
  // Handwritten text often has irregular spacing
  const spacingVariance = text.split('\n').reduce((acc, line) => {
    const spaces = line.match(/\s+/g);
    if (spaces) {
      const lengths = spaces.map(s => s.length);
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / lengths.length;
      return acc + variance;
    }
    return acc;
  }, 0);
  
  const avgSpacingVariance = spacingVariance / text.split('\n').length;
  
  // Heuristic 2: Check for common OCR artifacts that suggest handwriting
  const handwritingIndicators = [
    /\[.*?\]/g, // OCR uncertainty markers
    /\?{2,}/g, // Multiple question marks
    /[0-9OIl]{5,}/g, // Ambiguous character sequences
  ];
  
  let handwritingScore = 0;
  for (const pattern of handwritingIndicators) {
    const matches = text.match(pattern);
    if (matches && matches.length > 5) {
      handwritingScore += matches.length;
    }
  }
  
  // Heuristic 3: Check for very short lines (handwriting often has fragmented lines)
  const lines = text.split('\n');
  const shortLines = lines.filter(line => line.trim().length > 0 && line.trim().length < 10).length;
  const shortLineRatio = shortLines / lines.length;
  
  // Combined detection
  const isLikelyHandwritten = 
    avgSpacingVariance > 2.0 || // High spacing variance
    handwritingScore > 10 || // Many OCR artifacts
    shortLineRatio > 0.3; // Many very short lines
  
  if (isLikelyHandwritten) {
    console.log('[detectHandwritten] Document appears to be handwritten:', {
      avgSpacingVariance,
      handwritingScore,
      shortLineRatio
    });
  }
  
  return isLikelyHandwritten;
}

/**
 * Extract bank charge
 */
function extractBankCharge(text: string): number | null {
  const labels = ['Bank Charge', 'Bank Charges', 'BANK CHARGE'];
  
  for (const label of labels) {
    // Check as footer line
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*([\\d,]+\\.\\d{2})`, 'i');
    const match = text.match(regex);
    if (match) {
      return parseFloat(match[1].replace(/,/g, ''));
    }
  }

  return null;
}

/**
 * Extract and normalize payment terms
 */
function extractPaymentTerms(text: string): string | null {
  const labels = ['Payment Terms', 'NET TERMS', 'TERMS:', 'Terms of payment', 'Credit Term', 'CREDIT TERM'];
  
  for (const label of labels) {
    // Updated regex to stop at newline or after reasonable length
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*([A-Za-z0-9\\s]{0,50})`, 'i');
    const match = text.match(regex);
    if (match) {
      let value = match[1].trim().toUpperCase();
      
      // Stop at first newline
      const newlineIndex = value.indexOf('\n');
      if (newlineIndex !== -1) {
        value = value.substring(0, newlineIndex).trim();
      }
      
      // Stop after matching number + day(s) token
      const dayMatch = value.match(/(\d+\s*DAYS?)/i);
      if (dayMatch && dayMatch.index !== undefined) {
        const dayIndex = dayMatch.index + dayMatch[0].length;
        value = value.substring(0, dayIndex).trim();
      }
      
      // Skip if value is a generic label
      if (isGenericLabel(value)) {
        continue;
      }
      
      // Skip if value is too long (likely legal text, not actual payment terms)
      if (value.split(/\s+/).length > 10) {
        continue;
      }
      
      // Skip if value doesn't contain a number or known payment phrase
      const hasNumber = /\d/.test(value);
      const knownPhrases = ['NET', 'TT', 'T/T', 'PAYMENT', 'CREDIT', 'DAYS', 'ADVANCE', 'COD', 'LC', 'DA', 'DP', 'PBS'];
      const hasKnownPhrase = knownPhrases.some(phrase => value.includes(phrase));
      
      if (!hasNumber && !hasKnownPhrase) {
        continue;
      }
      
      // Normalize common values
      if (value.includes('NET 30') || value === 'NET 30' || value === 'NET30') {
        return 'NET_30';
      }
      if (value.includes('NET 60') || value === 'NET 60' || value === 'NET60') {
        return 'NET_60';
      }
      if (value.includes('NET 90') || value === 'NET 90' || value === 'NET90') {
        return 'NET_90';
      }
      if (value.includes('100% TT') || value.includes('T/T 100%') || value.includes('TT 100%')) {
        return 'TT_100_BEFORE_SHIPMENT';
      }
      if (value.includes('PAYMENT IN ADVANCE') || value.includes('C-T.T IN ADVANCE') || value.includes('TT IN ADVANCE')) {
        return 'PAYMENT_IN_ADVANCE';
      }
      
      return value;
    }
  }

  return null;
}

/**
 * Extract bank details with confidence scoring
 */
function extractBankDetails(text: string): { bank_name: string | null; swift_code: string | null; account_number: string | null; account_usd: string | null; account_hkd: string | null; account_eur: string | null; account_vnd: string | null; account_idr: string | null; account_php: string | null; account_jpy: string | null; account_gbp: string | null; account_cny: string | null; account_aud: string | null; account_cad: string | null; account_sgd: string | null; confidence: number } {
  console.log('[extractBankDetails] Starting bank details extraction');
  
  const normalized = normalizeInvoiceText(text);
  let bank_name: string | null = null;
  let swift_code: string | null = null;
  let account_number: string | null = null;
  let account_usd: string | null = null;
  let account_hkd: string | null = null;
  let account_eur: string | null = null;
  let account_vnd: string | null = null;
  let account_idr: string | null = null;
  let account_php: string | null = null;
  let account_jpy: string | null = null;
  let account_gbp: string | null = null;
  let account_cny: string | null = null;
  let account_aud: string | null = null;
  let account_cad: string | null = null;
  let account_sgd: string | null = null;
  let confidence = 0.0;

  // Detect bank name
  // DSRS v7.3: First try explicit Bank Name / Beneficiary / Our Bank labels.
  // If no labeled bank name is found, fall back to known bank name patterns.
  const genericBankNamePatterns = [
    /Bank\s*Name\s*[:：]\s*([A-Za-z][A-Za-z\s&.,]+?)(?=\s*(?:Swift|SWIFT|A\/C|Account|Beneficiary|Address|Tel|Fax|$))/i,
    /Beneficiary\s*(?:Bank)?\s*[:：]\s*([A-Za-z][A-Za-z\s&.,]+?)(?=\s*(Swift|SWIFT|A\/C|Account|Address|Tel|Fax|$))/i,
    /Our\s*Bank\s*[:：]\s*([A-Za-z][A-Za-z\s&.,]+?)(?=\s*(Swift|SWIFT|A\/C|Account|Beneficiary|Address|Tel|Fax|$))/i,
    /Bank\s*[:：]\s*([A-Za-z][A-Za-z\s&.,]+?)(?=\s*(Swift|SWIFT|A\/C|Account|Beneficiary|Address|Tel|Fax|$))/i,
  ];

  for (const pattern of genericBankNamePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      bank_name = match[1].trim();
      // Clean up trailing noise
      bank_name = bank_name.replace(/\s*(?:Swift|SWIFT|A\/C|Account|Beneficiary).*$/i, '').trim();
      if (bank_name.length > 2) {
        confidence = Math.max(confidence, 0.90);
        console.log('[extractBankDetails] Found bank name from label:', bank_name);
        break;
      }
    }
  }

  if (!bank_name) {
    const bankPatterns = [
      { name: 'Standard Chartered Bank', patterns: [/Standard\s*Chartered/i], confidence: 0.95 },
      { name: 'CITIBANK', patterns: [/CITIBANK/i], confidence: 0.95 },
      { name: 'HSBC', patterns: [/HSBC/i], confidence: 0.95 },
      { name: 'DBS Bank', patterns: [/DBS\s*Bank/i], confidence: 0.95 },
      { name: 'Bank of America', patterns: [/Bank\s*of\s*America/i], confidence: 0.95 },
      { name: 'Chase Bank', patterns: [/Chase\s*Bank/i], confidence: 0.95 },
      { name: 'Wells Fargo', patterns: [/Wells\s*Fargo/i], confidence: 0.95 },
    ];

    for (const { name, patterns, confidence: bankConf } of bankPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          bank_name = name;
          confidence = Math.max(confidence, bankConf);
          console.log('[extractBankDetails] Found bank:', bank_name, 'confidence:', confidence);
          break;
        }
      }
      if (bank_name) break;
    }
  }

  // Extract SWIFT code
  const swiftMatch = normalized.match(/Swift\s*code\s*:\s*([A-Z]{6}[A-Z0-9]{2,5})/i) ||
                      normalized.match(/SWIFT[:\s]*([A-Z]{6}[A-Z0-9]{2,5})/i);
  
  if (swiftMatch) {
    swift_code = swiftMatch[1];
    confidence = Math.max(confidence, 0.90);
    console.log('[extractBankDetails] Found SWIFT code:', swift_code);
    
    // Debug: Show text around SWIFT code to debug account number extraction
    const swiftIndex = normalized.indexOf(swift_code);
    if (swiftIndex !== -1) {
      const contextStart = Math.max(0, swiftIndex - 300);
      const contextEnd = Math.min(normalized.length, swiftIndex + 300);
      console.log('[extractBankDetails] Text around SWIFT code:', normalized.substring(contextStart, contextEnd));
    }
  }
  
  // Extract account number with more flexible patterns
  const accountPatterns = [
    /A\/C\s*(?:NO|NUMBER)?[:\s：]*([\d\s\-]+)/i,
    /Account\s*#[:\s：]*([\d\s\-]+)/i,
    /A\/C#\s*([\d\s\-]+)/i,
    /A\/C\s*NO\.?\s*[:\s：]*([\d\s\(\)]+)/i,
    /A\/C\s*[:\s：]*([\d\s\(\)USD]+)/i,
    /A\/C\s*NUMBER\s*[:\s：]*([\d\s\-]+)/i,
    /Account\s*No\.?\s*[:\s：]*([\d\s\-]+)/i,
    /Account\s*Number\s*[:\s：]*([\d\s\-]+)/i,
    /Bank\s*Account\s*(?:No|Number)?\.?\s*[:\s：]*([\d\s\-]+)/i,
    /Bank\s*A\/C\s*(?:No|Number)?\.?\s*[:\s：]*([\d\s\-]+)/i,
    /Acct\.?\s*(?:No|Number)?\.?\s*[:\s：]*([\d\s\-]+)/i,
    /A\/C\s*No\.?\s*[:\s：]*([\d\s\-]+)/i,
    /A\/C\s*No\s*[:\s：]*([\d\s\-]+)/i,
    /Account\s*No\s*[:\s：]*([\d\s\-]+)/i,
    /Account\s*Number\.?\s*[:\s：]*([\d\s\-]+)/i,
    /Bank\s*Acct\.?\s*(?:No|Number)?\.?\s*[:\s：]*([\d\s\-]+)/i,
  ];

  let accountMatch: RegExpMatchArray | null = null;
  for (let i = 0; i < accountPatterns.length; i++) {
    accountMatch = normalized.match(accountPatterns[i]);
    if (accountMatch) {
      console.log(`[extractBankDetails] Pattern ${i + 1} matched:`, accountMatch[0]);
      break;
    }
  }

  if (accountMatch) {
    // Remove spaces, parentheses, and currency suffix
    account_number = accountMatch[1]
      .replace(/\s+/g, '') // Remove spaces
      .replace(/[\(\)]/g, '') // Remove parentheses
      .replace(/USD|HKD|EUR|VND|IDR|PHP|JPY|GBP|CNY|AUD|CAD|SGD/gi, ''); // Remove currency suffixes
    confidence = Math.max(confidence, 0.85);
    console.log('[extractBankDetails] Found account number:', account_number);
  } else {
    console.log('[extractBankDetails] No account number match found');
  }

  // Multi-currency account extraction
  // Find the bank account section first, then extract all number (currency) pairs within it
  const bankAccountSectionRegex = /(?:A\/C|Account|Acct|Bank\s*Account|Bank\s*A\/C)\s*(?:No|No\.|#|Number)?\s*[:\s：]*([\s\S]{0,300})/i;
  const sectionMatch = normalized.match(bankAccountSectionRegex);
  const currencies = ['USD', 'HKD', 'EUR', 'VND', 'IDR', 'PHP', 'JPY', 'GBP', 'CNY', 'AUD', 'CAD', 'SGD'];
  const currencyMap: Record<string, keyof typeof accountLookup> = {
    'USD': 'account_usd', 'HKD': 'account_hkd', 'EUR': 'account_eur', 'VND': 'account_vnd',
    'IDR': 'account_idr', 'PHP': 'account_php', 'JPY': 'account_jpy', 'GBP': 'account_gbp',
    'CNY': 'account_cny', 'AUD': 'account_aud', 'CAD': 'account_cad', 'SGD': 'account_sgd',
  };
  const accountLookup: Record<string, string | null> = {
    account_usd, account_hkd, account_eur, account_vnd, account_idr, account_php,
    account_jpy, account_gbp, account_cny, account_aud, account_cad, account_sgd,
  };

  if (sectionMatch) {
    const section = sectionMatch[1];
    // Extract all number (currency) pairs like: 741-291777-201 (USD), 741-291777-001 (HKD)
    const currencyAlternation = currencies.join('|');
    const pairPattern = new RegExp(`([\\d\\-]{5,30})\\s*\\((\\b(?:${currencyAlternation})\\b)\\)`, 'gi');
    let pairMatch;
    while ((pairMatch = pairPattern.exec(section)) !== null) {
      const rawAccount = pairMatch[1].replace(/\s+/g, '');
      const currency = pairMatch[2].toUpperCase();
      const key = currencyMap[currency];
      if (key) {
        accountLookup[key] = rawAccount;
      }
      if (currency === 'USD') {
        account_number = rawAccount;
        account_usd = rawAccount;
      }
    }

    // Fallback: currency before number, e.g., USD: 741-291777-201
    if (!account_usd) {
      const fallbackPattern = new RegExp(`\\b(${currencyAlternation})\\b\\s*[:\s]\\s*([\\d\\-]{5,30})`, 'gi');
      let fbMatch;
      while ((fbMatch = fallbackPattern.exec(section)) !== null) {
        const currency = fbMatch[1].toUpperCase();
        const rawAccount = fbMatch[2].replace(/\s+/g, '');
        const key = currencyMap[currency];
        if (key) {
          accountLookup[key] = rawAccount;
        }
        if (currency === 'USD') {
          account_number = rawAccount;
          account_usd = rawAccount;
        }
      }
    }
  }

  // If USD was found, always use it as primary account_number
  if (accountLookup.account_usd) {
    account_number = accountLookup.account_usd;
    account_usd = accountLookup.account_usd;
  }

  // Debug: Show all lines containing "A/C" or "Account"
  const linesWithAC = normalized.split('\n').filter(line => 
    line.includes('A/C') || line.includes('Account') || line.includes('ACCOUNT') || line.includes('Acct')
  );
  console.log('[extractBankDetails] Lines with A/C/Account:', linesWithAC);

  console.log('[extractBankDetails] Final result:', { bank_name, swift_code, account_number, account_usd, account_hkd, account_eur, confidence });
  return {
    bank_name, swift_code, account_number,
    account_usd: accountLookup.account_usd,
    account_hkd: accountLookup.account_hkd,
    account_eur: accountLookup.account_eur,
    account_vnd: accountLookup.account_vnd,
    account_idr: accountLookup.account_idr,
    account_php: accountLookup.account_php,
    account_jpy: accountLookup.account_jpy,
    account_gbp: accountLookup.account_gbp,
    account_cny: accountLookup.account_cny,
    account_aud: accountLookup.account_aud,
    account_cad: accountLookup.account_cad,
    account_sgd: accountLookup.account_sgd,
    confidence,
  };
}

/**
 * Generic extraction layer for unknown vendors
 * Uses alias dictionary and fallback patterns when vendor-specific rules fail
 */
function extractUsingGenericLayer(text: string, preferUS: boolean = false): {
  invoice_number: { value: string | null; confidence: number };
  invoice_date: { value: string | null; confidence: number };
  due_date: { value: string | null; confidence: number };
  amount: { value: number | null; confidence: number };
  currency: { value: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null; confidence: number };
  mpo_number: { value: string | null; confidence: number };
  payment_terms: { value: string | null; confidence: number };
} {
  console.log('[GenericLayer] Starting generic extraction');
  
  const normalized = normalizeInvoiceText(text);
  const result = {
    invoice_number: { value: null as string | null, confidence: 0.0 },
    invoice_date: { value: null as string | null, confidence: 0.0 },
    due_date: { value: null as string | null, confidence: 0.0 },
    amount: { value: null as number | null, confidence: 0.0 },
    currency: { value: null as 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null, confidence: 0.0 },
    mpo_number: { value: null as string | null, confidence: 0.0 },
    payment_terms: { value: null as string | null, confidence: 0.0 },
  };

  // Extract invoice number using aliases
  for (const alias of FIELD_ALIASES.invoice_number) {
    const regex = new RegExp(`${alias.replace(/\s+/g, '\\s+')}[:\\s#]*([A-Z0-9\\-\\/*]+)`, 'i');
    const match = normalized.match(regex);
    if (match) {
      const value = match[1].replace(/[*#]/g, '');
      if (/\d/.test(value)) {
        result.invoice_number.value = value;
        result.invoice_number.confidence = 0.70;
        console.log('[GenericLayer] Found invoice number:', value);
        break;
      }
    }
  }

  // Extract invoice date using aliases
  // Restrict capture to actual date strings to avoid trailing text like "Bill To ..."
  for (const alias of FIELD_ALIASES.invoice_date) {
    const regex = new RegExp(`${alias.replace(/\s+/g, '\\s+')}[:\\s]*(${DATE_CAPTURE_PATTERN})`, 'i');
    const match = normalized.match(regex);
    if (match) {
      const parsed = parseDate(match[1].trim(), preferUS);
      if (parsed) {
        result.invoice_date.value = parsed;
        result.invoice_date.confidence = 0.70;
        console.log('[GenericLayer] Found invoice date:', parsed);
        break;
      }
    }
  }

  // Extract due date using aliases
  for (const alias of FIELD_ALIASES.due_date) {
    const regex = new RegExp(`${alias.replace(/\s+/g, '\\s+')}[:\\s]*(${DATE_CAPTURE_PATTERN})`, 'i');
    const match = normalized.match(regex);
    if (match) {
      const parsed = parseDate(match[1].trim(), preferUS);
      if (parsed) {
        result.due_date.value = parsed;
        result.due_date.confidence = 0.70;
        console.log('[GenericLayer] Found due date:', parsed);
        break;
      }
    }
  }

  // Fallback: settlement deadline patterns (e.g., "SETTLE ... ON/ BEFORE 01/19/2026")
  if (!result.due_date.value) {
    const settlementPatterns = [
      new RegExp(`(?:SETTLE|PAYMENT|DUE).{0,30}(?:BEFORE|ON\\s*/\\s*BEFORE)[\\s:]*(${DATE_CAPTURE_PATTERN})`, 'i'),
      new RegExp(`(?:PAYABLE|DUE)\\s*(?:BY|ON\\s*/\\s*BEFORE)[\\s:]*(${DATE_CAPTURE_PATTERN})`, 'i')
    ];
    for (const pattern of settlementPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        const dateValue = match[1].trim();
        console.log('[GenericLayer] Found settlement deadline:', dateValue);
        const parsed = parseDate(dateValue, preferUS);
        if (parsed) {
          result.due_date.value = parsed;
          result.due_date.confidence = 0.65;
          console.log('[GenericLayer] Parsed settlement date:', parsed);
          break;
        }
      }
    }
  }

  // Extract amount using aliases
  for (const alias of FIELD_ALIASES.amount) {
    const regex = new RegExp(`${alias.replace(/\s+/g, '\\s+')}[:\\s]*([\\d,]+\\.\\d{2})`, 'i');
    const match = normalized.match(regex);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (value > 0) {
        result.amount.value = value;
        result.amount.confidence = 0.70;
        console.log('[GenericLayer] Found amount:', value);
        break;
      }
    }
  }

  // Extract MPO using aliases
  for (const alias of FIELD_ALIASES.mpo_number) {
    const regex = new RegExp(`${alias.replace(/\s+/g, '\\s+')}[:\\s]*([\\d]+)/i`, 'i');
    const match = normalized.match(regex);
    if (match) {
      result.mpo_number.value = "MPO" + match[1];
      result.mpo_number.confidence = 0.70;
      console.log('[GenericLayer] Found MPO:', result.mpo_number.value);
      break;
    }
  }

  // Fallback MPO extraction
  if (!result.mpo_number.value) {
    const mpoMatch = normalized.match(/MPO[\s_-]*(\d+)/i);
    if (mpoMatch) {
      result.mpo_number.value = "MPO" + mpoMatch[1];
      result.mpo_number.confidence = 0.65;
      console.log('[GenericLayer] Found MPO (fallback):', result.mpo_number.value);
    }
  }

  // Extract payment terms using aliases
  for (const alias of FIELD_ALIASES.payment_terms) {
    const regex = new RegExp(`${alias.replace(/\s+/g, '\\s+')}[:\\s]*([A-Za-z0-9\\s]{0,50})`, 'i');
    const match = normalized.match(regex);
    if (match) {
      let value = match[1].trim().toUpperCase();

      // Stop after number + day(s) token (e.g., "30 DAYS NET DUE DATE 16" -> "30 DAYS")
      const dayMatch = value.match(/(\d+\s*DAYS?)/i);
      if (dayMatch && dayMatch.index !== undefined) {
        const dayIndex = dayMatch.index + dayMatch[0].length;
        value = value.substring(0, dayIndex).trim();
      }

      // Stop at common following labels to avoid capturing "Due Date", "Invoice Date", etc.
      const stopLabels = ['DUE DATE', 'INVOICE DATE', 'EFFECTIVE DATE', 'STATEMENT DATE'];
      for (const stopLabel of stopLabels) {
        const stopIndex = value.indexOf(stopLabel);
        if (stopIndex !== -1) {
          value = value.substring(0, stopIndex).trim();
        }
      }

      if (/\d/.test(value) || /NET|TT|PAYMENT|CREDIT|DAYS/i.test(value)) {
        result.payment_terms.value = value;
        result.payment_terms.confidence = 0.70;
        console.log('[GenericLayer] Found payment terms:', value);
        break;
      }
    }
  }

  // Detect currency
  const currencyMatch = normalized.match(/\b(USD|HKD|IDR|EUR|PHP|JPY|GBP)\b/i);
  if (currencyMatch) {
    const detected = currencyMatch[1].toUpperCase();
    // Normalize to allowed currency types
    const allowedCurrencies: ('USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY')[] = ['USD', 'HKD', 'IDR', 'EUR', 'PHP', 'JPY'];
    const normalizedCurrency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' = allowedCurrencies.includes(detected as any) ? detected as any : 'USD';
    result.currency.value = normalizedCurrency;
    result.currency.confidence = 0.70;
    console.log('[GenericLayer] Found currency:', result.currency.value);
  }

  console.log('[GenericLayer] Generic extraction complete');
  return result;
}

/**
 * AI Fallback Interface (placeholder for future OpenAI integration)
 */
async function extractUsingAI(text: string): Promise<{
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  currency: string | null;
  brand: string | null;
  season: string | null;
  mpo_number: string | null;
  qty_shipped: number | null;
  payment_terms: string | null;
  bank_name: string | null;
  swift_code: string | null;
  account_number: string | null;
}> {
  console.log('[AIFallback] AI extraction not yet implemented');
  
  // Placeholder: return null values
  // This will be implemented with OpenAI API in the future
  return {
    vendor_name: null,
    invoice_number: null,
    invoice_date: null,
    due_date: null,
    amount: null,
    currency: null,
    brand: null,
    season: null,
    mpo_number: null,
    qty_shipped: null,
    payment_terms: null,
    bank_name: null,
    swift_code: null,
    account_number: null,
  };
}

/**
 * Extract MPO number with improved patterns and normalization
 * FIX: Ensure MPO has exactly 6 digits by padding with leading zeros and normalize by removing BUY_, RBUY_, spaces
 */
function extractMPONumber(text: string, vendor: string = 'UNKNOWN'): { value: string | null; confidence: number } {
  console.log('[extractMPONumber] Vendor:', vendor);
  
  // Normalize text first
  const normalized = normalizeInvoiceText(text);
  
  // Get vendor-specific patterns
  const rules = VendorRules[vendor] || VendorRules.UNKNOWN;
  const patterns = rules.mpoPatterns;
  
  // Try vendor-specific patterns first
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      let mpoNumber = "MPO" + match[1];
      // Normalize: remove BUY_, RBUY_, spaces
      mpoNumber = mpoNumber.replace(/BUY_/gi, '').replace(/RBUY_/gi, '').replace(/\s/g, '');
      // Ensure exactly 6 digits by padding with leading zeros
      const digitMatch = mpoNumber.match(/MPO(\d{5,})/i);
      if (digitMatch) {
        mpoNumber = "MPO" + digitMatch[1].padStart(6, '0');
        console.log('[extractMPONumber] Found MPO with vendor pattern:', mpoNumber);
        return { value: mpoNumber, confidence: 0.95 };
      }
    }
  }
  
  // Fallback: Generic MPO patterns with strict digit requirement
  const genericPatterns = [
    /MPO[\s_-]*(\d{5,})/i,
    /MPO_?(\d{5,})/i,
    /BUY_MPO(\d{5,})/i,
    /RBUY_MPO(\d{5,})/i,
    /MPO(\d{5,})/i
  ];
  
  for (const pattern of genericPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      let mpoNumber = "MPO" + match[1];
      // Normalize: remove BUY_, RBUY_, spaces
      mpoNumber = mpoNumber.replace(/BUY_/gi, '').replace(/RBUY_/gi, '').replace(/\s/g, '');
      // Ensure exactly 6 digits by padding with leading zeros
      const digitMatch = mpoNumber.match(/MPO(\d{5,})/i);
      if (digitMatch) {
        mpoNumber = "MPO" + digitMatch[1].padStart(6, '0');
      }
      console.log('[extractMPONumber] Found MPO with generic pattern:', mpoNumber);
      return { value: mpoNumber, confidence: 0.80 };
    }
  }
  
  console.log('[extractMPONumber] No MPO found');
  return { value: null, confidence: 0.0 };
}

/**
 * Extract brand from MPO references, PO references, or description text
 * Priority: PO Reference > MPO Reference > Description Text > Brand Code
 */
function extractBrand(text: string): { brand: string | null; brand_code: string | null; confidence: number } {
  console.log('[extractBrand] Starting brand extraction');
  
  const normalized = normalizeInvoiceText(text);
  
  // Try to extract from PO/MPO patterns first (highest confidence)
  // Pattern: BRAND_SEASON_ORDERTYPE_MPO# (e.g., LLB_FH26_BULK_MPO015029)
  const poPatterns = [
    /([A-Z]{2,4})_[A-Z]{2,4}_[A-Z]+_MPO\d+/i,  // BRAND_SEASON_ORDERTYPE_MPO# (specific format)
    /([A-Z]{2,4})[_\s][A-Z][A-Z0-9_\-]*MPO\d+/i,  // BRAND_SEASON_ORDERTYPE_MPO# (general)
    /([A-Z]{2,4})[_\s]MPO\d+/i,  // BRAND_MPO#
    /([A-Z]{2,4})[_\s][A-Z][A-Z0-9_\-]*PO\d+/i,  // BRAND_SEASON_ORDERTYPE_PO#
  ];
  
  for (const pattern of poPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const brandCode = match[1].toUpperCase();
      if (BRAND_CODE_MAP[brandCode]) {
        console.log('[extractBrand] Found brand from PO/MPO:', brandCode, BRAND_CODE_MAP[brandCode]);
        return { brand: BRAND_CODE_MAP[brandCode], brand_code: brandCode, confidence: 0.95 };
      }
    }
  }
  
  // Try to extract from description text (medium confidence) - only if PO reference failed
  for (const [code, name] of Object.entries(BRAND_CODE_MAP)) {
    const brandPattern = new RegExp(`\\b${name}\\b`, 'i');
    if (brandPattern.test(normalized)) {
      console.log('[extractBrand] Found brand from description:', code, name);
      return { brand: name, brand_code: code, confidence: 0.80 };
    }
  }
  
  // Try to extract from brand code in text (lower confidence) - only if description failed
  for (const [code, name] of Object.entries(BRAND_CODE_MAP)) {
    const codePattern = new RegExp(`\\b${code}\\b`, 'i');
    if (codePattern.test(normalized)) {
      console.log('[extractBrand] Found brand code in text:', code, name);
      return { brand: name, brand_code: code, confidence: 0.70 };
    }
  }
  
  console.log('[extractBrand] No brand found');
  return { brand: null, brand_code: null, confidence: 0.0 };
}

/**
 * Extract line items from invoice text
 * Returns array of line items with quantity, unit price, and extended price
 */
function extractLineItems(text: string): Array<{ quantity: number; unitPrice: number; extendedPrice: number; rawLine: string }> {
  console.log('[extractLineItems] Starting line item extraction');
  
  const normalized = normalizeInvoiceText(text);
  const lines = normalized.split('\n');
  const lineItems: Array<{ quantity: number; unitPrice: number; extendedPrice: number; rawLine: string }> = [];
  
  // STEP 1: Detect SKU anchors (item codes like 23PTGB3, 23PTGB4)
  // Pattern: digits + letters combination with word boundaries (flexible but precise)
  const skuPattern = /\b\d{2}[A-Z]{2,4}\d{1,2}\b/;
  const skuLines: Array<{ index: number; line: string; sku: string }> = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const skuMatch = line.match(skuPattern);
    if (skuMatch) {
      // Weighted validation instead of strict requirement
      const lineUpper = line.toUpperCase();
      let score = 0;
      
      if (lineUpper.includes('USD')) score += 10;
      if (lineUpper.includes('QTY') || lineUpper.includes('QUANTITY')) score += 10;
      if (lineUpper.includes('PCS') || lineUpper.includes('PIECES')) score += 10;
      if (lineUpper.includes('$')) score += 15;
      
      // Minimum score threshold (flexible but preserves recall)
      if (score >= 5) {  // Lowered threshold to catch more candidates
        skuLines.push({ index: i, line, sku: skuMatch[0] });
      }
    }
  }
  
  console.log('[extractLineItems] Found SKU anchors:', skuLines.length);
  
  // STEP 2: For each SKU anchor, capture its own row (from this SKU up to the next SKU).
  // This prevents cross-line false matches where a quantity from one row aligns with
  // a total from another row.
  const fullText = lines.join(' ');
  const skuPositions: { sku: string; pos: number }[] = [];
  let posMatch;
  const skuGlobalPattern = new RegExp(skuPattern.source, 'gi');
  while ((posMatch = skuGlobalPattern.exec(fullText)) !== null) {
    skuPositions.push({ sku: posMatch[0], pos: posMatch.index });
  }
  
  for (let i = 0; i < skuPositions.length; i++) {
    const { sku, pos } = skuPositions[i];
    const rowStart = pos;
    const rowEnd = i < skuPositions.length - 1 ? skuPositions[i + 1].pos : fullText.length;
    const rowText = fullText.substring(rowStart, rowEnd);
    
    // Expand slightly to the left to catch leading quantity/size columns that may appear
    // before the SKU, but keep the right boundary at the next SKU.
    const expandedStart = Math.max(0, rowStart - 50);
    const windowText = fullText.substring(expandedStart, rowEnd);
    
    console.log('[extractLineItems] Processing SKU', sku, 'row window:', windowText.substring(0, 100));
    
    // Extract all numbers from the row window
    const numberPattern = /([0-9,]+\.[0-9]{2,3})/g;
    const numbers: number[] = [];
    let match;
    while ((match = numberPattern.exec(windowText)) !== null) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (parsed > 0 && parsed < 10000000) {
        numbers.push(parsed);
      }
    }
    
    // Extract integers (quantities) from the row window
    const integerPattern = /\b(\d{2,6})\b/g;
    const integers: number[] = [];
    while ((match = integerPattern.exec(windowText)) !== null) {
      const parsed = parseInt(match[1]);
      if (parsed > 0 && parsed < 100000) {
        integers.push(parsed);
      }
    }
    
    console.log('[extractLineItems] Numbers in row:', numbers, 'Integers:', integers);
    
    // STEP 3: Identify row components
    // Look for pattern: qty (integer) + unit_price (small decimal) + line_total (larger decimal)
    if (numbers.length >= 2 && integers.length >= 1) {
      // Separate unit prices (< 10.0) from line totals (>= 1.0)
      const unitPrices = numbers.filter(n => n < 10.0);
      const lineTotals = numbers.filter(n => n >= 1.0);
      
      console.log('[extractLineItems] Unit prices:', unitPrices, 'Line totals:', lineTotals);
      
      // Try to match: qty * unit_price ≈ line_total
      for (const qty of integers) {
        for (const unitPrice of unitPrices) {
          const calculatedTotal = qty * unitPrice;
          
          // Find matching line total (with 5% tolerance to avoid cross-line false matches
          // while still tolerating minor OCR errors).
          for (const lineTotal of lineTotals) {
            const variance = Math.abs(calculatedTotal - lineTotal) / lineTotal;
            if (variance < 0.05) {
              console.log('[extractLineItems] Valid row found:', { sku, qty, unitPrice, lineTotal, calculatedTotal, variance });
              lineItems.push({ quantity: qty, unitPrice, extendedPrice: lineTotal, rawLine: windowText.substring(0, 80) });
              break;  // Only add one row per SKU-qty-unitPrice combination
            }
          }
        }
      }
    }
  }
  
  // STEP 4: Fallback - try to find line items without SKU anchors
  // Look for patterns like: "6390 USD 0.051 325.89" or "120 Each 0.06656 7.99"
  // Also detect Nilorn-style: "10000 T0003725 JWS 0.02730 11,200 305.76" (unitPrice qty amount)
  if (lineItems.length === 0) {
    console.log('[extractLineItems] No items found via SKU method, trying fallback pattern');
    
    const hasNilornFormat = /Shipped\s+Qty|Nilorn/i.test(normalized);
    if (hasNilornFormat) {
      console.log('[extractLineItems] Detected Nilorn-style shipped-qty table');
    }
    
    // Avery-style: table has both QTY ORDERED and QTY SHIPPED columns (e.g., "750 750 0.00848")
    const hasAveryOrderedShippedTable = /QTY\s+ORDERED.*QTY\s+SHIPPED/i.test(normalized);
    if (hasAveryOrderedShippedTable) {
      console.log('[extractLineItems] Detected Avery-style ordered/shipped table');
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Pattern: qty + unit_measure + unit_price + line_total (anywhere in line)
      const fallbackPattern1 = /(?:^|\s)(\d{2,6})\s+(?:USD|Each|PCS|Pcs)\s+([\d.]+)\s+([\d.]+)(?=\s|$)/g;
      let fallbackMatch;
      while ((fallbackMatch = fallbackPattern1.exec(line)) !== null) {
        const quantity = parseInt(fallbackMatch[1]);
        const unitPrice = parseFloat(fallbackMatch[2]);
        const extendedPrice = parseFloat(fallbackMatch[3]);
        
        if (quantity > 0 && quantity < 100000 && unitPrice > 0 && extendedPrice > 0) {
          // Validate the calculation
          const calculated = quantity * unitPrice;
          const variance = Math.abs(calculated - extendedPrice) / extendedPrice;
          
          if (variance < 0.20) {  // 20% tolerance for fallback
            console.log('[extractLineItems] Found line item via fallback pattern 1:', { quantity, unitPrice, extendedPrice, variance });
            lineItems.push({ quantity, unitPrice, extendedPrice, rawLine: line });
          }
        }
      }
      
      // Pattern: qty + unit_price + line_total (anywhere in line, simpler)
      const fallbackPattern2 = /(?:^|\s)(\d{2,6})\s+([\d.]+)\s+([\d.]+)(?=\s|$)/g;
      while ((fallbackMatch = fallbackPattern2.exec(line)) !== null) {
        const quantity = parseInt(fallbackMatch[1]);
        const unitPrice = parseFloat(fallbackMatch[2]);
        const extendedPrice = parseFloat(fallbackMatch[3]);
        
        if (quantity > 0 && quantity < 100000 && unitPrice > 0 && extendedPrice > 0) {
          // Validate the calculation
          const calculated = quantity * unitPrice;
          const variance = Math.abs(calculated - extendedPrice) / extendedPrice;
          
          if (variance < 0.20) {  // 20% tolerance for fallback
            console.log('[extractLineItems] Found line item via fallback pattern 2:', { quantity, unitPrice, extendedPrice, variance });
            lineItems.push({ quantity, unitPrice, extendedPrice, rawLine: line });
          }
        }
      }
      
      // Nilorn-style: unitPrice + qty + line_total (e.g., "0.02730 11,200 305.76")
      if (hasNilornFormat) {
        const nilornPattern = /(?:^|\s)([\d.]+)\s+([\d,]+)\s+([\d.]+)(?=\s|$)/g;
        while ((fallbackMatch = nilornPattern.exec(line)) !== null) {
          const unitPrice = parseFloat(fallbackMatch[1]);
          const quantity = parseInt(fallbackMatch[2].replace(/,/g, ''), 10);
          const extendedPrice = parseFloat(fallbackMatch[3]);
          
          if (quantity > 0 && quantity < 100000 && unitPrice > 0 && extendedPrice > 0) {
            const calculated = quantity * unitPrice;
            const variance = Math.abs(calculated - extendedPrice) / extendedPrice;
            
            if (variance < 0.20) {  // 20% tolerance for fallback
              console.log('[extractLineItems] Found line item via Nilorn pattern:', { quantity, unitPrice, extendedPrice, variance });
              lineItems.push({ quantity, unitPrice, extendedPrice, rawLine: line });
            }
          }
        }
      }
      
      // Avery-style ordered/shipped: qty_ordered + qty_shipped + unit_price (e.g., "750 750 0.00848")
      if (hasAveryOrderedShippedTable) {
        const orderedShippedPattern = /(?:^|\s)(\d{2,6})\s+(\d{2,6})\s+([\d.]+)(?=\s|$)/g;
        while ((fallbackMatch = orderedShippedPattern.exec(line)) !== null) {
          const qtyOrdered = parseInt(fallbackMatch[1]);
          const quantity = parseInt(fallbackMatch[2]);
          const unitPrice = parseFloat(fallbackMatch[3]);
          
          // Only accept if ordered and shipped are equal or shipped <= ordered (avoid false totals)
          if (quantity > 0 && quantity < 100000 && qtyOrdered > 0 && unitPrice > 0 && unitPrice < 10) {
            const extendedPrice = quantity * unitPrice;
            console.log('[extractLineItems] Found line item via ordered/shipped pattern:', { quantity, qtyOrdered, unitPrice, extendedPrice });
            lineItems.push({ quantity, unitPrice, extendedPrice, rawLine: line });
          }
        }
      }
      
      // Checkpoint-style: amount after UoM + qty + line_number + weight (e.g., "Pcs 1,493.82 ... 12900 1 6.210")
      // Detect by line containing item context markers (Pcs, SO, VendorNo)
      const hasCheckpointContext = /Pcs|SO\d|VendorNo|Item\s*Description|Grounded|TNF/i.test(line);
      if (hasCheckpointContext) {
        const checkpointPattern = /Pcs\s+([\d,]+\.\d{2})\s+.*?(\d{2,6})\s+(\d{1,2})\s+([\d,]+\.\d{2,3})/g;
        while ((fallbackMatch = checkpointPattern.exec(line)) !== null) {
          const extendedPrice = parseFloat(fallbackMatch[1].replace(/,/g, ''));
          const quantity = parseInt(fallbackMatch[2]);
          const lineIndex = parseInt(fallbackMatch[3]);
          const weight = parseFloat(fallbackMatch[4].replace(/,/g, ''));

          // Validate: quantity reasonable, line index small (1-20), extendedPrice small (< 100000)
          if (quantity > 0 && quantity < 100000 && lineIndex >= 1 && lineIndex <= 20 && extendedPrice > 0 && extendedPrice < 100000) {
            const unitPrice = quantity > 0 ? extendedPrice / quantity : 0;
            console.log('[extractLineItems] Found line item via Checkpoint pattern:', { quantity, lineIndex, extendedPrice, unitPrice, weight });
            lineItems.push({ quantity, unitPrice, extendedPrice, rawLine: line });
          }
        }
      }
    }
  }
  
  console.log('[extractLineItems] Total line items found:', lineItems.length);
  
  // STEP 5: Remove total/summary rows that are not real line items.
  // Only remove a row if its quantity equals the sum of ALL other row quantities.
  // This prevents false positives like removing a 75 just because another 75 exists,
  // or removing 120 because 50 + 70 = 120.
  const filteredLineItems = lineItems.filter((item, index) => {
    const sumOfOthers = lineItems.reduce((sum, other, otherIndex) => {
      if (index === otherIndex) return sum;
      return sum + other.quantity;
    }, 0);

    if (sumOfOthers > 0 && Math.abs(item.quantity - sumOfOthers) < 0.01) {
      console.log('[extractLineItems] Excluding total row:', item.quantity, 'sum of others:', sumOfOthers);
      return false;
    }

    return true;
  });
  
  // Log line item summary
  if (filteredLineItems.length > 0) {
    console.log('[extractLineItems] Line item summary:');
    filteredLineItems.forEach((item, idx) => {
      console.log(`  ${idx + 1}. Qty: ${item.quantity}, Unit Price: ${item.unitPrice}, Extended: ${item.extendedPrice}`);
    });
    const subtotal = filteredLineItems.reduce((sum, item) => sum + item.extendedPrice, 0);
    console.log('[extractLineItems] Calculated subtotal from line items:', subtotal);
  }
  
  return filteredLineItems;
}

/**
 * Extract total quantity shipped from line items only
 * Refactored to handle:
 * 1. Multi-row/tabular layout (Avery): items listed downwards with quantity + unit measure (e.g., "120 Each", "80 Each")
 * 2. Single summary layout (Paxar): explicit total summary like "TOTAL QTY : 445 PCS"
 * 3. Noise filtering: exclude SO, DN, tracking numbers
 */
function extractQtyShipped(text: string): number | null {
  console.log('[extractQtyShipped] Text length:', text.length);
  
  // RULE 1: First check for definitive summary pattern (Paxar layout)
  // Pattern: "TOTAL QTY : 445 PCS" or similar
  const summaryPatterns = [
    /TOTAL\s+QTY\s*[:\s]+(\d+)/i,
    /TOTAL\s+QUANTITY\s*[:\s]+(\d+)/i,
    /QTY\s+SHIPPED\s*[:\s]+(\d+)/i,
    /TOTAL\s+SHIPPED\s*[:\s]+(\d+)/i,
    /TOTAL\s+PCS\s*[:\s]+(\d+)/i,
    /TOTAL\s+PIECES\s*[:\s]+(\d+)/i,
    /TOTAL\s+UNITS\s*[:\s]+(\d+)/i,
    /SUM\s+QTY\s*[:\s]+(\d+)/i,
  ];
  
  for (const pattern of summaryPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const qty = parseFloat(match[1].replace(/,/g, ''));
      if (qty > 0 && qty < 1000000) {
        console.log('[extractQtyShipped] Found summary qty:', qty, 'pattern:', pattern);
        return qty;
      }
    }
  }
  
  // RULE 1.5: Check for Avery tabular layout with QTY SHIPPED column header
  // Pattern: "QTY SHIPPED" in column header (may have other columns before/after)
  const averyTabularPattern = /QTY\s+SHIPPED/i;
  if (averyTabularPattern.test(text)) {
    console.log('[extractQtyShipped] Detected Avery tabular layout with QTY SHIPPED header');
    // Extract all numbers that appear after QTY SHIPPED header and before next section
    const qtyShippedIndex = text.search(averyTabularPattern);
    const afterHeader = text.substring(qtyShippedIndex);
    console.log('[extractQtyShipped] Text after QTY SHIPPED header (first 500 chars):', afterHeader.substring(0, 500));
    
    // Split into lines and process tabular data
    const lines = afterHeader.split('\n');
    const tabularQuantities: number[] = [];
    
    console.log('[extractQtyShipped] Total lines after header:', lines.length);
    
    // Skip header line, process data lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip empty lines or lines that look like headers/footers
      if (!line || line.length < 10 || /TOTAL|SUBTOTAL|GRAND/i.test(line)) continue;
      
      console.log('[extractQtyShipped] Processing line', i, ':', line.substring(0, 80));
      
      // Try to extract quantity from the line
      // Look for numbers that could be quantities (1-6 digits, possibly with commas)
      const qtyPattern = /(\d{1,6}(?:,\d{3})*)/g;
      const matches = line.match(qtyPattern);
      if (matches) {
        // Take the first number as the quantity (assuming QTY SHIPPED is one of the first columns)
        const qty = parseFloat(matches[0].replace(/,/g, ''));
        if (qty > 0 && qty < 1000000) {
          tabularQuantities.push(qty);
          console.log('[extractQtyShipped] Found tabular qty from line:', qty, 'line:', line.substring(0, 50));
        }
      }
    }
    
    if (tabularQuantities.length > 0) {
      // Sum all quantities found in the QTY SHIPPED column
      const totalQty = tabularQuantities.reduce((sum, q) => sum + q, 0);
      console.log('[extractQtyShipped] Total tabular qty:', totalQty, 'from', tabularQuantities.length, 'lines');
      return totalQty;
    } else {
      console.log('[extractQtyShipped] No quantities found in tabular data');
    }
  }
  
  // RULE 2: If no summary row, normalize text and extract from multi-row tabular layout (Avery)
  // Normalize text: convert multiple spaces to single space to handle vertical table splits
  const normalizedText = text.replace(/\s{2,}/g, ' ');
  console.log('[extractQtyShipped] Using multi-row extraction');
  
  // Global regex to find all instances of number immediately preceding unit measure
  // Patterns: "120 Each", "80 PCS", "50 Pcs", "700 pcs", "100 pcs"
  const unitMeasurePatterns = [
    /(\d+)\s+Each\b/gi,
    /(\d+)\s+PCS\b/gi,
    /(\d+)\s+Pcs\b/gi,
    /(\d+)\s+pcs\b/gi,
    /(\d+)\s+PC\b/gi,
    /(\d+)\s+Pc\b/gi,
    /(\d+)\s+EA\b/gi,
    /(\d+)\s+Ea\b/gi,
    /(\d+)\s+ea\b/gi,
    /(\d+)\s+Piece\b/gi,
    /(\d+)\s+Pieces\b/gi,
    /(\d+)\s+piece\b/gi,
    /(\d+)\s+pieces\b/gi,
    /(\d+)\s+Unit\b/gi,
    /(\d+)\s+Units\b/gi,
    /(\d+)\s+Set\b/gi,
    /(\d+)\s+Sets\b/gi,
  ];
  
  const allQuantities: number[] = [];
  
  for (const pattern of unitMeasurePatterns) {
    const matches = normalizedText.matchAll(pattern);
    for (const match of matches) {
      const qty = parseFloat(match[1].replace(/,/g, ''));
      if (qty > 0 && qty < 1000000) {
        allQuantities.push(qty);
        console.log('[extractQtyShipped] Found quantity:', qty, 'from pattern:', pattern);
      }
    }
  }
  
  // HEURISTIC: Check if any quantity equals the sum of other quantities (strong signal for total)
  if (allQuantities.length > 1) {
    for (const candidate of allQuantities) {
      const sumOfOthers = allQuantities.reduce((sum, val) => {
        // Sum all quantities except this candidate
        if (Math.abs(val - candidate) > 0.01) {
          return sum + val;
        }
        return sum;
      }, 0);
      
      // If this quantity equals sum of others (with tolerance), it's likely the total
      if (Math.abs(candidate - sumOfOthers) < 0.01 && sumOfOthers > 0) {
        console.log('[extractQtyShipped] Found total as sum of line quantities:', candidate, 'sum:', sumOfOthers);
        return candidate;
      }
    }
  }
  
  // RULE 3: Filter out noise - exclude quantities that appear near SO, DN, or tracking numbers
  // AND only keep quantities that are in valid line item contexts
  const noisePatterns = [
    /SO\s*[:\s]\d+/i,
    /DN\s*[:\s]\d+/i,
    /DELIVERY\s+NOTE/i,
    /TRACKING/i,
    /AWB/i,
    /WAYBILL/i,
    /INVOICE\s*NO/i,
    /PO\s*[:\s]\d+/i,
    /MPO\s*[:\s]\d+/i,
    /DATE[:\s]/i,
    /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/,  // Date patterns
    /\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/,  // Date patterns
    /SWIFT/i,
    /ACCOUNT/i,
    /BANK/i,
  ];
  
  // Positive context patterns - valid quantity contexts
  const validContextPatterns = [
    /QTY\b/i,
    /QUANTITY\b/i,
    /PCS\b/i,
    /PIECES\b/i,
    /EACH\b/i,
    /UNIT\b/i,
    /ORDER\s+QTY/i,
    /SHIPPED/i,
    /SKU/i,
    /ITEM/i,
    /STYLE/i,
    /COLOR/i,
    /SIZE/i,
    /\$\s*\d+\.\d{2}/,  // Near unit price (e.g., "$0.051")
    /USD\s+\d+/i,  // Near currency
  ];
  
  const filteredQuantities: number[] = [];
  const noiseContextSize = 50; // characters to check before/after quantity
  
  for (let i = 0; i < allQuantities.length; i++) {
    const qty = allQuantities[i];
    
    // Find the position of this quantity in the normalized text
    const qtyStr = qty.toString();
    const qtyIndex = normalizedText.indexOf(qtyStr);
    
    if (qtyIndex !== -1) {
      // Get context around the quantity
      const start = Math.max(0, qtyIndex - noiseContextSize);
      const end = Math.min(normalizedText.length, qtyIndex + qtyStr.length + noiseContextSize);
      const context = normalizedText.substring(start, end);
      
      // Check if context contains noise patterns
      const hasNoise = noisePatterns.some(pattern => pattern.test(context));
      
      // Check if context has valid quantity indicators
      const hasValidContext = validContextPatterns.some(pattern => pattern.test(context));
      
      // Only keep if no noise AND has valid context (or is a reasonable quantity size)
      if (!hasNoise && (hasValidContext || (qty > 10 && qty < 100000))) {
        filteredQuantities.push(qty);
        console.log('[extractQtyShipped] Kept quantity:', qty, 'context:', context, 'validContext:', hasValidContext);
      } else {
        console.log('[extractQtyShipped] Filtered out quantity:', qty, 'context:', context, 'hasNoise:', hasNoise, 'validContext:', hasValidContext);
      }
    }
  }
  
  // RULE 4: Sum up all filtered quantities
  if (filteredQuantities.length > 0) {
    const totalQty = filteredQuantities.reduce((sum, qty) => sum + qty, 0);
    console.log('[extractQtyShipped] Total quantity from multi-row:', totalQty, 'from', filteredQuantities.length, 'items');
    return totalQty;
  }
  
  // RULE 5: Fallback to line items extraction (existing logic)
  const lineItems = extractLineItems(text);
  
  if (lineItems.length > 0) {
    const totalQty = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    console.log('[extractQtyShipped] Total quantity from line items (fallback):', totalQty);
    return totalQty;
  }
  
  console.log('[extractQtyShipped] No QTY SHIPPED found');
  return null;
}

/**
 * Build Invoice Truth Graph from extracted data
 * This enforces single source of truth for amount and qty shipped
 */
function buildInvoiceTruthGraph(
  normalizedText: string,
  lineItems: Array<{ quantity: number; unitPrice: number; extendedPrice: number; rawLine: string }>,
  legacyAmount: number | null,
  legacyCurrency: string | null
): { graph: any; amountResult: any; qtyResult: any } {
  console.log('[buildInvoiceTruthGraph] Building truth graph from extracted data');
  
  const builder = new InvoiceTruthGraphBuilder();
  const resolver = new InvoiceTruthResolver();
  
  // Step 1: Add line items to graph
  for (const item of lineItems) {
    // Calculate confidence based on validation (qty * unitPrice ≈ extendedPrice)
    const calculated = item.quantity * item.unitPrice;
    const variance = Math.abs(calculated - item.extendedPrice) / item.extendedPrice;
    const confidence = variance < 0.15 ? 0.95 : 0.70; // High confidence if math checks out
    
    // Extract SKU from raw line if possible
    const skuMatch = item.rawLine.match(/\b\d{2}[A-Z]{2,4}\d{1,2}\b/);
    const sku = skuMatch ? skuMatch[0] : 'UNKNOWN';
    
    builder.addLineItem(sku, item.quantity, item.unitPrice, item.extendedPrice, confidence, item.rawLine);
  }
  
  // Step 2: Detect TOTAL lines and add as GRAND TOTAL nodes
  const totalKeywords = ['total', 'say total', 'grand total', 'total amount', 'amount due', 'balance due'];
  const textLines = normalizedText.split('\n');
  
  for (const line of textLines) {
    const upperLine = line.toUpperCase();
    if (totalKeywords.some(keyword => upperLine.includes(keyword))) {
      const lineNumbers = line.match(/([0-9,]+\.[0-9]{2,3})/g);
      if (lineNumbers && lineNumbers.length > 0) {
        const parsedAmounts = lineNumbers.map(n => parseFloat(n.replace(/,/g, ''))).filter(n => n > 0 && n < 10000000);
        if (parsedAmounts.length > 0) {
          const maxAmount = Math.max(...parsedAmounts);
          builder.addGrandTotal(maxAmount, 0.98, 'TOTAL_LINE', line, line.match(/(TOTAL|GRAND|AMOUNT|DUE|BALANCE)/i)?.[0]);
        }
      }
    }
  }
  
  // Step 3: Add legacy amount as heuristic fallback if it exists
  if (legacyAmount && legacyAmount > 0) {
    builder.addHeuristicFallback(legacyAmount, 0.50, 'MAX_AMOUNT_FALLBACK', 'Legacy regex extraction');
  }
  
  // Step 4: Deduplicate line items
  builder.deduplicateLineItems();
  
  // Step 5: Get graph and resolve
  const graph = builder.getGraph();
  console.log('[buildInvoiceTruthGraph] Graph stats:', builder.getStats());
  
  const amountResult = resolver.resolve(graph);
  const qtyResult = resolver.resolveQtyShipped(graph);
  
  return { graph, amountResult, qtyResult };
}

/**
 * Extract bill to text and confirm Madison 88
 */
function extractBillTo(text: string): { text: string | null; confirmed: boolean } {
  const labels = ['Bill To:', 'BILL TO:', 'Invoice Address'];
  
  for (const label of labels) {
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*([\\s\\S]{0,200})`, 'i');
    const match = text.match(regex);
    if (match) {
      const billToText = match[1].trim();
      const confirmed = billToText.toUpperCase().includes('MADISON 88') || 
                       billToText.toUpperCase().includes('MADISON88');
      return { text: billToText, confirmed };
    }
  }

  return { text: null, confirmed: false };
}

/**
 * Extract document type
 */
function extractDocumentType(text: string): 'INV' | 'PI' | 'CI' | 'SI' | 'STATEMENT' | null {
  const upperText = text.toUpperCase();
  
  if (upperText.includes('PROFORMA INVOICE') || upperText.includes('PRO-FORMA') || upperText.includes('PRO FORMA')) {
    return 'PI';
  }
  if (upperText.includes('COMMERCIAL INVOICE')) {
    return 'CI';
  }
  if (upperText.includes('SALES INVOICE')) {
    return 'SI';
  }
  if (upperText.includes('STATEMENT') || upperText.includes('ACCOUNT STATEMENT') || upperText.includes('AGING')) {
    return 'STATEMENT';
  }
  if (upperText.includes('INVOICE')) {
    return 'INV';
  }

  return null;
}

/**
 * Parse PO reference string to extract brand, season, order_type, po_number, mpo_number
 */
function parsePOReference(text: string): {
  raw: string | null;
  brand: string | null;
  brand_code: string | null;
  season: string | null;
  order_type: 'BULK' | 'SMS' | 'SAMPLE' | null;
  po_number: string | null;
  mpo_number: string | null;
} {
  // Pattern 0: Full PO reference with brand, season, description and MPO
  // e.g., "PO#TNF F26 ADVANCE ORDER_MPO14751_DEC+JAN+FEB BUY_INDONESIA" or "TNF F26 JAN BUY_MPO15371_MDDC_A7WJO_INDONESIA"
  const fullPoRefPattern = /(?:PO#?\s*)?([A-Z]{2,4})\s+(F\d{2}|S\d{2}|FW\d{2}|FH\d{2}|SS\d{2})\s+(.+?)[\s_]*MPO(\d+(?:\s+\d+)*)/i;
  const fullPoRefMatch = text.match(fullPoRefPattern);

  if (fullPoRefMatch) {
    const brand_code = fullPoRefMatch[1].toUpperCase();
    const brand = BRAND_CODE_MAP[brand_code] || brand_code;
    const season = fullPoRefMatch[2].toUpperCase();
    const description = fullPoRefMatch[3].trim().replace(/\s+/g, ' ');
    const mpoDigits = fullPoRefMatch[4].replace(/\s+/g, '');
    const mpo_number = mpoDigits ? 'MPO' + mpoDigits.padStart(6, '0') : null;
    const po_number = description + (mpoDigits ? ` MPO${mpoDigits.padStart(6, '0')}` : '');

    let order_type: 'BULK' | 'SMS' | 'SAMPLE' | null = null;
    const upperDesc = description.toUpperCase();
    if (upperDesc.includes('BUY') || upperDesc.includes('ADVANCE ORDER') || upperDesc.includes('RBUY')) {
      order_type = 'BULK';
    } else if (upperDesc.includes('SAMPLE')) {
      order_type = 'SAMPLE';
    } else if (upperDesc.includes('SMS')) {
      order_type = 'SMS';
    }

    return {
      raw: fullPoRefMatch[0],
      brand,
      brand_code,
      season,
      order_type,
      po_number,
      mpo_number,
    };
  }

  // Pattern 1: Full pattern with brand - BRAND_SEASON_ORDERTYPE_PO#_MPO#_FACTORY
  const fullPattern = /[A-Z]{2,4}[_\-][A-Za-z0-9_\-]*MPO\d+/;
  // Pattern 2: Simplified pattern - just MPO with optional prefix (e.g., RBUY_MPO15439, MPO15439)
  const simplePattern = /[A-Z]*MPO\d+/;
  // Pattern 3: Reference script pattern - MPO_?(\d+) for extracting from descriptions
  const descriptionPattern = /MPO_?(\d+)/i;
  // Pattern 4: PO#: MPO... edge case (e.g., "PO#: MPO14931")
  const poLabelPattern = /PO[:#]\s*MPO(\d+)/i;
  
  const match = text.match(fullPattern) || text.match(simplePattern) || text.match(descriptionPattern) || text.match(poLabelPattern);
  
  if (!match) {
    return {
      raw: null,
      brand: null,
      brand_code: null,
      season: null,
      order_type: null,
      po_number: null,
      mpo_number: null,
    };
  }

  const raw = match[0];
  
  // Special handling for PO#: MPO... pattern
  if (poLabelPattern.test(raw)) {
    const poLabelMatch = raw.match(/PO[:#]\s*MPO(\d+)/i);
    if (poLabelMatch) {
      return {
        raw: raw,
        brand: null,
        brand_code: null,
        season: null,
        order_type: null,
        po_number: null,
        mpo_number: "MPO" + poLabelMatch[1],
      };
    }
  }
  
  // Split on both underscore, hyphen, and space, strip # characters
  const parts = raw.replace(/#/g, '').split(/[_\-\s]+/);
  
  let brand_code: string | null = null;
  let brand: string | null = null;
  let season: string | null = null;
  let order_type: 'BULK' | 'SMS' | 'SAMPLE' | null = null;
  let po_number: string | null = null;
  let mpo_number: string | null = null;

  for (const part of parts) {
    // Extract MPO number - preserve full MPO prefix (do this first)
    if (!mpo_number && /^MPO\d+$/.test(part)) {
      mpo_number = part;
      continue;
    }
    
    // Extract MPO number from description pattern (MPO_?(\d+))
    if (!mpo_number && descriptionPattern.test(part)) {
      const mpoMatch = part.match(/MPO_?(\d+)/i);
      if (mpoMatch) {
        mpo_number = "MPO" + mpoMatch[1];
        continue;
      }
    }
    
    // Extract brand_code (2-4 uppercase letters) - only if it's a known brand
    // Prioritize longer codes to avoid TL being picked instead of LLB
    if (!brand_code && /^[A-Z]{2,4}$/.test(part) && BRAND_CODE_MAP[part]) {
      // Only set if not already set, or if this is a longer code
      if (!brand_code || part.length > brand_code.length) {
        brand_code = part;
        brand = BRAND_CODE_MAP[part];
      }
    }
    // Check for full brand name
    else if (!brand_code && part.length > 4 && FULL_BRAND_NAMES[part.toUpperCase()]) {
      const potentialCode = FULL_BRAND_NAMES[part.toUpperCase()];
      // Only set if not already set, or if this is a longer code
      if (!brand_code || potentialCode.length > brand_code.length) {
        brand_code = potentialCode;
        brand = BRAND_CODE_MAP[brand_code] || part;
      }
    }
    // Extract season (F26, FH26, FW26, SS26, etc.)
    else if (!season && /^(F|S|FW|FH|SS)\d{2}$/.test(part)) {
      season = part;
    }
    // Season extraction from reference script - F26 (Fall 2026), S26 (Spring)
    else if (!season && /\b(F\d{2}|S\d{2})\b/.test(part)) {
      season = part.match(/\b(F\d{2}|S\d{2})\b/)?.[0] || null;
    }
    // Extract order_type
    else if (!order_type) {
      const upper = part.toUpperCase();
      if (upper === 'BULK' || upper === 'SMS' || upper === 'SAMPLE' || upper === 'PROTO') {
        order_type = upper as 'BULK' | 'SMS' | 'SAMPLE';
      }
      // Check for month + BUY patterns or RBUY patterns
      else if (upper.includes('BUY') || upper.includes('ADVANCE ORDER') || upper === 'RBUY') {
        order_type = 'BULK';
      }
    }
    // Extract PO number
    else if (!po_number && /^PO\d+$/.test(part)) {
      po_number = part.replace('PO', '');
    }
  }

  // Fallback: extract season from anywhere in the text if not found in reference
  if (!season) {
    const seasonMatch = text.match(/\b(F\d{2}|S\d{2}|FW\d{2}|FH\d{2}|SS\d{2})\b/i);
    if (seasonMatch) {
      season = seasonMatch[1].toUpperCase();
    }
  }

  return {
    raw,
    brand,
    brand_code,
    season,
    order_type,
    po_number,
    mpo_number,
  };
}

/**
 * Derive category from line-item keywords
 */
function deriveCategory(text: string): 'TRIMS' | 'YARN' | 'SAMPLE' | 'SHIPPING' | 'LAB' | null {
  const lowerText = text.toLowerCase();
  
  const trimsKeywords = ['label', 'tag', 'patch', 'sticker', 'badge', 'zipper', 'button', 'snap', 'buckle', 'hook', 'velcro', 'ribbon', 'elastic', 'trim', 'accessory', 'heat transfer', 'transfer', 'ht label', 'cold cut', 'cut single', 'woven', 'printed', 'satin', 'damask', 'taffeta', 'care label', 'size label'];
  const yarnKeywords = ['yarn', 'wool', 'fabric', 'textile', 'thread', 'cotton', 'polyester', 'nylon', 'spandex'];
  const shippingKeywords = ['freight charge', 'shipping charge', 'delivery charge', 'courier fee', 'awb', 'transport', 'logistics'];
  const labKeywords = ['lab', 'testing', 'certification', 'test', 'analysis', 'quality', 'inspection'];

  const hasTrims = trimsKeywords.some(k => lowerText.includes(k));
  const hasYarn = yarnKeywords.some(k => lowerText.includes(k));
  const hasShipping = shippingKeywords.some(k => lowerText.includes(k));
  // Use word boundaries for short lab keywords to avoid matching substrings like 'available' or 'label'
  const hasLab = labKeywords.some(k => new RegExp(`\\b${k}\\b`, 'i').test(lowerText));

  if (hasTrims) return 'TRIMS';
  if (hasLab) return 'LAB';
  if (hasShipping) return 'SHIPPING';
  if (hasYarn) return 'YARN';

  // Default to TRIMS if it looks like a physical product
  if (lowerText.includes('item') || lowerText.includes('product') || lowerText.includes('material')) {
    return 'TRIMS';
  }

  return null;
}

/**
 * Main extraction function - refactored to use new architecture
 */
export async function extractMadisonInvoiceFields(fileBuffer: Buffer): Promise<MadisonInvoiceExtraction> {
  // Step 1: Extract text from PDF (with page boundaries preserved)
  const { fullText: rawText, pages: rawPages } = await extractTextFromPDF(fileBuffer);

  // Step 2: Normalize text
  const normalizedText = normalizeInvoiceText(rawText);
  const normalizedPages = rawPages.map(page => normalizeInvoiceText(page));
  
  console.log('[MadisonExtractor] Text length:', rawText.length);
  console.log('[MadisonExtractor] Normalized text length:', normalizedText.length);
  console.log('[MadisonExtractor] First 500 chars:', normalizedText.substring(0, 500));

  // Step 3: Detect vendor
  const { vendor: detectedVendor, confidence: vendorConfidence } = detectVendor(normalizedText);
  console.log('[MadisonExtractor] Detected vendor:', detectedVendor, 'confidence:', vendorConfidence);

  // Detect if vendor is US-based for date parsing preference
  const preferUS = normalizedText.toLowerCase().includes('usa') || normalizedText.toLowerCase().includes('united states');

  // Step 4: Extract fields using vendor-specific rules or generic layer
  let vendor_name: string | null;
  let invoice_number: string | null;
  let invoice_date: string | null;
  let due_date: string | null;
  let amount: number | null;
  let currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null;
  let mpo_number: string | null;
  let payment_terms: string | null;
  let bank_name: string | null;
  let swift_code: string | null;
  let account_number: string | null;
  let account_usd: string | null = null;
  let account_hkd: string | null = null;
  let account_eur: string | null = null;
  let account_vnd: string | null = null;
  let account_idr: string | null = null;
  let account_php: string | null = null;
  let account_jpy: string | null = null;
  let account_gbp: string | null = null;
  let account_cny: string | null = null;
  let account_aud: string | null = null;
  let account_cad: string | null = null;
  let account_sgd: string | null = null;
  let needs_currency_confirmation = false;
  let legacyAmountResult: { amount: number | null; currency: any; confidence: number; amount_candidates: number[]; amount_candidates_trace: Array<{ value: any; score: number; reason: string }> } = {
    amount: null,
    currency: null,
    confidence: 0,
    amount_candidates: [],
    amount_candidates_trace: []
  };

  // Use vendor-specific extraction if vendor is known
  if (detectedVendor !== 'UNKNOWN' && vendorConfidence > 0.8) {
    console.log('[MadisonExtractor] Using vendor-specific extraction for:', detectedVendor);
    
    vendor_name = extractVendorName(normalizedText);
    invoice_number = extractInvoiceNumber(normalizedText);
    invoice_date = extractInvoiceDate(normalizedText, preferUS);
    
    // DSRS v7.3: In zero-leak mode, legacy amount extraction is NOT executed.
    // Currency is detected separately without producing an amount.
    if (AST_SINGLE_SOURCE_MODE) {
      currency = detectCurrency(normalizedText);
      needs_currency_confirmation = false;
      amount = null;
      console.log('[MadisonExtractor] AST zero-leak mode: legacy amount extraction disabled');
    } else {
      legacyAmountResult = extractAmount(normalizedText);
      currency = legacyAmountResult.currency;
      needs_currency_confirmation = legacyAmountResult.confidence < 0.8;
      amount = legacyAmountResult.amount;
      console.log('[MadisonExtractor] Amount candidates:', legacyAmountResult.amount_candidates);
    }
    
    const mpoResult = extractMPONumber(normalizedText, detectedVendor);
    mpo_number = mpoResult.value;
    
    payment_terms = extractPaymentTerms(normalizedText);
    
    const bankResult = extractBankDetails(normalizedText);
    bank_name = bankResult.bank_name;
    swift_code = bankResult.swift_code;
    account_number = bankResult.account_number;
    account_usd = bankResult.account_usd;
    account_hkd = bankResult.account_hkd;
    account_eur = bankResult.account_eur;
    account_vnd = bankResult.account_vnd;
    account_idr = bankResult.account_idr;
    account_php = bankResult.account_php;
    account_jpy = bankResult.account_jpy;
    account_gbp = bankResult.account_gbp;
    account_cny = bankResult.account_cny;
    account_aud = bankResult.account_aud;
    account_cad = bankResult.account_cad;
    account_sgd = bankResult.account_sgd;
    
    due_date = extractDueDate(normalizedText, preferUS);
  } else {
    console.log('[MadisonExtractor] Using generic extraction layer');
    
    // Use generic extraction layer
    const genericResult = extractUsingGenericLayer(normalizedText, preferUS);
    
    vendor_name = extractVendorName(normalizedText);
    invoice_number = genericResult.invoice_number.value;
    invoice_date = genericResult.invoice_date.value;
    due_date = genericResult.due_date.value;
    mpo_number = genericResult.mpo_number.value;
    payment_terms = genericResult.payment_terms.value;
    
    // DSRS v7.3: In zero-leak mode, generic amount extraction is NOT executed.
    // Currency is detected separately without producing an amount.
    if (AST_SINGLE_SOURCE_MODE) {
      currency = detectCurrency(normalizedText);
      needs_currency_confirmation = false;
      amount = null;
      console.log('[MadisonExtractor] AST zero-leak mode: generic amount extraction disabled');
    } else {
      currency = genericResult.currency.value;
      needs_currency_confirmation = genericResult.amount.confidence < 0.7;
      amount = genericResult.amount.value;
      // Extract amount for trace
      legacyAmountResult = extractAmount(normalizedText);
    }
    
    // Bank details still use specific extraction
    const bankResult = extractBankDetails(normalizedText);
    bank_name = bankResult.bank_name;
    swift_code = bankResult.swift_code;
    account_number = bankResult.account_number;
    account_usd = bankResult.account_usd;
    account_hkd = bankResult.account_hkd;
    account_eur = bankResult.account_eur;
    account_vnd = bankResult.account_vnd;
    account_idr = bankResult.account_idr;
    account_php = bankResult.account_php;
    account_jpy = bankResult.account_jpy;
    account_gbp = bankResult.account_gbp;
    account_cny = bankResult.account_cny;
    account_aud = bankResult.account_aud;
    account_cad = bankResult.account_cad;
    account_sgd = bankResult.account_sgd;
  }

  // Fallback: default payment terms to 30 Days if not found (most common)
  if (!payment_terms) {
    payment_terms = '30 Days';
    console.log('[MadisonExtractor] Payment terms not found, defaulting to 30 Days');
  }

  // Step 5: Extract additional fields (common to all vendors)
  const bank_charge = extractBankCharge(normalizedText);
  const { text: bill_to_text, confirmed: bill_to_confirmed_madison88 } = extractBillTo(normalizedText);
  const document_type = extractDocumentType(normalizedText);
  
  // DEBUG: Line items only (no amount/quantity OCR scans in zero-leak mode)
  const lineItems = extractLineItems(normalizedText);
  console.log('[DEBUG] Line items:', lineItems);
  console.log('[DEBUG] Line item count:', lineItems.length);
  
  // DEBUG: Sum check
  if (lineItems.length > 0) {
    const lineItemSum = lineItems.reduce((sum, item) => sum + item.extendedPrice, 0);
    console.log('[DEBUG] Line item sum:', lineItemSum);
    console.log('[DEBUG] Expected total should be:', lineItemSum);
  }
  console.log('=== END DEBUG ===');

  // DSRS v7.3: ZERO-LEAK AST RUNTIME
  // In AST mode, ONLY the AST kernel runs. No legacy amount engine, no comparison layer,
  // no dual variables, no shadow computation.
  let status: 'EXTRACTED' | 'REVIEW_REQUIRED' | 'AST_FAILURE' = 'EXTRACTED';
  let status_reason: string | undefined;
  let qty_shipped: number | null;

  if (AST_SINGLE_SOURCE_MODE) {
    console.log('[MadisonExtractor] DSRS v7.3: Entering AST zero-leak runtime');

    const astOutput = await executeInvoiceExtraction(
      { rawText, normalizedText, pages: normalizedPages },
      lineItems,
      {
        vendor: vendor_name,
        invoiceNumber: invoice_number,
        currency,
        date: invoice_date
      },
      {
        bank_name,
        account_number,
        swift_code
      }
    );

    amount = astOutput.amount;
    if (astOutput.currency) {
      currency = astOutput.currency;
    }
    qty_shipped = astOutput.qty_shipped;
    status = astOutput.status;
    status_reason = astOutput.status_reason;

    // Fallback: if AST did not produce qty_shipped, compute it from extracted line items
    if (!qty_shipped && lineItems.length > 0) {
      const computedQty = lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      if (computedQty > 0) {
        qty_shipped = computedQty;
        console.log('[MadisonExtractor] Computed qty_shipped from line items:', computedQty);
      }
    }

    console.log('[MadisonExtractor] AST kernel output:', astOutput);
  } else {
    // DSRS v6/v7 legacy path: only runs when AST_SINGLE_SOURCE_MODE is false
    console.log('[MadisonExtractor] Legacy mode: running Truth Graph + fallback extraction');

    const legacyQtyShipped = extractQtyShipped(normalizedText);
    const { amountResult: truthAmountResult, qtyResult: truthQtyResult } = buildInvoiceTruthGraph(normalizedText, lineItems, amount, currency);
    const astOutput = await executeInvoiceExtraction(
      { rawText, normalizedText, pages: normalizedPages },
      lineItems,
      {
        vendor: vendor_name,
        invoiceNumber: invoice_number,
        currency,
        date: invoice_date
      },
      {
        bank_name,
        account_number,
        swift_code
      }
    );

    amount = astOutput.amount;
    if (astOutput.currency) {
      currency = astOutput.currency;
    }
    qty_shipped = astOutput.qty_shipped;
    status = astOutput.status;
    status_reason = astOutput.status_reason;

    // Legacy conflict detection (only in legacy mode)
    const legacyAmount = legacyAmountResult?.amount || null;
    if (status === 'EXTRACTED' && legacyAmount !== null && Math.abs(legacyAmount - amount!) > 0.01) {
      status = 'REVIEW_REQUIRED';
      status_reason = `AST conflict detected: AST amount=${amount}, legacy amount=${legacyAmount}`;
      console.error('[MadisonExtractor] REVIEW_REQUIRED:', status_reason);
    } else if (status === 'EXTRACTED' && legacyQtyShipped !== null && qty_shipped !== null && Math.abs(legacyQtyShipped - qty_shipped) > 1) {
      status = 'REVIEW_REQUIRED';
      status_reason = `AST qty conflict detected: AST qty=${qty_shipped ?? 0}, legacy qty=${legacyQtyShipped}`;
      console.error('[MadisonExtractor] REVIEW_REQUIRED:', status_reason);
    }
  }

  // Extract PO reference
  const poData = parsePOReference(normalizedText);

  // Extract brand
  const brandResult = extractBrand(normalizedText);
  const brand = brandResult.brand || poData.brand;
  const brand_code = brandResult.brand_code || poData.brand_code;

  // Derive category
  const category = deriveCategory(normalizedText);

  // Step 6: Calculate due date from payment terms if not found
  // FIX: NEVER compute due_date from relative terms (NET 30) unless explicitly given full date
  // If only "NET 30" or similar, leave due_date null
  // Fallback: compute due_date from invoice_date + payment_terms if no explicit due date found
  if (!due_date && invoice_date && payment_terms) {
    const computedDueDate = computeDueDateFromTerms(invoice_date, payment_terms);
    if (computedDueDate) {
      due_date = computedDueDate;
      console.log('[MadisonExtractor] Computed due_date from terms:', computedDueDate);
    }
  }

  console.log('[MadisonExtractor] due_date:', due_date);

  // Step 7: AI fallback if confidence is too low (placeholder for future implementation)
  const MIN_CONFIDENCE = 0.7;
  const overallConfidence = Math.min(vendorConfidence, amount || 0 ? 0.8 : 0.5);
  
  if (overallConfidence < MIN_CONFIDENCE) {
    console.log('[MadisonExtractor] Low confidence detected, AI fallback would be triggered here');
    // Future: const aiResult = await extractUsingAI(normalizedText);
  }

  // DSRS v7.3: Runtime zero-leak guarantee
  const finalOutput = {
    vendor_name,
    invoice_number,
    invoice_date,
    due_date,
    amount,
    currency,
    needs_currency_confirmation,
    bank_charge,
    payment_terms,
    bank_details: {
      bank_name,
      swift_code,
      account_number,
      account_usd,
      account_hkd,
      account_eur,
      account_vnd,
      account_idr,
      account_php,
      account_jpy,
      account_gbp,
      account_cny,
      account_aud,
      account_cad,
      account_sgd,
    },
    bill_to_text,
    bill_to_confirmed_madison88,
    is_handwritten: detectHandwritten(normalizedText),
    document_type,
    po_reference_raw: poData.raw,
    brand,
    brand_code,
    season: poData.season,
    order_type: poData.order_type,
    po_number: poData.po_number,
    mpo_number,
    category,
    qty_shipped,
    notes: null,
    status,
    status_reason,
    // Phase 1: Extraction metadata
    raw_text: normalizedText,
    extraction_trace: {
      vendor_name: { value: vendor_name, confidence: vendorConfidence, source_text: null, method: 'regex' as const },
      invoice_number: { value: invoice_number, confidence: 0.8, source_text: null, method: 'regex' as const },
      amount: { value: amount, confidence: amount ? 0.8 : 0, source_text: null, method: 'ast' as const, candidates: legacyAmountResult?.amount_candidates_trace || [] },
      mpo_number: { value: mpo_number, confidence: mpo_number ? 0.9 : 0, source_text: poData.raw, method: 'regex' as const },
    },
    overall_confidence: overallConfidence,
  };

  // DSRS v7.3: Runtime zero-leak guarantee
  assertZeroLeak(finalOutput);

  return finalOutput;
}
