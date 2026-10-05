import prisma from '../config/database';
import { logger } from '../utils/logger';
import { uploadToStorage } from './supabaseStorageService';
import { generateFileHash } from './emailDuplicateService';

export type ExistingInvoiceForPdfReplacement = {
  id: string;
  invoice_number: string;
  revision: number;
  status: string;
  pdf_path: string | null;
  raw_file_url: string | null;
  invoice_hash: string | null;
};

export type PdfReplacementResult =
  | { action: 'NOT_FOUND' }
  | { action: 'NOOP_DUPLICATE'; invoice: ExistingInvoiceForPdfReplacement }
  | { action: 'REPLACED'; invoice: ExistingInvoiceForPdfReplacement; storagePath: string };

/**
 * Return the newest record for an invoice number.  The newest revision is the
 * record whose attachment should be replaced when a corrected PDF arrives.
 */
export async function findLatestInvoiceByNumber(invoiceNumber: string): Promise<ExistingInvoiceForPdfReplacement | null> {
  const normalized = String(invoiceNumber || '').trim();
  if (!normalized) return null;

  return prisma.invoice.findFirst({
    where: { invoice_number: normalized },
    orderBy: [{ revision: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      invoice_number: true,
      revision: true,
      status: true,
      pdf_path: true,
      raw_file_url: true,
      invoice_hash: true,
    },
  });
}

/**
 * Replace only the stored PDF for an existing invoice number.  Invoice fields
 * and workflow status are intentionally left unchanged: this is an attachment
 * correction, not a new invoice or a new approval revision.
 */
export async function replaceInvoicePdfByNumber(options: {
  invoiceNumber: string;
  buffer: Buffer;
  fileName: string;
  contentType?: string;
  source: string;
  uploadedStoragePath?: string;
}): Promise<PdfReplacementResult> {
  const existing = await findLatestInvoiceByNumber(options.invoiceNumber);
  if (!existing) return { action: 'NOT_FOUND' };

  const incomingHash = generateFileHash(options.buffer);
  if (existing.invoice_hash && existing.invoice_hash === incomingHash) {
    return { action: 'NOOP_DUPLICATE', invoice: existing };
  }

  const storagePath = options.uploadedStoragePath || await uploadToStorage(
    options.buffer,
    options.fileName,
    options.contentType || 'application/pdf',
  );
  if (!storagePath) {
    throw new Error(`Unable to store replacement PDF for invoice ${existing.invoice_number}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: existing.id },
      data: {
        pdf_path: storagePath,
        raw_file_url: storagePath,
        invoice_hash: incomingHash,
      },
    });
    await tx.auditLog.create({
      data: {
        invoice_id: existing.id,
        action: 'PDF_ATTACHMENT_REPLACED',
        performed_by: options.source,
        note: `Replaced PDF for invoice ${existing.invoice_number} with ${options.fileName}`,
        metadata: {
          source: options.source,
          file_name: options.fileName,
          previous_pdf_path: existing.pdf_path,
          previous_raw_file_url: existing.raw_file_url,
          storage_path: storagePath,
          previous_invoice_hash: existing.invoice_hash,
          invoice_hash: incomingHash,
        },
      },
    });
  });

  logger.info(`[PDF Replacement] ${existing.invoice_number} attachment replaced from ${options.source}: ${storagePath}`);
  return { action: 'REPLACED', invoice: existing, storagePath };
}
