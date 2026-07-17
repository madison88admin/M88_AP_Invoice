import { InvoiceType, InvoiceCategory } from '@ap-invoice/shared';

const VALID_INVOICE_TYPES = new Set(Object.values(InvoiceType));
const VALID_CATEGORIES = new Set(Object.values(InvoiceCategory));

const INVOICE_TYPE_MAP: Record<string, string> = {
  INVOICE: 'INVOICE',
  COMMERCIAL_INVOICE: 'COMMERCIAL',
  COMMERCIAL: 'COMMERCIAL',
  PROFORMA: 'PROFORMA',
  PRO_FORMA: 'PROFORMA',
  SALES: 'SALES',
  SALES_INVOICE: 'SALES',
  STATEMENT: 'STATEMENT',
  DEBIT_NOTE: 'INVOICE',
  CREDIT_NOTE: 'INVOICE',
  PREPAID: 'PREPAID',
  PROTO_SAMPLE: 'PROTO_SAMPLE',
  PROTO_SAMPLE_INVOICE: 'PROTO_SAMPLE',
};

const CATEGORY_MAP: Record<string, string> = {
  TRIMS: 'TRIMS',
  TRIM: 'TRIMS',
  YARN: 'YARN',
  SAMPLE: 'SAMPLE_CHARGES',
  SAMPLE_CHARGES: 'SAMPLE_CHARGES',
  SAMPLES: 'SAMPLE_CHARGES',
  SHIPPING: 'SHIPPING_FREIGHT',
  SHIPPING_FREIGHT: 'SHIPPING_FREIGHT',
  FREIGHT: 'SHIPPING_FREIGHT',
  LAB: 'LAB_TESTING',
  LAB_TESTING: 'LAB_TESTING',
  TESTING: 'LAB_TESTING',
  FACTORY: 'FACTORY',
  FACTORY_AUDIT: 'FACTORY_AUDIT',
  AUDIT: 'FACTORY_AUDIT',
  PROFESSIONAL_FEE: 'PROFESSIONAL_FEE',
  PROFESSIONAL: 'PROFESSIONAL_FEE',
  SMS: 'SMS',
  CONSULTATION: 'CONSULTATION',
  OTHER: 'OTHER',
};

export function sanitizeInvoiceType(raw: any): InvoiceType {
  if (!raw) return InvoiceType.INVOICE;
  const normalized = String(raw).toUpperCase().trim().replace(/\s+/g, '_');
  const mapped = INVOICE_TYPE_MAP[normalized];
  if (mapped && VALID_INVOICE_TYPES.has(mapped as InvoiceType)) return mapped as InvoiceType;
  if (VALID_INVOICE_TYPES.has(normalized as InvoiceType)) return normalized as InvoiceType;
  return InvoiceType.INVOICE;
}

export function sanitizeCategory(raw: any): InvoiceCategory {
  if (!raw) return InvoiceCategory.TRIMS;
  const normalized = String(raw).toUpperCase().trim().replace(/\s+/g, '_');
  const mapped = CATEGORY_MAP[normalized];
  if (mapped && VALID_CATEGORIES.has(mapped as InvoiceCategory)) return mapped as InvoiceCategory;
  if (VALID_CATEGORIES.has(normalized as InvoiceCategory)) return normalized as InvoiceCategory;
  return InvoiceCategory.TRIMS;
}
