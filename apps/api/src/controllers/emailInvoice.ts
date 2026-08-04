import { Request, Response, NextFunction } from 'express';
import { processPowerAutomateAttachment } from '../services/emailIntakeService';
import { checkEmailDuplicate, generateFileHash } from '../services/emailDuplicateService';
import { createJob, completeJob, failJob, cleanupOldJobs } from '../services/jobStore';
import { analyzeInvoice } from '../services/ocrService';
import { matchVendor } from '../services/vendorMatchingService';
import { validateInvoice } from '../services/validationService';
import { detectMultiInvoice, splitPdfByPageRanges } from '../services/multiInvoiceDetector';
import { uploadToStorage } from '../services/supabaseStorageService';
import { InvoiceStatus, InvoiceSource, InvoiceType, SignatureType, ExceptionReason, determineApprovalTier, BrandTier, isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import { parseMPOReference } from '../utils/mpoReference';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Build Prisma invoice_lines create data from OCR line_items.
 * Ensures line items are persisted to the InvoiceLine table (not just ocr_raw_data JSON)
 * so validation can do line-level material matching against NextGen PO lines.
 */
function buildInvoiceLinesData(lineItems: any[] | undefined, mpoNumber: string | undefined): any | undefined {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return undefined;
  const parsedMpo = mpoNumber ? parseMPOReference(mpoNumber) : { baseMpo: null, orderSequence: null, materialCode: null };
  return {
    create: lineItems.map((line: any, index: number) => ({
      line_number: Number(line.line_number || index + 1),
      description: line.description || line.material_name || null,
      mpo_base_number: line.mpo_base_number || parsedMpo.baseMpo || null,
      mpo_order_sequence: line.mpo_order_sequence || parsedMpo.orderSequence || null,
      material_code: line.material_code || line.item_code || parsedMpo.materialCode || null,
      material_name: line.material_name || line.description || null,
      quantity: line.quantity != null ? Number(line.quantity) : null,
      unit_price: line.unit_price != null ? Number(line.unit_price) : null,
      line_amount: line.line_amount != null ? Number(line.line_amount) : (line.total_amount != null ? Number(line.total_amount) : null),
      match_status: 'PENDING',
    })),
  };
}

/**
 * Process a single invoice buffer: OCR → duplicate check → vendor match → DB save → validation.
 * Used for both single invoices and individual splits from multi-invoice PDFs.
 *
 * @returns { success, invoiceId?, invoiceNumber?, status?, duplicate?, exceptions? }
 */
async function processSingleEmailInvoice(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  emailMetadata: any,
  requestId: string,
  splitIndex?: number,
): Promise<{
  success: boolean;
  duplicate?: boolean;
  duplicateLevel?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  status?: string;
  exceptions?: string[];
  error?: string;
}> {
  const partLabel = splitIndex !== undefined ? ` [part ${splitIndex + 1}]` : '';

  try {
    // Step 1: Pre-OCR duplicate check (Level 1: email message ID, Level 2: file hash)
    const preOcrDuplicate = await checkEmailDuplicate(fileBuffer, {
      internetMessageId: emailMetadata.internetMessageId,
      conversationId: emailMetadata.conversationId,
    });

    if (preOcrDuplicate.isDuplicate) {
      logger.info(`[${requestId}] Duplicate detected${partLabel} (${preOcrDuplicate.level}): ${preOcrDuplicate.existingInvoiceNumber}`);
      return {
        success: true,
        duplicate: true,
        duplicateLevel: preOcrDuplicate.level,
        invoiceId: preOcrDuplicate.existingInvoiceId,
        invoiceNumber: preOcrDuplicate.existingInvoiceNumber,
        status: 'DUPLICATE',
      };
    }

    // Step 2: OCR extraction
    const ocrResult = await analyzeInvoice(fileBuffer, mimeType);
    logger.info(`[${requestId}] OCR completed${partLabel}: ${ocrResult.invoice_number}, vendor: ${ocrResult.vendor_name}`);

    // Step 3: Post-OCR duplicate check (Level 3: business key)
    const postOcrDuplicate = await checkEmailDuplicate(fileBuffer, undefined, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: ocrResult.total_amount,
      invoiceDate: ocrResult.invoice_date,
    });

    if (postOcrDuplicate.isDuplicate) {
      logger.info(`[${requestId}] Business duplicate${partLabel}: ${postOcrDuplicate.existingInvoiceNumber}`);
      return {
        success: true,
        duplicate: true,
        duplicateLevel: postOcrDuplicate.level,
        invoiceId: postOcrDuplicate.existingInvoiceId,
        invoiceNumber: postOcrDuplicate.existingInvoiceNumber,
        status: 'DUPLICATE',
      };
    }

    // Step 4: Vendor matching
    let vendorId: string | undefined;
    try {
      const vendorMatch = await matchVendor(ocrResult.vendor_name);
      vendorId = vendorMatch?.vendor_id;
    } catch {
      logger.warn(`[${requestId}] Vendor not found${partLabel}: ${ocrResult.vendor_name}`);
    }

    // Step 5: Determine approval tier
    const tier = determineApprovalTier(ocrResult.total_amount || 0);

    // Step 6: Generate file hash
    const fileHash = generateFileHash(fileBuffer);

    // Step 7: Generate QB memo
    const memoParts = [
      ocrResult.brand_code || ocrResult.brand || '',
      ocrResult.season || '',
      ocrResult.order_type || '',
      ocrResult.mpo_number || '',
    ].filter(Boolean);
    const qbMemo = memoParts.length > 0 ? memoParts.join('_') : undefined;

    // Step 8: Determine brand tier
    let brand_tier: BrandTier | undefined;
    if (ocrResult.brand_code && TOP_10_BRANDS[ocrResult.brand_code]) {
      brand_tier = BrandTier.TOP_10;
    } else if (ocrResult.brand && isTop10Brand(ocrResult.brand)) {
      brand_tier = BrandTier.TOP_10;
    } else {
      brand_tier = BrandTier.OTHER;
    }

    // Step 8b: Upload to VPS Supabase Storage
    let storagePath: string | undefined;
    try {
      const uploadedPath = await uploadToStorage(fileBuffer, fileName, mimeType);
      if (uploadedPath) {
        storagePath = uploadedPath;
      }
    } catch (storageError) {
      logger.warn(`[${requestId}] Failed to upload to VPS storage${partLabel}:`, storageError);
    }

    // Step 9: Create invoice with email metadata
    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date) : null,
        invoice_received_date: new Date(emailMetadata.receivedDate),
        vendor_id: vendorId as any,
        vendor_name_raw: ocrResult.vendor_name,
        total_amount: ocrResult.total_amount,
        currency: ocrResult.currency,
        invoice_currency_original: ocrResult.invoice_currency_original,
        exchange_rate_to_usd: ocrResult.exchange_rate_to_usd || undefined,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        freight_charges: ocrResult.freight_charges || 0,
        additional_charges: ocrResult.additional_charges || 0,
        subtotal: ocrResult.subtotal || undefined,
        invoice_type: (ocrResult.invoice_type || InvoiceType.INVOICE) as any,
        order_type: ocrResult.order_type as any,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        brand_tier: brand_tier,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: (ocrResult.bill_to_entity || 'MADISON_88_LTD') as any,
        is_handwritten: ocrResult.is_handwritten || false,
        is_urgent: ocrResult.is_urgent || false,
        priority_flag: ocrResult.is_urgent || false,
        is_duplicate: false,
        invoice_hash: fileHash,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: {
          ...ocrResult,
          email_internet_message_id: emailMetadata.internetMessageId,
          email_conversation_id: emailMetadata.conversationId,
          email_sender: emailMetadata.senderEmail,
          email_subject: emailMetadata.subject,
          email_received_date: emailMetadata.receivedDate,
          email_attachment_name: emailMetadata.attachmentName,
          multi_invoice_split_index: splitIndex,
        } as any,
        bank_name: (ocrResult as any).bank_info?.bank_name || (ocrResult as any).bank_name || undefined,
        swift_code: (ocrResult as any).bank_info?.swift_code || (ocrResult as any).swift_code || undefined,
        account_number: (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorId ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: ocrResult.payment_terms,
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        // Persist line items to InvoiceLine table for line-level validation matching
        ...(buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number) ? {
          invoice_lines: buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number),
        } : {}),
      },
    });

    // Step 10: Create signature records if detected
    if (ocrResult.signatures && ocrResult.signatures.length > 0) {
      for (const sig of ocrResult.signatures) {
        await prisma.signature.create({
          data: {
            invoice_id: invoice.id,
            signatory_name: sig.signatory_name,
            signed_at: sig.signed_at ? new Date(sig.signed_at) : null,
            signatory_role: sig.signatory_role as any,
            signature_type: (sig.signature_type || SignatureType.DIGITAL) as any,
            ocr_detected: sig.ocr_detected ?? false,
          },
        });
      }
    }

    // Step 11: Audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'EMAIL_INVOICE_UPLOAD',
        performed_by: 'powerautomate',
        note: `Email invoice from ${emailMetadata.senderEmail}: ${fileName}${partLabel ? ` (split ${splitIndex! + 1})` : ''}. Subject: ${emailMetadata.subject}. MessageID: ${emailMetadata.internetMessageId}`,
      },
    });

    // Step 12: Exception if vendor not matched
    let exceptions: string[] = [];
    if (!vendorId) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}". Manual vendor assignment required.`,
        },
      });
      exceptions.push('VENDOR_NOT_FOUND');
    }

    // Step 13: Auto-trigger validation
    if (vendorId && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(`[${requestId}] Auto-validation${partLabel}: ${validationResult.passed ? 'PASSED' : 'FAILED'} (${validationResult.exceptions.length} exceptions)`);
        if (!validationResult.passed) {
          exceptions.push(...validationResult.exceptions.map(e => e.reason));
        }
      } catch (validationError) {
        logger.error(`[${requestId}] Auto-validation failed${partLabel}:`, validationError);
      }
    }

    logger.info(`[${requestId}] Invoice created${partLabel}: ${invoice.invoice_number} (${invoice.id})`);

    return {
      success: true,
      duplicate: false,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      exceptions: exceptions.length > 0 ? exceptions : undefined,
    };
  } catch (error: any) {
    logger.error(`[${requestId}] Email invoice processing failed${partLabel}:`, error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Process a single manual invoice buffer: OCR → duplicate check → vendor match → DB save → validation.
 * Used for both single manual uploads and individual splits from multi-invoice PDFs.
 */
async function processSingleManualInvoice(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  uploadedBy: string,
  requestId: string,
  splitIndex?: number,
): Promise<{
  success: boolean;
  duplicate?: boolean;
  duplicateLevel?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  status?: string;
  exceptions?: string[];
  error?: string;
}> {
  const partLabel = splitIndex !== undefined ? ` [part ${splitIndex + 1}]` : '';

  try {
    // Check file hash duplicate
    const dupCheck = await checkEmailDuplicate(fileBuffer);

    if (dupCheck.isDuplicate) {
      logger.info(`[${requestId}] Duplicate detected${partLabel}: ${dupCheck.existingInvoiceNumber}`);
      return {
        success: true,
        duplicate: true,
        invoiceId: dupCheck.existingInvoiceId,
        invoiceNumber: dupCheck.existingInvoiceNumber,
        status: 'DUPLICATE',
      };
    }

    // OCR
    const ocrResult = await analyzeInvoice(fileBuffer, mimeType);
    logger.info(`[${requestId}] OCR completed${partLabel}: ${ocrResult.invoice_number}, vendor: ${ocrResult.vendor_name}`);

    // Business duplicate check
    const bizDup = await checkEmailDuplicate(fileBuffer, undefined, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: ocrResult.total_amount,
      invoiceDate: ocrResult.invoice_date,
    });

    if (bizDup.isDuplicate) {
      logger.info(`[${requestId}] Business duplicate${partLabel}: ${bizDup.existingInvoiceNumber}`);
      return {
        success: true,
        duplicate: true,
        duplicateLevel: bizDup.level,
        invoiceId: bizDup.existingInvoiceId,
        invoiceNumber: bizDup.existingInvoiceNumber,
        status: 'DUPLICATE',
      };
    }

    // Vendor match
    let vendorId: string | undefined;
    try {
      const vendorMatch = await matchVendor(ocrResult.vendor_name);
      vendorId = vendorMatch?.vendor_id;
    } catch {
      logger.warn(`[${requestId}] Vendor not found${partLabel}: ${ocrResult.vendor_name}`);
    }

    const tier = determineApprovalTier(ocrResult.total_amount || 0);
    const fileHash = generateFileHash(fileBuffer);

    const memoParts = [
      ocrResult.brand_code || ocrResult.brand || '',
      ocrResult.season || '',
      ocrResult.order_type || '',
      ocrResult.mpo_number || '',
    ].filter(Boolean);
    const qbMemo = memoParts.length > 0 ? memoParts.join('_') : undefined;

    let brand_tier: BrandTier | undefined;
    if (ocrResult.brand_code && TOP_10_BRANDS[ocrResult.brand_code]) {
      brand_tier = BrandTier.TOP_10;
    } else if (ocrResult.brand && isTop10Brand(ocrResult.brand)) {
      brand_tier = BrandTier.TOP_10;
    } else {
      brand_tier = BrandTier.OTHER;
    }

    // Upload to VPS Supabase Storage
    let storagePath: string | undefined;
    try {
      const uploadedPath = await uploadToStorage(fileBuffer, fileName, mimeType);
      if (uploadedPath) {
        storagePath = uploadedPath;
      }
    } catch (storageError) {
      logger.warn(`[${requestId}] Failed to upload to VPS storage${partLabel}:`, storageError);
    }

    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date) : null,
        invoice_received_date: new Date(),
        vendor_id: vendorId as any,
        vendor_name_raw: ocrResult.vendor_name,
        total_amount: ocrResult.total_amount,
        currency: ocrResult.currency,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        freight_charges: ocrResult.freight_charges || 0,
        additional_charges: ocrResult.additional_charges || 0,
        invoice_type: (ocrResult.invoice_type || InvoiceType.INVOICE) as any,
        order_type: ocrResult.order_type as any,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        brand_tier: brand_tier,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: (ocrResult.bill_to_entity || 'MADISON_88_LTD') as any,
        is_duplicate: false,
        invoice_hash: fileHash,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: { ...ocrResult, manual_upload_by: uploadedBy, multi_invoice_split_index: splitIndex } as any,
        qb_memo: qbMemo,
        status: (vendorId ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: 'MANUAL' as any,
        approval_tier: tier,
        payment_terms: ocrResult.payment_terms,
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        // Persist line items to InvoiceLine table for line-level validation matching
        ...(buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number) ? {
          invoice_lines: buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number),
        } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'MANUAL_INVOICE_UPLOAD',
        performed_by: uploadedBy,
        note: `Manual upload: ${fileName}${partLabel ? ` (split ${splitIndex! + 1})` : ''}`,
      },
    });

    let exceptions: string[] = [];
    if (!vendorId) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}".`,
        },
      });
      exceptions.push('VENDOR_NOT_FOUND');
    }

    if (vendorId) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        if (!validationResult.passed) {
          exceptions.push(...validationResult.exceptions.map(e => e.reason));
        }
      } catch { }
    }

    logger.info(`[${requestId}] Manual invoice created${partLabel}: ${invoice.invoice_number} (${invoice.id})`);

    return {
      success: true,
      duplicate: false,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      exceptions: exceptions.length > 0 ? exceptions : undefined,
    };
  } catch (error: any) {
    logger.error(`[${requestId}] Manual invoice processing failed${partLabel}:`, error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * POST /api/email/invoice
 * Power Automate Flow 1: Supplier Invoice Intake
 * Accepts multipart form data with PDF + email metadata
 * Returns 202 with jobId for async processing
 */
export const emailInvoiceUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = crypto.randomUUID();
  logger.info(`[${requestId}] POST /api/email/invoice - started`);

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        status: 'REJECTED',
      });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;

    // File size validation
    if (fileSize > MAX_FILE_SIZE) {
      logger.warn(`[${requestId}] File too large: ${fileSize} bytes`);
      return res.status(413).json({
        success: false,
        status: 'MANUAL_REVIEW',
        reason: 'FILE_TOO_LARGE',
        detail: `File size ${fileSize} bytes exceeds 25MB limit`,
      });
    }

    // Extract email metadata from form body
    const emailMetadata = {
      senderEmail: req.body.senderEmail || req.body.fromAddress || '',
      senderName: req.body.senderName || '',
      subject: req.body.subject || req.body.emailSubject || '',
      body: req.body.body || req.body.emailBody || '',
      receivedDate: req.body.receivedDate || req.body.receivedDateTime || new Date().toISOString(),
      attachmentName: req.body.attachmentName || fileName,
      internetMessageId: req.body.internetMessageId || '',
      conversationId: req.body.conversationId || '',
      importance: req.body.importance || 'normal',
      categories: req.body.categories || '',
      mailbox: req.body.mailbox || 'PURCHASINGTEAM',
    };

    logger.info(`[${requestId}] File: ${fileName}, Size: ${fileSize}, From: ${emailMetadata.senderEmail}`);

    // Create async job
    const jobId = createJob('email-invoice-upload');

    // Process asynchronously
    setImmediate(async () => {
      try {
        const mimeType = req.file!.mimetype;
        const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

        // ─── Multi-invoice detection for PDFs ───
        if (isPdf) {
          try {
            const detection = await detectMultiInvoice(fileBuffer);
            if (detection.isMultiInvoice && detection.invoiceCount > 1) {
              logger.info(`[${requestId}] Multi-invoice PDF detected: ${detection.invoiceCount} invoices in ${fileName}. Splitting...`);

              const splitBuffers = await splitPdfByPageRanges(fileBuffer, detection.pageRanges);
              const allResults: any[] = [];

              for (let i = 0; i < splitBuffers.length; i++) {
                logger.info(`[${requestId}] Processing split invoice ${i + 1}/${splitBuffers.length} from ${fileName}`);
                try {
                  const result = await processSingleEmailInvoice(
                    splitBuffers[i],
                    mimeType,
                    `${fileName}_part${i + 1}`,
                    emailMetadata,
                    requestId,
                    i,
                  );
                  allResults.push({ split_index: i, ...result });
                } catch (splitErr: any) {
                  logger.error(`[${requestId}] Error processing split ${i + 1} of ${fileName}:`, splitErr);
                  allResults.push({ split_index: i, success: false, error: splitErr.message || String(splitErr) });
                }
              }

              const successCount = allResults.filter(r => r.success).length;
              const duplicateCount = allResults.filter(r => r.duplicate).length;
              const failCount = allResults.filter(r => !r.success && !r.duplicate).length;

              logger.info(`[${requestId}] Multi-invoice processing complete: ${successCount} created, ${duplicateCount} duplicates, ${failCount} failed`);

              completeJob(jobId, {
                success: failCount === 0,
                multiInvoice: true,
                invoiceCount: detection.invoiceCount,
                results: allResults,
                status: failCount === 0 ? 'PROCESSED' : 'PARTIAL',
                message: `${successCount} of ${detection.invoiceCount} invoices processed successfully`,
              });
              cleanupOldJobs();
              return;
            }
          } catch (detectErr: any) {
            logger.warn(`[${requestId}] Multi-invoice detection failed for ${fileName}, processing as single:`, detectErr.message || detectErr);
          }
        }

        // Single invoice — process normally
        const result = await processSingleEmailInvoice(fileBuffer, mimeType, fileName, emailMetadata, requestId);

        if (result.success) {
          completeJob(jobId, {
            success: true,
            duplicate: result.duplicate || false,
            duplicateLevel: result.duplicateLevel,
            invoiceId: result.invoiceId,
            invoiceNumber: result.invoiceNumber,
            status: result.status,
            ocrQueued: true,
            exceptions: result.exceptions,
          });
        } else {
          failJob(jobId, result.error || 'Processing failed');
        }
      } catch (error: any) {
        logger.error(`[${requestId}] Email invoice processing failed:`, error);
        failJob(jobId, error.message || String(error));
      }
      cleanupOldJobs();
    });

    res.status(202).json({
      success: true,
      jobId,
      status: 'UPLOAD_RECEIVED',
      duplicate: false,
      ocrQueued: true,
      message: `Attachment ${fileName} received, processing started`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/manual/invoice
 * Manual invoice upload (same as email but source = MANUAL)
 */
export const manualInvoiceUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = crypto.randomUUID();
  logger.info(`[${requestId}] POST /api/manual/invoice - started`);

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
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

    const uploadedBy = req.body.uploadedBy || 'manual_upload';

    const jobId = createJob('manual-invoice-upload');

    setImmediate(async () => {
      try {
        const mimeType = req.file!.mimetype;
        const fileName = req.file!.originalname;
        const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

        // ─── Multi-invoice detection for PDFs ───
        if (isPdf) {
          try {
            const detection = await detectMultiInvoice(fileBuffer);
            if (detection.isMultiInvoice && detection.invoiceCount > 1) {
              logger.info(`[${requestId}] Multi-invoice PDF detected in manual upload: ${detection.invoiceCount} invoices. Splitting...`);

              const splitBuffers = await splitPdfByPageRanges(fileBuffer, detection.pageRanges);
              const allResults: any[] = [];

              for (let i = 0; i < splitBuffers.length; i++) {
                logger.info(`[${requestId}] Processing manual split invoice ${i + 1}/${splitBuffers.length}`);
                try {
                  const result = await processSingleManualInvoice(
                    splitBuffers[i],
                    mimeType,
                    `${fileName}_part${i + 1}`,
                    uploadedBy,
                    requestId,
                    i,
                  );
                  allResults.push({ split_index: i, ...result });
                } catch (splitErr: any) {
                  logger.error(`[${requestId}] Error processing manual split ${i + 1}:`, splitErr);
                  allResults.push({ split_index: i, success: false, error: splitErr.message || String(splitErr) });
                }
              }

              const successCount = allResults.filter(r => r.success).length;
              const duplicateCount = allResults.filter(r => r.duplicate).length;
              const failCount = allResults.filter(r => !r.success && !r.duplicate).length;

              logger.info(`[${requestId}] Manual multi-invoice complete: ${successCount} created, ${duplicateCount} duplicates, ${failCount} failed`);

              completeJob(jobId, {
                success: failCount === 0,
                multiInvoice: true,
                invoiceCount: detection.invoiceCount,
                results: allResults,
                status: failCount === 0 ? 'PROCESSED' : 'PARTIAL',
                message: `${successCount} of ${detection.invoiceCount} invoices processed successfully`,
              });
              cleanupOldJobs();
              return;
            }
          } catch (detectErr: any) {
            logger.warn(`[${requestId}] Multi-invoice detection failed for manual upload, processing as single:`, detectErr.message || detectErr);
          }
        }

        // Single invoice — process normally
        const result = await processSingleManualInvoice(fileBuffer, mimeType, fileName, uploadedBy, requestId);

        if (result.success) {
          completeJob(jobId, {
            success: true,
            duplicate: result.duplicate || false,
            duplicateLevel: result.duplicateLevel,
            invoiceId: result.invoiceId,
            invoiceNumber: result.invoiceNumber,
            status: result.status,
            exceptions: result.exceptions,
          });
        } else {
          failJob(jobId, result.error || 'Processing failed');
        }
      } catch (error: any) {
        failJob(jobId, error.message || String(error));
      }
      cleanupOldJobs();
    });

    res.status(202).json({
      success: true,
      jobId,
      status: 'UPLOAD_RECEIVED',
      message: `Manual upload received, processing started`,
    });
  } catch (error) {
    next(error);
  }
};
