import { InvoiceType } from '@ap-invoice/shared';

export interface QBMemoInput {
  brand?: string;
  season?: string;
  mpo_number?: string;
  po_number?: string;
  invoice_type: InvoiceType;
  invoice_number: string;
  vendor_name?: string;
}

/**
 * Auto-generate QB memo from invoice data
 * Format: [Brand] [Season] [MPO/PO] [Invoice Type] - [Invoice Number]
 * Example: "Superdry SS26 MPO12345 PI - INV-001234"
 */
export function generateQBMemo(input: QBMemoInput): string {
  const parts: string[] = [];

  // Add brand if available
  if (input.brand) {
    parts.push(input.brand);
  }

  // Add season if available
  if (input.season) {
    parts.push(input.season);
  }

  // Add MPO or PO number (prefer MPO)
  const orderNumber = input.mpo_number || input.po_number;
  if (orderNumber) {
    parts.push(orderNumber);
  }

  // Add invoice type abbreviation
  const typeAbbreviation = getInvoiceTypeAbbreviation(input.invoice_type);
  parts.push(typeAbbreviation);

  // Add invoice number
  parts.push(`- ${input.invoice_number}`);

  return parts.join(' ');
}

/**
 * Get abbreviation for invoice type
 */
function getInvoiceTypeAbbreviation(invoiceType: InvoiceType): string {
  switch (invoiceType) {
    case InvoiceType.INVOICE:
      return 'INV';
    case InvoiceType.PROFORMA:
      return 'PI';
    case InvoiceType.COMMERCIAL:
      return 'CI';
    case InvoiceType.SALES:
      return 'SI';
    case InvoiceType.STATEMENT:
      return 'STMT';
    case InvoiceType.PREPAID:
      return 'PREPAID';
    default:
      return invoiceType;
  }
}

/**
 * Generate QB memo with fallback for missing data
 * If brand/season/MPO/PO are missing, use vendor name as identifier
 */
export function generateQBMemoWithFallback(input: QBMemoInput): string {
  const hasOrderData = input.brand || input.season || input.mpo_number || input.po_number;
  
  if (hasOrderData) {
    return generateQBMemo(input);
  }

  // Fallback: Use vendor name if available
  const parts: string[] = [];
  
  if (input.vendor_name) {
    parts.push(input.vendor_name);
  }

  const typeAbbreviation = getInvoiceTypeAbbreviation(input.invoice_type);
  parts.push(typeAbbreviation);

  parts.push(`- ${input.invoice_number}`);

  return parts.join(' ');
}
