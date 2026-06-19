import prisma from '../config/database';
import crypto from 'crypto';

export interface DuplicateDetectionResult {
  is_duplicate: boolean;
  hash: string;
  existing_invoice_id?: string;
  existing_invoice_number?: string;
  duplicate_type?: 'EXACT' | 'FUZZY';
  fuzzy_match_details?: {
    existing_invoice_number: string;
    existing_amount: number;
    existing_date: Date;
    match_reason: string;
  };
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

  // Check for existing invoice with same invoice number and vendor (exact duplicate)
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
      duplicate_type: 'EXACT',
    };
  }

  // Fuzzy matching: same vendor + same amount + invoice_date within ±3 days
  const fuzzyMatch = await checkFuzzyDuplicate(vendorId, amount, invoiceDate, currentInvoiceId);
  if (fuzzyMatch) {
    return {
      is_duplicate: true,
      hash,
      existing_invoice_id: fuzzyMatch.id,
      existing_invoice_number: fuzzyMatch.invoice_number,
      duplicate_type: 'FUZZY',
      fuzzy_match_details: {
        existing_invoice_number: fuzzyMatch.invoice_number,
        existing_amount: Number(fuzzyMatch.total_amount),
        existing_date: fuzzyMatch.invoice_date || new Date(),
        match_reason: fuzzyMatch.match_reason,
      },
    };
  }

  return {
    is_duplicate: false,
    hash,
  };
}

/**
 * Fuzzy duplicate detection: same vendor + same amount + invoice_date within ±3 days
 * Catches vendors resubmitting under a new invoice number
 */
async function checkFuzzyDuplicate(
  vendorId: string,
  amount: number,
  invoiceDate: Date,
  currentInvoiceId?: string
): Promise<{ id: string; invoice_number: string; total_amount: any; invoice_date: Date | null; match_reason: string } | null> {
  // Calculate date range: ±3 days from invoice date
  const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
  const minDate = new Date(invoiceDate.getTime() - threeDaysInMs);
  const maxDate = new Date(invoiceDate.getTime() + threeDaysInMs);

  // Find invoices with same vendor, same amount, and date within ±3 days
  const fuzzyMatches = await prisma.invoice.findMany({
    where: {
      vendor_id: vendorId,
      total_amount: amount,
      invoice_date: {
        gte: minDate,
        lte: maxDate,
      },
      ...(currentInvoiceId && { id: { not: currentInvoiceId } }),
    },
    select: {
      id: true,
      invoice_number: true,
      total_amount: true,
      invoice_date: true,
    },
  });

  if (fuzzyMatches.length > 0) {
    const match = fuzzyMatches[0];
    const daysDiff = Math.abs((match.invoice_date?.getTime() || 0) - invoiceDate.getTime()) / (1000 * 60 * 60 * 24);
    return {
      id: match.id,
      invoice_number: match.invoice_number,
      total_amount: match.total_amount,
      invoice_date: match.invoice_date,
      match_reason: `Same vendor, same amount, invoice date within ${daysDiff.toFixed(1)} days`,
    };
  }

  return null;
}

/**
 * Store invoice hash for future duplicate detection
 * This can be called when creating or updating an invoice
 */
export async function storeInvoiceHash(invoiceId: string, hash: string): Promise<void> {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      invoice_hash: hash,
    },
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
): Promise<Array<{ invoice_number: string; is_duplicate: boolean; hash: string; duplicate_type?: string }>> {
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
        duplicate_type: result.duplicate_type,
      };
    })
  );

  return results;
}
