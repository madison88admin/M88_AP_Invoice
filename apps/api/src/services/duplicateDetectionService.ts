import prisma from '../config/database';
import crypto from 'crypto';

export interface DuplicateDetectionResult {
  is_duplicate: boolean;
  hash: string;
  existing_invoice_id?: string;
  existing_invoice_number?: string;
  duplicate_type?: 'EXACT' | 'FUZZY' | 'SAME_NUMBER_DIFFERENT_AMOUNT' | 'SAME_NUMBER_DIFFERENT_VENDOR';
  fuzzy_match_details?: {
    existing_invoice_number: string;
    existing_amount: number;
    existing_date: Date;
    match_reason: string;
  };
  risk_level?: 'HIGH' | 'MEDIUM' | 'LOW';
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
  currentInvoiceId?: string,
  context?: { invoice_type?: string; mpo_base_number?: string; mpo_order_sequence?: string; material_code?: string }
): Promise<DuplicateDetectionResult> {
  const hash = generateInvoiceHash(invoiceNumber, vendorId, amount, invoiceDate);

  // 1. Check for exact duplicate: same invoice number + same vendor
  const existingInvoice = await prisma.invoice.findFirst({
    where: {
      invoice_number: invoiceNumber,
      vendor_id: vendorId,
      ...(context?.invoice_type ? { invoice_type: context.invoice_type as any } : {}),
      ...(context?.mpo_base_number ? { mpo_base_number: context.mpo_base_number } : {}),
      ...(context?.mpo_order_sequence ? { mpo_order_sequence: context.mpo_order_sequence } : {}),
      ...(context?.material_code ? { material_code: context.material_code } : {}),
      ...(currentInvoiceId && { id: { not: currentInvoiceId } }),
    },
    select: {
      id: true,
      invoice_number: true,
      total_amount: true,
    },
  });

  if (existingInvoice) {
    const existingAmount = Number(existingInvoice.total_amount);
    const amountDiff = Math.abs(existingAmount - amount);
    const amountMismatchRate = existingAmount > 0 ? amountDiff / existingAmount : 0;

    if (amountMismatchRate > 0.01) {
      return {
        is_duplicate: true,
        hash,
        existing_invoice_id: existingInvoice.id,
        existing_invoice_number: existingInvoice.invoice_number,
        duplicate_type: 'SAME_NUMBER_DIFFERENT_AMOUNT',
        fuzzy_match_details: {
          existing_invoice_number: existingInvoice.invoice_number,
          existing_amount: existingAmount,
          existing_date: invoiceDate,
          match_reason: `Same invoice number and vendor but different amount (existing: $${existingAmount.toFixed(2)}, new: $${amount.toFixed(2)}, diff: ${(amountMismatchRate * 100).toFixed(1)}%)`,
        },
        risk_level: 'HIGH',
      };
    }

    return {
      is_duplicate: true,
      hash,
      existing_invoice_id: existingInvoice.id,
      existing_invoice_number: existingInvoice.invoice_number,
      duplicate_type: 'EXACT',
      risk_level: 'HIGH',
    };
  }

  // 2. Check for same invoice number but different vendor (possible fraud)
  const sameNumberDiffVendor = await prisma.invoice.findFirst({
    where: {
      invoice_number: invoiceNumber,
      vendor_id: { not: vendorId },
      ...(currentInvoiceId && { id: { not: currentInvoiceId } }),
    },
    select: {
      id: true,
      invoice_number: true,
      vendor_id: true,
      total_amount: true,
    },
  });

  if (sameNumberDiffVendor) {
    return {
      is_duplicate: true,
      hash,
      existing_invoice_id: sameNumberDiffVendor.id,
      existing_invoice_number: sameNumberDiffVendor.invoice_number,
      duplicate_type: 'SAME_NUMBER_DIFFERENT_VENDOR',
      fuzzy_match_details: {
        existing_invoice_number: sameNumberDiffVendor.invoice_number,
        existing_amount: Number(sameNumberDiffVendor.total_amount),
        existing_date: invoiceDate,
        match_reason: `Invoice number ${invoiceNumber} exists under a different vendor (vendor_id: ${sameNumberDiffVendor.vendor_id})`,
      },
      risk_level: 'HIGH',
    };
  }

  // 3. Fuzzy matching: same vendor + same amount + invoice_date within ±3 days
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
      risk_level: 'MEDIUM',
    };
  }

  // 4. Near-miss fuzzy: same vendor + similar amount (within 5%) + same date
  const nearMissMatch = await checkNearMissDuplicate(vendorId, amount, invoiceDate, currentInvoiceId, invoiceNumber);
  if (nearMissMatch) {
    return {
      is_duplicate: true,
      hash,
      existing_invoice_id: nearMissMatch.id,
      existing_invoice_number: nearMissMatch.invoice_number,
      duplicate_type: 'FUZZY',
      fuzzy_match_details: {
        existing_invoice_number: nearMissMatch.invoice_number,
        existing_amount: Number(nearMissMatch.total_amount),
        existing_date: nearMissMatch.invoice_date || new Date(),
        match_reason: nearMissMatch.match_reason,
      },
      risk_level: 'LOW',
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
 * Near-miss duplicate detection: same vendor + amount within 5% + same invoice date
 * Catches minor amount discrepancies (e.g., rounding, partial payments)
 */
async function checkNearMissDuplicate(
  vendorId: string,
  amount: number,
  invoiceDate: Date,
  currentInvoiceId?: string,
  invoiceNumber?: string
): Promise<{ id: string; invoice_number: string; total_amount: any; invoice_date: Date | null; match_reason: string } | null> {
  const tolerance = amount * 0.05;
  const minAmount = amount - tolerance;
  const maxAmount = amount + tolerance;

  const dateDayStart = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth(), invoiceDate.getDate());
  const dateDayEnd = new Date(dateDayStart.getTime() + 24 * 60 * 60 * 1000);

  const nearMissMatches = await prisma.invoice.findMany({
    where: {
      vendor_id: vendorId,
      total_amount: { gte: minAmount, lte: maxAmount },
      invoice_date: { gte: dateDayStart, lt: dateDayEnd },
      ...(invoiceNumber && { invoice_number: { not: invoiceNumber } }),
      ...(currentInvoiceId && { id: { not: currentInvoiceId } }),
    },
    select: {
      id: true,
      invoice_number: true,
      total_amount: true,
      invoice_date: true,
    },
  });

  if (nearMissMatches.length > 0) {
    const match = nearMissMatches[0];
    const existingAmount = Number(match.total_amount);
    const diff = Math.abs(existingAmount - amount);
    const diffPercent = (diff / amount * 100).toFixed(1);
    return {
      id: match.id,
      invoice_number: match.invoice_number,
      total_amount: match.total_amount,
      invoice_date: match.invoice_date,
      match_reason: `Same vendor, same date, amount within 5% (existing: $${existingAmount.toFixed(2)}, new: $${amount.toFixed(2)}, diff: ${diffPercent}%)`,
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
