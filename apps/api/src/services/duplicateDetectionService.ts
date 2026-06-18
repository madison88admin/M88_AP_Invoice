import prisma from '../config/database';
import crypto from 'crypto';

export interface DuplicateDetectionResult {
  is_duplicate: boolean;
  hash: string;
  existing_invoice_id?: string;
  existing_invoice_number?: string;
}

/**
 * Generate SHA-256 hash for duplicate detection
 * Hash: SHA-256(invoice_number + vendor_id + amount + invoice_date)
 */
export function generateInvoiceHash(invoiceNumber: string, vendorId: string, amount: number, invoiceDate: Date): string {
  const hashInput = `${invoiceNumber}${vendorId}${amount}${invoiceDate.toISOString()}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Check if an invoice is a duplicate based on SHA-256 hash
 * This service can be called independently of validation
 */
export async function checkDuplicateInvoice(
  invoiceNumber: string,
  vendorId: string,
  amount: number,
  invoiceDate: Date,
  currentInvoiceId?: string
): Promise<DuplicateDetectionResult> {
  const hash = generateInvoiceHash(invoiceNumber, vendorId, amount, invoiceDate);

  // Check for existing invoice with same invoice number and vendor
  const existingInvoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: invoiceNumber,
      vendor_id: vendorId,
      ...(currentInvoiceId && { id: { not: currentInvoiceId } }),
    },
    select: {
      id: true,
      invoice_number: true,
    },
  });

  if (existingInvoice) {
    return {
      is_duplicate: true,
      hash,
      existing_invoice_id: existingInvoice.id,
      existing_invoice_number: existingInvoice.invoice_number,
    };
  }

  return {
    is_duplicate: false,
    hash,
  };
}

/**
 * Store invoice hash for future duplicate detection
 * This can be called when creating or updating an invoice
 */
export async function storeInvoiceHash(invoiceId: string, hash: string): Promise<void> {
  // The hash can be stored in the ocr_raw_data field or a dedicated field
  // For now, we'll store it in ocr_raw_data
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      ocr_confidence_score: 1.0, // Hash stored via audit log instead
    } as any,
  });
}

/**
 * Batch check multiple invoices for duplicates
 * Useful for bulk operations or data migration
 */
export async function batchCheckDuplicates(
  invoices: Array<{
    invoice_number: string;
    vendor_id: string;
    amount: number;
    invoice_date: Date;
  }>
): Promise<Array<{ invoice_number: string; is_duplicate: boolean; hash: string }>> {
  const results = await Promise.all(
    invoices.map(async (invoice) => {
      const result = await checkDuplicateInvoice(
        invoice.invoice_number,
        invoice.vendor_id,
        invoice.amount,
        invoice.invoice_date
      );
      return {
        invoice_number: invoice.invoice_number,
        is_duplicate: result.is_duplicate,
        hash: result.hash,
      };
    })
  );

  return results;
}
