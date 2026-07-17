import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { analyzeInvoice } from './ocrService';
import { matchVendor, matchOrCreateVendor } from './vendorMatchingService';
import { validateInvoice } from './validationService';
import { checkEmailDuplicate, generateFileHash } from './emailDuplicateService';
import {
  InvoiceStatus,
  InvoiceType,
  InvoiceSource,
  SignatureType,
  ExceptionReason,
  determineApprovalTier,
  BrandTier,
  isTop10Brand,
  TOP_10_BRANDS,
  UserRole,
} from '@ap-invoice/shared';
import prisma from '../config/database';
import { inAppNotificationService } from './inAppNotificationService';
import { detectMultiInvoice, splitPdfByPageRanges } from './multiInvoiceDetector';
import { sanitizeInvoiceType, sanitizeCategory } from '../utils/enumSanitizer';

const INCOMING_DIR = process.env.WATCHER_INCOMING_DIR || '/incoming-invoices';
const PROCESSING_DIR = process.env.WATCHER_PROCESSING_DIR || '/incoming-invoices/processing';
const PROCESSED_DIR = process.env.WATCHER_PROCESSED_DIR || '/incoming-invoices/processed';
const DUPLICATES_DIR = process.env.WATCHER_DUPLICATES_DIR || '/incoming-invoices/duplicates';
const MANUAL_REVIEW_DIR = process.env.WATCHER_MANUAL_REVIEW_DIR || '/incoming-invoices/manual-review';
const FAILED_DIR = process.env.WATCHER_FAILED_DIR || '/incoming-invoices/failed';

let watcherInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
const processedFiles = new Set<string>();

/**
 * Ensure all watcher directories exist.
 */
function ensureDirectories(): void {
  const dirs = [INCOMING_DIR, PROCESSING_DIR, PROCESSED_DIR, DUPLICATES_DIR, MANUAL_REVIEW_DIR, FAILED_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`[File Watcher] Created directory: ${dir}`);
    }
  }
}

/**
 * Process a single PDF file:
 * 1. Move to Processing
 * 2. Multi-invoice detection (split if needed)
 * 3. OCR extraction
 * 4. Vendor matching
 * 5. Duplicate detection (3 levels)
 * 6. NextGen validation
 * 7. Save to database
 * 8. Move to final folder
 */
async function processFile(filePath: string, fileName: string): Promise<void> {
  logger.info(`[File Watcher] Processing: ${fileName}`);

  // Step 1: Move to Processing
  const processingPath = path.join(PROCESSING_DIR, fileName);
  try {
    fs.renameSync(filePath, processingPath);
  } catch (err) {
    logger.error(`[File Watcher] Failed to move ${fileName} to processing:`, err);
    return;
  }

  // Step 2: Read file content
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(processingPath);
  } catch (err) {
    logger.error(`[File Watcher] Failed to read ${fileName}:`, err);
    safeMove(processingPath, FAILED_DIR);
    return;
  }

  // Step 2b: Multi-invoice detection
  try {
    const detection = await detectMultiInvoice(fileBuffer);
    if (detection.isMultiInvoice && detection.invoiceCount > 1) {
      logger.info(`[File Watcher] Multi-invoice PDF detected: ${detection.invoiceCount} invoices in ${fileName}. Splitting...`);

      const splitBuffers = await splitPdfByPageRanges(fileBuffer, detection.pageRanges);

      for (let i = 0; i < splitBuffers.length; i++) {
        const partName = `${fileName}_part${i + 1}`;
        logger.info(`[File Watcher] Processing split invoice ${i + 1}/${splitBuffers.length} from ${fileName}`);
        try {
          await processSingleInvoiceBuffer(splitBuffers[i], partName, processingPath, i);
        } catch (splitErr) {
          logger.error(`[File Watcher] Error processing split ${i + 1} of ${fileName}:`, splitErr);
        }
      }

      // Move original to processed after all splits are done
      safeMove(processingPath, PROCESSED_DIR);
      logger.info(`[File Watcher] ${fileName} → Processed (${detection.invoiceCount} invoices extracted) ✅`);
      return;
    }
  } catch (detectErr) {
    logger.warn(`[File Watcher] Multi-invoice detection failed for ${fileName}, processing as single:`, detectErr);
  }

  // Single invoice — process normally
  await processSingleInvoiceBuffer(fileBuffer, fileName, processingPath);
}

/**
 * Process a single invoice buffer (used for both single and multi-invoice PDFs).
 * Steps: OCR → Duplicate detection → Vendor matching → DB save → Validation → Move to final folder
 */
async function processSingleInvoiceBuffer(
  fileBuffer: Buffer,
  fileName: string,
  processingPath: string,
  splitIndex?: number
): Promise<void> {
  const partLabel = splitIndex !== undefined ? ` [part ${splitIndex + 1}]` : '';

  // Step 3: OCR extraction
  let ocrResult: any;
  try {
    ocrResult = await analyzeInvoice(fileBuffer, 'application/pdf');
  } catch (err) {
    logger.error(`[File Watcher] OCR failed for ${fileName}${partLabel}:`, err);
    if (splitIndex === undefined) safeMove(processingPath, FAILED_DIR);
    await createAuditLog(null, 'WATCHER_OCR_FAILED', `OCR extraction failed for ${fileName}${partLabel}: ${err}`);
    return;
  }

  // Step 4: Duplicate detection
  const fileHash = generateFileHash(fileBuffer);
  const dupResult = await checkEmailDuplicate(fileBuffer, undefined, {
    vendorName: ocrResult.vendor_name,
    invoiceNumber: ocrResult.invoice_number,
    amount: ocrResult.total_amount,
    invoiceDate: ocrResult.invoice_date,
  });

  if (dupResult.isDuplicate) {
    logger.info(`[File Watcher] Duplicate: ${fileName}${partLabel} → ${dupResult.existingInvoiceNumber} (${dupResult.level})`);
    if (splitIndex === undefined) safeMove(processingPath, DUPLICATES_DIR);
    await createAuditLog(
      dupResult.existingInvoiceId || null,
      'WATCHER_DUPLICATE',
      `Duplicate detected for ${fileName}: ${dupResult.detail}`
    );
    return;
  }

  // Also check DB directly for existing invoice_number to prevent unique constraint errors
  if (ocrResult.invoice_number) {
    const existing = await prisma.invoice.findFirst({
      where: { invoice_number: ocrResult.invoice_number },
      select: { id: true },
    });
    if (existing) {
      logger.info(`[File Watcher] Duplicate invoice_number "${ocrResult.invoice_number}" already in DB: ${fileName}${partLabel}`);
      if (splitIndex === undefined) safeMove(processingPath, DUPLICATES_DIR);
      await createAuditLog(existing.id, 'WATCHER_DUPLICATE', `Duplicate invoice_number ${ocrResult.invoice_number} for ${fileName}`);
      return;
    }
  }

  // Step 5: Vendor matching (with auto-create)
  let vendorId: string | undefined;
  let autoCreatedVendor = false;
  try {
    const bankInfo = (ocrResult as any).bank_info || {};
    const vendorResult = await matchOrCreateVendor(ocrResult.vendor_name, {
      bank_name: bankInfo.bank_name || (ocrResult as any).bank_name,
      swift_code: bankInfo.swift_code || (ocrResult as any).bank_swift,
      account_number: bankInfo.account_usd || bankInfo.account_number || (ocrResult as any).bank_account,
    });
    vendorId = vendorResult?.vendor_id;
    autoCreatedVendor = vendorResult?.auto_created || false;
    if (autoCreatedVendor) {
      logger.info(`[File Watcher] Auto-created vendor: "${ocrResult.vendor_name}" (id: ${vendorId})`);
    }
  } catch {
    logger.warn(`[File Watcher] No vendor match for "${ocrResult.vendor_name}"`);
    vendorId = undefined;
  }

  // Fallback: use UNKNOWN VENDOR if no match and auto-create failed (vendor_id is required in DB schema)
  const UNKNOWN_VENDOR_ID = '00000000-0000-0000-0000-000000000000';
  const effectiveVendorId = vendorId || UNKNOWN_VENDOR_ID;
  const isVendorUnknown = !vendorId;

  // Fix: ensure invoice_number is not empty (unique constraint in DB)
  const effectiveInvoiceNumber = ocrResult.invoice_number || `SFTP-${Date.now()}`;

  // Step 6: Build invoice data
  const tier = determineApprovalTier(ocrResult.total_amount || 0);
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

  // Step 7: Save to database
  let invoiceId: string | null = null;
  try {
    const baseData: any = {
        invoice_number: effectiveInvoiceNumber,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date) : null,
        invoice_received_date: new Date(),
        vendor_id: effectiveVendorId,
        vendor_name_raw: ocrResult.vendor_name,
        total_amount: ocrResult.total_amount,
        currency: ocrResult.currency,
        invoice_currency_original: ocrResult.invoice_currency_original,
        exchange_rate_to_usd: ocrResult.exchange_rate_to_usd || undefined,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        freight_charges: ocrResult.freight_charges || 0,
        additional_charges: ocrResult.additional_charges || 0,
        courier_charges: (ocrResult as any).courier_charges || undefined,
        handling_fee: (ocrResult as any).handling_fee || undefined,
        tt_charge: (ocrResult as any).tt_charge || undefined,
        setup_charge: (ocrResult as any).setup_charge || undefined,
        sample_charge: (ocrResult as any).sample_charge || undefined,
        min_order_charge: (ocrResult as any).min_order_charge || undefined,
        finance_surcharge: (ocrResult as any).finance_surcharge || undefined,
        subtotal: ocrResult.subtotal || undefined,
        tax_amount: (ocrResult as any).tax_amount || undefined,
        discount_amount: (ocrResult as any).discount_amount || undefined,
        ship_to: (ocrResult as any).ship_to || undefined,
        sold_to: (ocrResult as any).sold_to || undefined,
        invoice_type: sanitizeInvoiceType(ocrResult.invoice_type) as any,
        category: sanitizeCategory((ocrResult as any).category) as any,
        invoice_template_type: (ocrResult as any).invoice_template_type as any,
        order_type: ocrResult.order_type as any,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        brand_tier: brand_tier,
        season: ocrResult.season,
        qty_shipped: (ocrResult as any).qty_shipped || undefined,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: (ocrResult.bill_to_entity || 'MADISON_88_LTD') as any,
        is_handwritten: ocrResult.is_handwritten || false,
        is_urgent: ocrResult.is_urgent || false,
        priority_flag: ocrResult.is_urgent || false,
        priority_pay_date: ocrResult.priority_pay_date ? new Date(ocrResult.priority_pay_date) : null,
        is_duplicate: false,
        invoice_hash: fileHash,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: ocrResult as any,
        bank_name: (ocrResult as any).bank_info?.bank_name || (ocrResult as any).bank_name || undefined,
        swift_code: (ocrResult as any).bank_info?.swift_code || (ocrResult as any).swift_code || undefined,
        account_number: (ocrResult as any).bank_info?.account_usd || (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || (ocrResult as any).bank_account || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorId ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.MANUAL_UPLOAD as any,
        approval_tier: tier,
        payment_terms: ocrResult.payment_terms,
        ...(ocrResult.date_range_start ? { date_range_start: new Date(ocrResult.date_range_start) } : {}),
        ...(ocrResult.date_range_end ? { date_range_end: new Date(ocrResult.date_range_end) } : {}),
    };
    const invoice = await prisma.invoice.create({
      data: baseData,
      include: { vendor: true },
    });
    invoiceId = invoice.id;

    // Create signature records
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

    // Audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'FILE_WATCHER_INTAKE',
        performed_by: 'file_watcher',
        note: `Auto-processed from SFTP incoming folder: ${fileName}`,
      },
    });

    // Create exception if vendor not matched AND not auto-created
    if (isVendorUnknown && !autoCreatedVendor) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}". Manual vendor assignment required.`,
        },
      });
    } else if (autoCreatedVendor) {
      // Log auto-created vendor as an exception for review (bank info may need verification)
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `Auto-created vendor "${ocrResult.vendor_name}" from OCR extraction. Please verify vendor details and bank information.`,
        },
      });
    }

    // Notify coordinator about new invoice
    await inAppNotificationService.create({
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_name: ocrResult.vendor_name || 'Unknown',
      title: isVendorUnknown ? 'New Invoice Needs Review' : 'New Invoice Received',
      message: isVendorUnknown
        ? `Invoice ${invoice.invoice_number} from "${ocrResult.vendor_name}" was auto-processed via SFTP but vendor could not be matched. Please review and assign the correct vendor.`
        : `Invoice ${invoice.invoice_number} from ${ocrResult.vendor_name} ($${ocrResult.total_amount?.toFixed(2) || '0.00'} ${ocrResult.currency || 'USD'}) was auto-processed via SFTP and is ready for validation.`,
      type: isVendorUnknown ? 'warning' : 'info',
      category: 'upload',
      target_role: UserRole.PURCHASING_COORDINATOR,
    });
    logger.info(`[File Watcher] Notification sent to coordinator for ${invoice.invoice_number}`);

    // Step 8: Auto-trigger validation
    if (vendorId && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(
          `[File Watcher] Validation for ${invoice.invoice_number}: ` +
          `${validationResult.passed ? 'PASSED' : 'FAILED'} (${validationResult.exceptions.length} exceptions)`
        );

        if (!validationResult.passed && validationResult.exceptions.length > 0) {
          if (splitIndex === undefined) safeMove(processingPath, MANUAL_REVIEW_DIR);
          logger.info(`[File Watcher] ${fileName}${partLabel} → ManualReview (validation exceptions)`);
          return;
        }
      } catch (validationError) {
        logger.error(`[File Watcher] Validation failed for ${invoice.invoice_number}${partLabel}:`, validationError);
        // Flag as exception so it's visible in the system, not stuck in RECEIVED
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
        });
        await prisma.exception.create({
          data: {
            invoice_id: invoice.id,
            reason: ExceptionReason.OCR_LOW_CONFIDENCE as any,
            detail: `Validation error during file watcher processing: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
          },
        });
        if (splitIndex === undefined) safeMove(processingPath, MANUAL_REVIEW_DIR);
        return;
      }
    }

    // No vendor match → ManualReview (but invoice is saved in DB with EXCEPTION_FLAGGED)
    if (isVendorUnknown) {
      if (splitIndex === undefined) safeMove(processingPath, MANUAL_REVIEW_DIR);
      logger.info(`[File Watcher] ${fileName}${partLabel} → ManualReview (vendor not found, invoice saved as EXCEPTION_FLAGGED)`);
      return;
    }

    // Step 9: Move to Processed (only for single invoice — multi-invoice moves original in processFile)
    if (splitIndex === undefined) safeMove(processingPath, PROCESSED_DIR);
    logger.info(`[File Watcher] ${fileName}${partLabel} → Processed ✅`);
  } catch (err) {
    logger.error(`[File Watcher] DB save failed for ${fileName}${partLabel}:`, err);
    if (splitIndex === undefined) safeMove(processingPath, FAILED_DIR);
    if (invoiceId) {
      await createAuditLog(invoiceId, 'WATCHER_DB_FAILED', `Database save failed for ${fileName}: ${err}`);
    }
  }
}

/**
 * Poll cycle: scan incoming directory for new PDFs.
 */
async function pollIncomingDirectory(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    if (!fs.existsSync(INCOMING_DIR)) {
      return;
    }

    const files = fs.readdirSync(INCOMING_DIR);
    const pdfs = files.filter(
      (f) => f.toLowerCase().endsWith('.pdf') && !processedFiles.has(f)
    );

    if (pdfs.length === 0) return;

    logger.info(`[File Watcher] Found ${pdfs.length} new PDF(s) in ${INCOMING_DIR}`);

    for (const fileName of pdfs) {
      const filePath = path.join(INCOMING_DIR, fileName);

      // Skip directories
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      // Mark as processed to avoid reprocessing
      processedFiles.add(fileName);

      try {
        await processFile(filePath, fileName);
      } catch (err) {
        logger.error(`[File Watcher] Unhandled error for ${fileName}:`, err);
      }
    }

    // Clean up processed set periodically (keep last 200 entries)
    if (processedFiles.size > 200) {
      const toRemove = Array.from(processedFiles).slice(0, 100);
      for (const f of toRemove) processedFiles.delete(f);
    }
  } catch (err) {
    logger.error('[File Watcher] Poll cycle error:', err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Safely move a file to a target directory, handling name collisions.
 */
function safeMove(sourcePath: string, targetDir: string): void {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const fileName = path.basename(sourcePath);
    let targetPath = path.join(targetDir, fileName);

    // Handle name collision by appending timestamp
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      targetPath = path.join(targetDir, `${base}_${Date.now()}${ext}`);
    }

    fs.renameSync(sourcePath, targetPath);
  } catch (err) {
    logger.error(`[File Watcher] Failed to move ${sourcePath} → ${targetDir}:`, err);
  }
}

/**
 * Create audit log entry (best-effort).
 */
async function createAuditLog(invoiceId: string | null, action: string, note: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId as any,
        action,
        performed_by: 'file_watcher',
        note,
      },
    });
  } catch {
    // Non-critical
  }
}

/**
 * Start the local file watcher.
 * Polls the incoming directory every `intervalSeconds` (default 30).
 */
export async function startFileWatcher(intervalSeconds: number = 30): Promise<void> {
  logger.info(`[File Watcher] Starting with ${intervalSeconds}s poll interval`);
  logger.info(`[File Watcher] Incoming dir: ${INCOMING_DIR}`);

  ensureDirectories();

  // Initial poll after 5 seconds
  setTimeout(async () => {
    await pollIncomingDirectory();
  }, 5_000);

  // Set up recurring poll
  watcherInterval = setInterval(async () => {
    await pollIncomingDirectory();
  }, intervalSeconds * 1000);
}

/**
 * Stop the file watcher.
 */
export function stopFileWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    logger.info('[File Watcher] Stopped');
  }
}
