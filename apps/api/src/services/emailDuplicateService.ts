import crypto from 'crypto';
import prisma from '../config/database';
import { logger } from '../utils/logger';

export interface EmailDuplicateResult {
  isDuplicate: boolean;
  level: 'NONE' | 'EMAIL' | 'FILE_HASH' | 'BUSINESS';
  existingInvoiceId?: string;
  existingInvoiceNumber?: string;
  detail: string;
}

/**
 * Level 1: Check by Internet Message ID (same email forwarded/re-sent)
 */
async function checkByEmailMessageId(internetMessageId: string): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  try {
    const result = await prisma.$queryRaw`
      SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
      WHERE ocr_raw_data->>'email_internet_message_id' = ${internetMessageId}
      LIMIT 1
    `;
    const row = Array.isArray(result) ? result[0] : null;
    if (row) return { invoiceId: row.id, invoiceNumber: row.invoice_number };
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Level 2: Check by SHA256 hash of file content (same PDF re-uploaded)
 */
async function checkByFileHash(fileBuffer: Buffer): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  try {
    const result = await prisma.$queryRaw`
      SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
      WHERE invoice_hash = ${fileHash}
      LIMIT 1
    `;
    const row = Array.isArray(result) ? result[0] : null;
    if (row) return { invoiceId: row.id, invoiceNumber: row.invoice_number };
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Level 3: Check by business key (vendor + invoice number + amount)
 */
async function checkByBusinessKey(
  vendorName: string,
  invoiceNumber: string,
  amount: number,
  invoiceDate: Date | string | null
): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  if (!invoiceNumber || !vendorName) return null;
  try {
    const dateStr = invoiceDate
      ? (invoiceDate instanceof Date ? invoiceDate.toISOString().split('T')[0] : new Date(invoiceDate).toISOString().split('T')[0])
      : null;

    let result: any[];
    if (dateStr) {
      result = await prisma.$queryRaw`
        SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
        WHERE invoice_number = ${invoiceNumber}
          AND vendor_name_raw = ${vendorName}
          AND total_amount = ${amount}::numeric
          AND invoice_date::date = ${dateStr}::date
        LIMIT 1
      ` as any[];
    } else {
      result = await prisma.$queryRaw`
        SELECT id, invoice_number FROM "AP_Invoice"."APInvoice_Invoice"
        WHERE invoice_number = ${invoiceNumber}
          AND vendor_name_raw = ${vendorName}
          AND total_amount = ${amount}::numeric
        LIMIT 1
      ` as any[];
    }

    const row = Array.isArray(result) ? result[0] : null;
    if (row) return { invoiceId: row.id, invoiceNumber: row.invoice_number };
  } catch {
    // Non-critical
  }
  return null;
}

/**
 * Run all 3 levels of duplicate detection.
 * Returns the first match found (most specific first).
 */
export async function checkEmailDuplicate(
  fileBuffer: Buffer,
  emailMetadata?: {
    internetMessageId?: string;
    conversationId?: string;
  },
  businessData?: {
    vendorName?: string;
    invoiceNumber?: string;
    amount?: number;
    invoiceDate?: Date | string | null;
  }
): Promise<EmailDuplicateResult> {
  // Level 1: Email Message ID
  if (emailMetadata?.internetMessageId) {
    const emailMatch = await checkByEmailMessageId(emailMetadata.internetMessageId);
    if (emailMatch) {
      logger.info(`Duplicate detected (Level 1 - Email Message ID): ${emailMatch.invoiceNumber}`);
      return {
        isDuplicate: true,
        level: 'EMAIL',
        existingInvoiceId: emailMatch.invoiceId,
        existingInvoiceNumber: emailMatch.invoiceNumber,
        detail: `Duplicate of existing invoice ${emailMatch.invoiceNumber} (same email Message ID)`,
      };
    }
  }

  // Level 2: File Hash
  const hashMatch = await checkByFileHash(fileBuffer);
  if (hashMatch) {
    logger.info(`Duplicate detected (Level 2 - File Hash): ${hashMatch.invoiceNumber}`);
    return {
      isDuplicate: true,
      level: 'FILE_HASH',
      existingInvoiceId: hashMatch.invoiceId,
      existingInvoiceNumber: hashMatch.invoiceNumber,
      detail: `Duplicate of existing invoice ${hashMatch.invoiceNumber} (identical file content)`,
    };
  }

  // Level 3: Business Key
  if (businessData?.vendorName && businessData?.invoiceNumber && businessData?.amount) {
    const businessMatch = await checkByBusinessKey(
      businessData.vendorName,
      businessData.invoiceNumber,
      businessData.amount,
      businessData.invoiceDate || null
    );
    if (businessMatch) {
      logger.info(`Duplicate detected (Level 3 - Business Key): ${businessMatch.invoiceNumber}`);
      return {
        isDuplicate: true,
        level: 'BUSINESS',
        existingInvoiceId: businessMatch.invoiceId,
        existingInvoiceNumber: businessMatch.invoiceNumber,
        detail: `Duplicate of existing invoice ${businessMatch.invoiceNumber} (same vendor + invoice number + amount)`,
      };
    }
  }

  return {
    isDuplicate: false,
    level: 'NONE',
    detail: 'No duplicate found',
  };
}

/**
 * Generate SHA256 hash for a file buffer (for storing as invoice_hash)
 */
export function generateFileHash(fileBuffer: Buffer): string {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}
