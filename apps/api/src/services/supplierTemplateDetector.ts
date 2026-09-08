/** Supplier template hints derived from the approved supplier template workbook.
 * These are conservative hints: explicit labels in the document always win.
 */
const PROFORMA = ['TRIMCO GROUP', 'TRIMCO GROUP TRADING', 'PT NEXGEN PACKAGING', 'CADICA', 'J-LONG', 'SEAMAN PAPER', 'PUNARBHAVAA', 'NEXGEN PACKAGING'];
const COMMERCIAL = ['PT BSN TECHNOLOGIES', 'DONGGUAN GUO XIANG', 'COLUMBIA SPORTSWEAR COMPANY VENDOR', 'EXPEDITORS', 'ISA INDUSTRIAL', 'KOMAX HK', 'UNIVERSAL STAR', 'UTS UNIVERSAL'];
const SALES = ['CHECKPOINT APPAREL LABELLING', 'KABUHAYAN NAMIN'];
const SERVICE = ['EXPEDITORS PHILIPPINES'];
const PREPAID = ['GLOBAL TRIM SALES'];
const PROTO = ['TIEN-HU TRADING'];

export type SupplierDocumentType = 'INV' | 'PI' | 'CI' | 'SI' | 'STATEMENT';
export function templateInvoiceType(vendor: unknown): SupplierDocumentType | null {
  const value = String(vendor || '').trim().toUpperCase();
  if (!value) return null;
  if (SERVICE.some(p => value.includes(p))) return 'SI';
  if (PREPAID.some(p => value.includes(p))) return 'INV';
  if (PROTO.some(p => value.includes(p))) return 'INV';
  if (SALES.some(p => value.includes(p))) return 'SI';
  if (COMMERCIAL.some(p => value.includes(p))) return 'CI';
  if (PROFORMA.some(p => value.includes(p))) return 'PI';
  return null;
}

/** Prefer an explicit OCR label; apply workbook template only to generic Invoice. */
export function detectSupplierInvoiceType(vendor: unknown, extracted: unknown): SupplierDocumentType {
  const explicit = String(extracted || '').toUpperCase();
  if (explicit === 'STATEMENT') return 'STATEMENT';
  if (explicit === 'PI' || explicit === 'CI' || explicit === 'SI') return explicit;
  return templateInvoiceType(vendor) || 'INV';
}
