/**
 * Shared constants for the Madison invoice extraction pipeline.
 * Extracted from madisonInvoiceExtractor.ts to reduce monolith size.
 */

// DSRS v7.2: SINGLE SOURCE OF TRUTH AST LOCK MODE
export const AST_SINGLE_SOURCE_MODE = true;

// Shared date capture regex: matches DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD-MMM-YYYY,
// DD-MMM-YY, DD MMM YYYY, DD MMM YY, YYYY-MM-DD, YYYY/MM/DD
export const DATE_CAPTURE_PATTERN =
  `(?:\\d{1,2}[\\/\\-.]\\s*\\d{1,2}[\\/\\-.]\\s*\\d{2,4}|\\d{1,2}[\\/\\-.]\\s*[A-Za-z]{3}\\s*[\\/\\-.]\\s*\\d{2,4}|\\d{1,2}\\s+[A-Za-z]{3}\\s*,?\\s*\\d{2,4}|\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2})`;

export const FIELD_ALIASES = {
  invoice_number: [
    'invoice no',
    'invoice number',
    'invoice #',
    'document no',
    'reference no',
    'i/v no',
    'pi no',
    'order #',
    'ref',
    'g & f no',
    'g & f no.',
    'g&f no',
    'g&f no.',
    's/c no',
    's/c no.',
    'sc-',
    // Chinese labels (bilingual invoices)
    '发票号码',
    '发票编号',
    '发票号',
    '票據號碼',
    '票據編號',
  ],
  invoice_date: [
    'invoice date',
    'billing date',
    'issued date',
    'date',
    'invoice dt',
    // Chinese labels
    '发票日期',
    '开票日期',
    '開票日期',
    '日期',
  ],
  due_date: [
    'due date',
    'invoice due',
    'payment due',
    'payment due date',
    'due by',
    // Chinese labels
    '到期日期',
    '付款期限',
    '截止日期',
  ],
  payment_terms: [
    'credit term',
    'terms',
    'payment terms',
    'credit terms',
    'term',
    // Chinese labels
    '付款条件',
    '付款方式',
    '信贷条款',
  ],
  amount: [
    'total',
    'total amount',
    'grand total',
    'invoice amount',
    'order total',
    'amount due',
    'balance due',
    'total due',
    // Chinese labels
    '总计',
    '合计',
    '金额合计',
    '应付金额',
    '總計',
    '合計',
    '金額合計',
    '應付金額',
    '总价',
    '總價',
  ],
  qty_shipped: [
    'total qty',
    'total quantity',
    'qty shipped',
    'quantity shipped',
    'total q',
    // Chinese labels
    '总数量',
    '總數量',
    '发货数量',
    '發貨數量',
  ],
  mpo_number: [
    'mpo',
    'mpo no',
    'master po',
  ],
  po_number: [
    'po',
    'po no',
    'purchase order',
    'customer po',
    // Chinese labels
    '采购订单',
    '採購訂單',
    '客户订单',
    '客戶訂單',
  ]
};

export interface VendorRule {
  invoiceNumberPatterns: RegExp[];
  datePatterns: RegExp[];
  amountPatterns: RegExp[];
  mpoPatterns: RegExp[];
  paymentTermPatterns: RegExp[];
}

export const VendorRules: Record<string, VendorRule> = {
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
  },
  CHARMING: {
    invoiceNumberPatterns: [
      /INVOICE\s*NO[:\s]+([A-Z0-9-]+)/i,
      /I\/V\s*NO[:\s]+([A-Z0-9-]+)/i,
      /发票号码[:\s]*([A-Z0-9-]+)/i,
      /发票编号[:\s]*([A-Z0-9-]+)/i,
    ],
    datePatterns: [
      /INVOICE\s*DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /发票日期[:\s]*([A-Za-z0-9\s\/\-]+)/i,
      /开票日期[:\s]*([A-Za-z0-9\s\/\-]+)/i,
    ],
    amountPatterns: [
      /TOTAL\s*\(USD\)[:\s]*([\d,]+\.?\d*)/i,
      /TOTAL\s*USD[:\s]*([\d,]+\.?\d*)/i,
      /GRAND\s*TOTAL[:\s]*([\d,]+\.?\d*)/i,
      /总计[:\s]*USD[:\s]*([\d,]+\.?\d*)/i,
      /合计[:\s]*USD[:\s]*([\d,]+\.?\d*)/i,
      /金额合计[:\s]*([\d,]+\.?\d*)/i,
    ],
    mpoPatterns: [
      /MPO[\s_-]*(\d+)/i,
      /MPO_?(\d+)/i,
    ],
    paymentTermPatterns: [
      /CREDIT\s*TERM[:\s]+([A-Za-z0-9\s]+)/i,
      /TERMS[:\s]+([A-Za-z0-9\s]+)/i,
      /付款条件[:\s]*([A-Za-z0-9\s]+)/i,
    ]
  },
  BOHING: {
    invoiceNumberPatterns: [
      /INVOICE\s*NO[:\s]+([A-Z0-9-]+)/i,
      /I\/V\s*NO[:\s]+([A-Z0-9-]+)/i,
      /发票号[:\s]*([A-Z0-9-]+)/i,
      /票據號碼[:\s]*([A-Z0-9-]+)/i,
    ],
    datePatterns: [
      /INVOICE\s*DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /DATE[:\s]+([A-Za-z0-9\s\/\-]+)/i,
      /发票日期[:\s]*([A-Za-z0-9\s\/\-]+)/i,
      /開票日期[:\s]*([A-Za-z0-9\s\/\-]+)/i,
    ],
    amountPatterns: [
      /TOTAL\s*\(USD\)[:\s]*([\d,]+\.?\d*)/i,
      /TOTAL\s*USD[:\s]*([\d,]+\.?\d*)/i,
      /GRAND\s*TOTAL[:\s]*([\d,]+\.?\d*)/i,
      /总计[:\s]*([\d,]+\.?\d*)/i,
      /合計[:\s]*([\d,]+\.?\d*)/i,
      /總計[:\s]*([\d,]+\.?\d*)/i,
    ],
    mpoPatterns: [
      /MPO[\s_-]*(\d+)/i,
      /MPO_?(\d+)/i,
    ],
    paymentTermPatterns: [
      /CREDIT\s*TERM[:\s]+([A-Za-z0-9\s]+)/i,
      /TERMS[:\s]+([A-Za-z0-9\s]+)/i,
      /付款方式[:\s]*([A-Za-z0-9\s]+)/i,
    ]
  }
};

/**
 * Detect if text contains CJK (Chinese/Japanese/Korean) characters.
 * Returns true if any CJK Unicode ranges are found.
 */
export function containsCJK(text: string): boolean {
  // CJK Unified Ideographs: U+4E00–U+9FFF
  // CJK Unified Ideographs Extension A: U+3400–U+4DBF
  // CJK Compatibility Ideographs: U+F900–U+FAFF
  // CJK Unified Ideographs Extension B-F: U+20000–U+2FA1F
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text);
}

/**
 * Detect the dominant script of the text.
 * Returns 'zh', 'ja', 'ko', 'en', or 'mixed'.
 */
export function detectScript(text: string): 'zh' | 'ja' | 'ko' | 'en' | 'mixed' {
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text);
  const hasHiragana = /[\u3040-\u309f]/.test(text);
  const hasKatakana = /[\u30a0-\u30ff]/.test(text);
  const hasHangul = /[\uac00-\ud7af\u1100-\u11ff]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);

  if (hasHiragana || hasKatakana) return 'ja';
  if (hasHangul) return 'ko';
  if (hasCJK && hasLatin) return 'mixed';
  if (hasCJK) return 'zh';
  if (hasLatin) return 'en';
  return 'en';
}

export const BRAND_CODE_MAP: Record<string, string> = {
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

export const FULL_BRAND_NAMES: Record<string, string> = {};
Object.entries(BRAND_CODE_MAP).forEach(([code, name]) => {
  FULL_BRAND_NAMES[name.toUpperCase()] = code;
  FULL_BRAND_NAMES[name.toLowerCase()] = code;
});

export const GENERIC_LABEL_DENYLIST = [
  'TOTAL', 'AMOUNT', 'DATE', 'INVOICE', 'NO', 'NUMBER', 'TERMS', 'PAGE',
  'TO', 'FROM', 'SUBJECT', 'REF', 'REFERENCE', 'DESCRIPTION', 'ITEM',
  'QUANTITY', 'UNIT', 'PRICE', 'RATE', 'BALANCE', 'DUE', 'PAID',
  'SHIP', 'SHIPMENT', 'ORDER', 'PO', 'MPO', 'BATCH', 'LOT'
];
