import { InvoiceType, InvoiceCategory, SignatoryRole, UserRole, BillToEntity, OrderType } from './types';

// ─── TOP 10 BRANDS (seed — confirm full list with Purchasing) ───
export const TOP_10_BRANDS: Record<string, string> = {
  CSC: 'Columbia Sportswear',
  TNF: 'The North Face',
  VNS: 'Vans',
  ARC: "Arc'teryx",
  UA: 'Under Armour',
  HH: 'Helly Hansen',
  BUR: 'Burton',
  TM: 'Travis Mathew',
  FR: 'Fjallraven',
  ON: 'On Running',
};

// Reverse map: brand name (lowercase) → code
export const BRAND_NAME_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(TOP_10_BRANDS)) {
  BRAND_NAME_TO_CODE[name.toLowerCase()] = code;
}

// ─── SIGNER NAME LISTS (configurable, IT-controlled) ───
export const COORDINATOR_NAMES = [
  'Sarah Jane Cariquitan',
  'MJ Santiago',
  'Maricon Alvarez',
  'April Joy Diasanta',
  'Pamela Amor Caoili',
  'Mariane Eusebio',
  'Mary Joy Yco',
];

export const PURCHASING_MANAGER_NAMES = [
  'Maricar Tanaleon',
  'Mary Ann Del Monte',
];

// MLO Account Holder — brand-dependent routing (TODO-2: confirm with Purchasing)
export const MLO_ACCOUNT_HOLDER_EDWIN = 'Edwin Garcia';   // TOP_10 brands
export const MLO_ACCOUNT_HOLDER_GLECIE = 'Glecie Yumena'; // OTHER brands

export const SR_MANAGER_NAME = 'Lindsey Schindler'; // Sr. Manager of Global Production Operations
export const MS_POLLY_NAME = 'Polly'; // surname TBD

// ─── BILL-TO VALIDATION (BRD v5.0 — Denver primary address) ───
export const VALID_BILL_TO_NAMES = [
  'MADISON 88 LTD',
  'MADISON 88 LIMITED',
  'MADISON 88, LTD.',
  'MADISON LIMITED',
  'MADISON 88',
  'MADISON88, LTD',
  'MADISON88',
  'MADISON 88 HONG KONG LIMITED',
  'APH1009 MADISON',
];

export const VALID_BILL_TO_ADDRESSES = [
  '2433 Curtis Street, 2nd Floor, Denver, CO 80205',  // primary
  '2423 Curtis Street, Denver, CO 80205',             // variant — normalize to 2433
];

// ─── PAYMENT / INCOTERM / CATEGORY ───
export const PAYMENT_TERMS_PATTERNS = [
  'Net 30',
  'Net 90',
  'Payment in Advance',
  'T/T 100%',
  'PBS',
  'PAYMENT BEFORE SHIPMENT',
];

export const INCOTERMS = ['EXW', 'DAP', 'FOB', 'CIF', 'DDP'];

export const CATEGORY_KEYWORDS: Record<string, InvoiceCategory> = {
  yarn: InvoiceCategory.YARN,
  bag: InvoiceCategory.TRIMS,
  label: InvoiceCategory.TRIMS,
  trim: InvoiceCategory.TRIMS,
  tag: InvoiceCategory.TRIMS,
  hangtag: InvoiceCategory.TRIMS,
  zipper: InvoiceCategory.TRIMS,
  sample: InvoiceCategory.SAMPLE_CHARGES,
  freight: InvoiceCategory.SHIPPING_FREIGHT,
  shipping: InvoiceCategory.SHIPPING_FREIGHT,
  lab: InvoiceCategory.LAB_TESTING,
  testing: InvoiceCategory.LAB_TESTING,
  professional: InvoiceCategory.PROFESSIONAL_FEE,
  fee: InvoiceCategory.PROFESSIONAL_FEE,
  factory: InvoiceCategory.FACTORY,
  audit: InvoiceCategory.FACTORY_AUDIT,
  sms: InvoiceCategory.SMS,
  consultation: InvoiceCategory.CONSULTATION,
};

export const URGENT_KEYWORDS = ['URGENT', 'PLEASE PAY ON', 'PLEASE SETTLE', 'PAYMENT IN ADVANCE'];

export const INVOICE_TYPE_KEYWORDS: Record<string, InvoiceType> = {
  'PROFORMA INVOICE': InvoiceType.PROFORMA,
  'PRO-FORMA': InvoiceType.PROFORMA,
  'COMMERCIAL INVOICE': InvoiceType.COMMERCIAL,
  'SALES INVOICE': InvoiceType.SALES,
  'INVOICE': InvoiceType.INVOICE,
  'PREPAID': InvoiceType.PREPAID,
  'PROTO SAMPLE': InvoiceType.PROTO_SAMPLE,
  'STATEMENT': InvoiceType.STATEMENT,
};

// ─── APPROVAL ROUTING (4 tiers per BRD v5.0) ───
export const APPROVAL_THRESHOLDS = {
  TIER_1: 2000,      // USD 2,000 and below
  TIER_2: 5000,      // USD 2,001 to $4,999
  TIER_3: 100000,    // USD 5,000 to $99,999
  // Above TIER_3 = Tier 4 ($100,000+)
};

export const SIGNATURE_REQUIREMENTS = {
  TIER_1: [SignatoryRole.COORDINATOR],
  TIER_2: [
    SignatoryRole.COORDINATOR,
    SignatoryRole.PURCHASING_MANAGER,
    SignatoryRole.MLO_ACCOUNT_HOLDER,
  ],
  TIER_3: [
    SignatoryRole.COORDINATOR,
    SignatoryRole.PURCHASING_MANAGER,
    SignatoryRole.MLO_ACCOUNT_HOLDER,
    SignatoryRole.MLO_PLANNING_MANAGER,
    SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
  ],
  TIER_4: [
    SignatoryRole.COORDINATOR,
    SignatoryRole.PURCHASING_MANAGER,
    SignatoryRole.MLO_ACCOUNT_HOLDER,
    SignatoryRole.MLO_PLANNING_MANAGER,
    SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
    SignatoryRole.MS_POLLY,
  ],
};

export const SLA_LIMITS = {
  COORDINATOR_DAYS: 7,
  PURCHASING_MANAGER_DAYS: 7,
  MLO_ACCOUNT_HOLDER_DAYS: 4,
  MLO_PLANNING_MANAGER_DAYS: 4,
  SR_MANAGER_DAYS: 3,
  MS_POLLY_DAYS: 3,
  ACCOUNTING_DAYS: 7,
  PAYMENT_DAYS: 5,
  APPROVAL_HOURS: 48,
  LATE_SUBMISSION_DAYS: 7,
  CRITICAL_LATE_DAYS: 14,
};

// ─── HELPER FUNCTIONS ───

/**
 * Determine if a brand is in the TOP_10 list
 */
export function isTop10Brand(brandName: string): boolean {
  if (!brandName) return false;
  const lower = brandName.toLowerCase().trim();
  const isTop10 = Object.values(TOP_10_BRANDS).some(
    name => name.toLowerCase() === lower
  );
  const isTop10Code = Object.keys(TOP_10_BRANDS).some(
    code => lower.startsWith(code.toLowerCase())
  );
  return isTop10 || isTop10Code;
}

/**
 * Parse PO reference string into structured fields
 * Example: "CSC_F26_BULK_MPO15335" → { brand_code: "CSC", season: "F26", order_type: "BULK", mpo_number: "MPO15335" }
 */
export function parsePOReference(poRef: string): {
  brand_code?: string;
  season?: string;
  order_type?: string;
  po_number?: string;
  mpo_number?: string;
  factory_location?: string;
} {
  if (!poRef) return {};

  const tokens = poRef.split('_').filter(t => t.length > 0);
  const result: {
    brand_code?: string;
    season?: string;
    order_type?: string;
    po_number?: string;
    mpo_number?: string;
    factory_location?: string;
  } = {};

  // Token[0] → brand code (e.g., CSC, TNF, VNS)
  if (tokens.length > 0) {
    result.brand_code = tokens[0].toUpperCase();
  }

  // Token[1] → season (e.g., F26, FH26, F26_JAN)
  if (tokens.length > 1) {
    result.season = tokens[1];
    // Handle season + sub-season (e.g., F26_JAN)
    if (tokens.length > 2 && /^[A-Z]{3}$/i.test(tokens[2])) {
      result.season = `${tokens[1]}_${tokens[2]}`;
    }
  }

  // Find MPO number (starts with MPO)
  const mpoIdx = tokens.findIndex(t => /^MPO/i.test(t));
  if (mpoIdx >= 0) {
    result.mpo_number = tokens[mpoIdx];
  }

  // Find PO number (starts with PO)
  const poIdx = tokens.findIndex(t => /^PO/i.test(t) && !/^MPO/i.test(t));
  if (poIdx >= 0) {
    result.po_number = tokens[poIdx];
  }

  // Detect order type
  const upperTokens = tokens.map(t => t.toUpperCase());
  if (upperTokens.includes('BULK')) {
    result.order_type = 'BULK';
  } else if (upperTokens.includes('SMS') || upperTokens.includes('STOCK MAKE SPECIAL')) {
    result.order_type = 'SMS';
  } else if (upperTokens.includes('SAMPLE')) {
    result.order_type = 'SAMPLE';
  } else if (upperTokens.includes('JAN') || upperTokens.includes('BUY')) {
    result.order_type = 'BULK';
  }

  // Factory / Location — typically the last token(s) after MPO
  if (mpoIdx >= 0 && mpoIdx + 1 < tokens.length) {
    const remaining = tokens.slice(mpoIdx + 1);
    const factoryTokens = remaining.filter(
      t => !['BULK', 'SMS', 'SAMPLE', 'JAN', 'BUY'].includes(t.toUpperCase())
    );
    if (factoryTokens.length > 0) {
      result.factory_location = factoryTokens.join('_');
    }
  }

  return result;
}

export function normalizeBillToName(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '')
    .replace(/\./g, '');
}

export function normalizeBillToAddress(address: string): string {
  return address
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '');
}

export function isValidBillToName(name: string): boolean {
  const normalized = normalizeBillToName(name);
  return VALID_BILL_TO_NAMES.some(valid => normalizeBillToName(valid) === normalized);
}

export function isValidBillToAddress(address: string): boolean {
  const normalized = normalizeBillToAddress(address);
  return VALID_BILL_TO_ADDRESSES.some(valid => normalizeBillToAddress(valid) === normalized);
}

export function detectInvoiceType(headerText: string): InvoiceType {
  const upperText = headerText.toUpperCase();
  for (const [keyword, type] of Object.entries(INVOICE_TYPE_KEYWORDS)) {
    if (upperText.includes(keyword)) {
      return type;
    }
  }
  return InvoiceType.INVOICE;
}

export function detectCategory(lineItemDescription: string): InvoiceCategory {
  const lowerDesc = lineItemDescription.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lowerDesc.includes(keyword)) {
      return category;
    }
  }
  return InvoiceCategory.TRIMS; // safe default
}

export function detectPaymentTerms(text: string): string {
  const upperText = text.toUpperCase();
  for (const pattern of PAYMENT_TERMS_PATTERNS) {
    if (upperText.includes(pattern.toUpperCase())) {
      return pattern;
    }
  }
  return 'Net 30';
}

export function detectIncoterm(text: string): string | undefined {
  const upperText = text.toUpperCase();
  for (const incoterm of INCOTERMS) {
    if (upperText.includes(incoterm)) {
      return incoterm;
    }
  }
  return undefined;
}

export function isUrgent(text: string): boolean {
  const upperText = text.toUpperCase();
  return URGENT_KEYWORDS.some(keyword => upperText.includes(keyword));
}

/**
 * Match a signer's name to their SignatoryRole
 */
export function matchSignerToRole(signerName: string): SignatoryRole | null {
  const lower = signerName.toLowerCase().trim();

  // Check coordinator names
  if (COORDINATOR_NAMES.some(n => n.toLowerCase() === lower || lower.includes(n.toLowerCase()))) {
    return SignatoryRole.COORDINATOR;
  }

  // Check purchasing manager names
  if (PURCHASING_MANAGER_NAMES.some(n => n.toLowerCase() === lower || lower.includes(n.toLowerCase()))) {
    return SignatoryRole.PURCHASING_MANAGER;
  }

  // MLO Account Holder — Edwin Garcia (TOP_10 brands)
  if (lower.includes(MLO_ACCOUNT_HOLDER_EDWIN.toLowerCase())) {
    return SignatoryRole.MLO_ACCOUNT_HOLDER;
  }

  // MLO Account Holder — Glecie Yumena (OTHER brands)
  if (lower.includes(MLO_ACCOUNT_HOLDER_GLECIE.toLowerCase())) {
    return SignatoryRole.MLO_ACCOUNT_HOLDER;
  }

  // Sr. Manager of Global Production Operations — Lindsey
  if (lower.includes('lindsey') || lower.includes('schindler')) {
    return SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION;
  }

  // Ms. Polly
  if (lower.includes('polly')) {
    return SignatoryRole.MS_POLLY;
  }

  return null;
}

/**
 * Determine the approval tier for a given invoice amount
 */
export function determineApprovalTier(amount: number): number {
  if (amount <= APPROVAL_THRESHOLDS.TIER_1) return 1;
  if (amount <= APPROVAL_THRESHOLDS.TIER_2) return 2;
  if (amount <= APPROVAL_THRESHOLDS.TIER_3) return 3;
  return 4;
}

/**
 * Map a SignatoryRole to the InvoiceStatus it transitions the invoice to
 */
export function mapSignatoryRoleToPendingStatus(role: SignatoryRole): string {
  const mapping: Record<string, string> = {
    [SignatoryRole.COORDINATOR]: 'PENDING_COORDINATOR',
    [SignatoryRole.PURCHASING_MANAGER]: 'PENDING_MANAGER',
    [SignatoryRole.MLO_ACCOUNT_HOLDER]: 'PENDING_MLO_ACCOUNT_HOLDER',
    [SignatoryRole.MLO_PLANNING_MANAGER]: 'PENDING_MLO_PLANNING_MANAGER',
    [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION]: 'PENDING_SR_MANAGER',
    [SignatoryRole.MS_POLLY]: 'PENDING_POLLY',
    [SignatoryRole.ACCOUNTING_REVIEWER]: 'PENDING_ACCOUNTING',
  };
  return mapping[role] || 'PENDING_ACCOUNTING';
}
