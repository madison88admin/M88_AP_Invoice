import { InvoiceType, InvoiceCategory, InvoiceStatus, SignatureRole, ExceptionReason, UserRole } from './types';

export const VALID_BILL_TO_NAMES = [
  'MADISON 88 LTD',
  'MADISON 88 LIMITED',
  'MADISON 88, LTD.',
  'MADISON LIMITED',
  'MADISON 88',
];

export const VALID_BILL_TO_ADDRESSES = [
  '2433 Curtis Street, 2nd Floor, Denver, CO 80205',
  '15 West 36th Street, 14th Floor, New York, NY 10018',
];

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
};

export const URGENT_KEYWORDS = ['URGENT', 'PLEASE PAY ON', 'PLEASE SETTLE', 'PAYMENT IN ADVANCE'];

export const INVOICE_TYPE_KEYWORDS: Record<string, InvoiceType> = {
  'PROFORMA INVOICE': InvoiceType.PI,
  'PRO-FORMA': InvoiceType.PI,
  'COMMERCIAL INVOICE': InvoiceType.CI,
  'SALES INVOICE': InvoiceType.SI,
  'INVOICE': InvoiceType.INV,
  'PREPAID': InvoiceType.PREPAID,
};

export const SIGNATURE_REQUIREMENTS = {
  BELOW_5000: [SignatureRole.COORDINATOR, SignatureRole.MANAGER],
  ABOVE_5000: [
    SignatureRole.COORDINATOR,
    SignatureRole.MANAGER,
    SignatureRole.PLANNING_MANAGER,
    SignatureRole.LINDSEY,
  ],
};

export const APPROVAL_ROUTING = {
  BELOW_5000: UserRole.PURCHASING_MANAGER,
  BETWEEN_5000_500000: UserRole.PRESIDENT,
  ABOVE_500000: UserRole.CFO,
};

export const SLA_LIMITS = {
  PAYMENT_DAYS: 5,
  APPROVAL_HOURS: 48,
  LATE_SUBMISSION_DAYS: 7,
  CRITICAL_LATE_DAYS: 14,
};

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
  return InvoiceType.INV;
}

export function detectCategory(lineItemDescription: string): InvoiceCategory {
  const lowerDesc = lineItemDescription.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lowerDesc.includes(keyword)) {
      return category;
    }
  }
  return InvoiceCategory.OTHER;
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
