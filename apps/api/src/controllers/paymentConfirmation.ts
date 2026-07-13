import { Request, Response, NextFunction } from 'express';
import { createJob, completeJob, failJob, cleanupOldJobs } from '../services/jobStore';
import { analyzeInvoice } from '../services/ocrService';
import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Confidence-based payment matching
 * - 95%+ : Auto-match, mark PAID
 * - 75-94%: Needs review
 * - <75%: No match
 */
interface MatchResult {
  matched: boolean;
  requiresReview: boolean;
  confidence: number;
  invoiceId?: string;
  invoiceNumber?: string;
  paymentId?: string;
  paymentReference?: string;
  matchReason: string;
}

/**
 * Match Citibank confirmation data against existing payment records
 */
async function matchPaymentConfirmation(
  extractedData: {
    paymentReference?: string;
    amount?: number;
    vendorName?: string;
    paymentDate?: string;
  }
): Promise<MatchResult> {
  const { paymentReference, amount, vendorName } = extractedData;

  // Strategy 1: Match by payment reference (highest confidence)
  if (paymentReference) {
    try {
      const refMatch = await prisma.$queryRaw`
        SELECT p.id as payment_id, p.invoice_id, p.reference, p.amount, p.status,
               i.invoice_number, i.vendor_name_raw, v.name as vendor_name
        FROM "AP_Invoice"."APInvoice_Payment" p
        JOIN "AP_Invoice"."APInvoice_Invoice" i ON p.invoice_id = i.id
        LEFT JOIN "AP_Invoice"."APInvoice_Vendor" v ON i.vendor_id = v.id
        WHERE p.reference = ${paymentReference}
        LIMIT 1
      ` as any[];

      if (refMatch && refMatch.length > 0) {
        const row = refMatch[0];
        return {
          matched: true,
          requiresReview: false,
          confidence: 0.98,
          invoiceId: row.invoice_id,
          invoiceNumber: row.invoice_number,
          paymentId: row.payment_id,
          paymentReference: row.reference,
          matchReason: 'Payment reference exact match',
        };
      }
    } catch (err) {
      logger.warn('Payment reference match failed:', err);
    }
  }

  // Strategy 2: Match by amount + vendor name (medium confidence)
  if (amount && vendorName) {
    try {
      const amountMatch = await prisma.$queryRaw`
        SELECT p.id as payment_id, p.invoice_id, p.reference, p.amount, p.status,
               i.invoice_number, i.vendor_name_raw, v.name as vendor_name
        FROM "AP_Invoice"."APInvoice_Payment" p
        JOIN "AP_Invoice"."APInvoice_Invoice" i ON p.invoice_id = i.id
        LEFT JOIN "AP_Invoice"."APInvoice_Vendor" v ON i.vendor_id = v.id
        WHERE p.amount = ${amount}::numeric
          AND p.status = 'SCHEDULED'
          AND (v.name ILIKE ${'%' + vendorName + '%'} OR i.vendor_name_raw ILIKE ${'%' + vendorName + '%'})
        LIMIT 1
      ` as any[];

      if (amountMatch && amountMatch.length > 0) {
        const row = amountMatch[0];
        return {
          matched: true,
          requiresReview: true,
          confidence: 0.78,
          invoiceId: row.invoice_id,
          invoiceNumber: row.invoice_number,
          paymentId: row.payment_id,
          paymentReference: row.reference,
          matchReason: 'Amount + vendor name match (requires review)',
        };
      }
    } catch (err) {
      logger.warn('Amount + vendor match failed:', err);
    }
  }

  // Strategy 3: Match by amount only (low confidence - needs review)
  if (amount) {
    try {
      const amountOnlyMatch = await prisma.$queryRaw`
        SELECT p.id as payment_id, p.invoice_id, p.reference, p.amount, p.status,
               i.invoice_number, i.vendor_name_raw, v.name as vendor_name
        FROM "AP_Invoice"."APInvoice_Payment" p
        JOIN "AP_Invoice"."APInvoice_Invoice" i ON p.invoice_id = i.id
        LEFT JOIN "AP_Invoice"."APInvoice_Vendor" v ON i.vendor_id = v.id
        WHERE p.amount = ${amount}::numeric
          AND p.status = 'SCHEDULED'
        LIMIT 1
      ` as any[];

      if (amountOnlyMatch && amountOnlyMatch.length > 0) {
        const row = amountOnlyMatch[0];
        return {
          matched: false,
          requiresReview: true,
          confidence: 0.55,
          invoiceId: row.invoice_id,
          invoiceNumber: row.invoice_number,
          paymentId: row.payment_id,
          paymentReference: row.reference,
          matchReason: 'Amount-only match (low confidence - manual review required)',
        };
      }
    } catch (err) {
      logger.warn('Amount-only match failed:', err);
    }
  }

  return {
    matched: false,
    requiresReview: false,
    confidence: 0,
    matchReason: 'No match found',
  };
}

/**
 * POST /api/payment-confirmations/upload
 * Power Automate Flow 2: Citibank Payment Confirmation
 * Accepts multipart form data with Citibank PDF + email metadata
 * Returns 202 Accepted with jobId (async processing)
 */
export const uploadPaymentConfirmation = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = crypto.randomUUID();
  logger.info(`[${requestId}] POST /api/payment-confirmations/upload - started`);

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const fileBuffer = req.file.buffer;
    const fileSize = req.file.size;

    if (fileSize > MAX_FILE_SIZE) {
      return res.status(413).json({
        success: false,
        status: 'MANUAL_REVIEW',
        reason: 'FILE_TOO_LARGE',
        detail: `File size ${fileSize} bytes exceeds 25MB limit`,
      });
    }

    const emailMetadata = {
      senderEmail: req.body.senderEmail || req.body.fromAddress || '',
      subject: req.body.subject || req.body.emailSubject || '',
      receivedDate: req.body.receivedDate || req.body.receivedDateTime || new Date().toISOString(),
      internetMessageId: req.body.internetMessageId || '',
      conversationId: req.body.conversationId || '',
    };

    const jobId = createJob('citibank-confirmation');

    // Process asynchronously
    setImmediate(async () => {
      try {
        // Step 1: Extract text from Citibank PDF using OCR
        const ocrResult = await analyzeInvoice(fileBuffer, req.file!.mimetype);
        logger.info(`[${requestId}] Citibank OCR completed`);

        // Step 2: Parse payment data from OCR result
        // Citibank confirmations typically contain: payment reference, amount, vendor, date
        const extractedData = {
          paymentReference: ocrResult.invoice_number || ocrResult.customer_po_number || undefined,
          amount: ocrResult.total_amount || undefined,
          vendorName: ocrResult.vendor_name || undefined,
          paymentDate: ocrResult.invoice_date ? new Date(ocrResult.invoice_date).toISOString() : undefined,
        };

        logger.info(`[${requestId}] Extracted: ref=${extractedData.paymentReference}, amount=${extractedData.amount}, vendor=${extractedData.vendorName}`);

        // Step 3: Match against payment records
        const matchResult = await matchPaymentConfirmation(extractedData);

        logger.info(`[${requestId}] Match result: confidence=${matchResult.confidence}, matched=${matchResult.matched}, requiresReview=${matchResult.requiresReview}`);

        // Step 4: If matched with high confidence (>=95%), auto-mark as PAID
        if (matchResult.matched && !matchResult.requiresReview && matchResult.invoiceId) {
          // Update payment status
          if (matchResult.paymentId) {
            await prisma.$executeRaw`
              UPDATE "AP_Invoice"."APInvoice_Payment"
              SET status = 'PAID', paid_at = NOW(),
                  reference = COALESCE(reference, ${extractedData.paymentReference || null})
              WHERE id = ${matchResult.paymentId}
            `;
          }

          // Update invoice status to PAID
          await prisma.$executeRaw`
            UPDATE "AP_Invoice"."APInvoice_Invoice"
            SET status = 'PAID'
            WHERE id = ${matchResult.invoiceId}
          `;

          // Create audit log
          await prisma.auditLog.create({
            data: {
              invoice_id: matchResult.invoiceId,
              action: 'CITIBANK_AUTO_PAID',
              performed_by: 'powerautomate',
              note: `Citibank confirmation auto-matched (confidence: ${Math.round(matchResult.confidence * 100)}%). Ref: ${extractedData.paymentReference}. Amount: ${extractedData.amount}. Payment confirmation NOT sent to supplier — manual step required.`,
            },
          });

          logger.info(`[${requestId}] Invoice ${matchResult.invoiceNumber} auto-marked as PAID`);

          completeJob(jobId, {
            matched: true,
            requiresReview: false,
            confidence: Math.round(matchResult.confidence * 100),
            invoiceId: matchResult.invoiceId,
            invoiceNumber: matchResult.invoiceNumber,
            status: 'PAID',
            paymentReference: matchResult.paymentReference,
            message: 'Invoice auto-marked as PAID. Payment confirmation NOT sent to supplier.',
          });
        }
        // Step 5: If needs review, store for manual review
        else if (matchResult.requiresReview && matchResult.invoiceId) {
          // Create exception for manual review
          await prisma.exception.create({
            data: {
              invoice_id: matchResult.invoiceId,
              reason: 'MANUAL_REVIEW_REQUIRED' as any,
              detail: `Citibank payment confirmation requires manual review. Confidence: ${Math.round(matchResult.confidence * 100)}%. Reason: ${matchResult.matchReason}. Ref: ${extractedData.paymentReference}. Amount: ${extractedData.amount}`,
            },
          });

          await prisma.auditLog.create({
            data: {
              invoice_id: matchResult.invoiceId,
              action: 'CITIBANK_REVIEW_REQUIRED',
              performed_by: 'powerautomate',
              note: `Citibank confirmation needs review (confidence: ${Math.round(matchResult.confidence * 100)}%). ${matchResult.matchReason}`,
            },
          });

          completeJob(jobId, {
            matched: true,
            requiresReview: true,
            confidence: Math.round(matchResult.confidence * 100),
            invoiceId: matchResult.invoiceId,
            invoiceNumber: matchResult.invoiceNumber,
            status: 'REQUIRES_REVIEW',
            paymentReference: matchResult.paymentReference,
            message: 'Payment confirmation requires manual review by Accounting Supervisor.',
          });
        }
        // Step 6: No match — store for manual review
        else {
          completeJob(jobId, {
            matched: false,
            requiresReview: false,
            confidence: 0,
            status: 'NO_MATCH',
            extractedData,
            message: 'No matching payment found. Stored for manual review.',
          });
        }
      } catch (error: any) {
        logger.error(`[${requestId}] Citibank processing failed:`, error);
        failJob(jobId, error.message || String(error));
      }
      cleanupOldJobs();
    });

    res.status(202).json({
      success: true,
      jobId,
      status: 'QUEUED',
      message: 'Citibank payment confirmation received, processing started',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/payment-confirmations/jobs/:jobId
 * Check status of async Citibank processing
 */
export const getConfirmationJobStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { jobId } = req.params;
    const { getJob } = await import('../services/jobStore');
    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({
      jobId: job.id,
      type: job.type,
      status: job.status,
      result: job.result,
      error: job.error,
    });
  } catch (error) {
    next(error);
  }
};
