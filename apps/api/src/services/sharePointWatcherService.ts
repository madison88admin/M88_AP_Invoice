import crypto from 'crypto';
import { logger } from '../utils/logger';
import { analyzeInvoice } from './ocrService';
import { matchVendor, matchOrCreateVendor } from './vendorMatchingService';
import { validateInvoice } from './validationService';
import { checkEmailDuplicate, generateFileHash } from './emailDuplicateService';
import { uploadInvoiceToStructuredFolder } from './sharePointService';
import {
  isSharePointConfigured,
  ensureWatcherFolders,
  listFilesInFolder,
  downloadFile,
  moveFile,
  FOLDER_INCOMING,
  FOLDER_PROCESSING,
  FOLDER_PROCESSED,
  FOLDER_DUPLICATES,
  FOLDER_MANUAL_REVIEW,
  FOLDER_FAILED,
} from './sharePointService';
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
} from '@ap-invoice/shared';
import prisma from '../config/database';

let watcherInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Process a single file from IncomingInvoices:
 * 1. Move to Processing
 * 2. Download + OCR
 * 3. Vendor matching
 * 4. Duplicate detection (3 levels)
 * 5. NextGen validation
 * 6. Save to DB
 * 7. Move to final folder (Processed / Duplicates / ManualReview / Failed)
 */
async function processIncomingFile(file: { id: string; name: string; size: number }): Promise<void> {
  const fileName = file.name;
  logger.info(`[SharePoint Watcher] Processing: ${fileName}`);

  // Step 1: Move to Processing folder
  try {
    await moveFile(file.id, FOLDER_PROCESSING);
  } catch (err) {
    logger.error(`[SharePoint Watcher] Failed to move ${fileName} to Processing:`, err);
    return; // Skip — will retry next cycle
  }

  let fileBuffer: Buffer;
  try {
    // Re-fetch the file item from Processing folder to get the new ID
    const processingFiles = await listFilesInFolder(FOLDER_PROCESSING);
    const movedFile = processingFiles.find((f) => f.name === fileName);
    if (!movedFile) {
      logger.error(`[SharePoint Watcher] Could not find ${fileName} in Processing folder after move`);
      return;
    }

    // Step 2: Download file content
    fileBuffer = await downloadFile(movedFile.id);
  } catch (err) {
    logger.error(`[SharePoint Watcher] Failed to download ${fileName}:`, err);
    await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_FAILED);
    return;
  }

  // Step 3: OCR extraction
  let ocrResult: any;
  try {
    ocrResult = await analyzeInvoice(fileBuffer, 'application/pdf');
  } catch (err) {
    logger.error(`[SharePoint Watcher] OCR failed for ${fileName}:`, err);
    await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_FAILED);
    await createAuditLog(null, 'WATCHER_OCR_FAILED', `OCR extraction failed for ${fileName}: ${err}`);
    return;
  }

  // Step 4: Duplicate detection (file hash + business key)
  const fileHash = generateFileHash(fileBuffer);
  const dupResult = await checkEmailDuplicate(fileBuffer, undefined, {
    vendorName: ocrResult.vendor_name,
    invoiceNumber: ocrResult.invoice_number,
    amount: ocrResult.total_amount,
    invoiceDate: ocrResult.invoice_date,
  });

  if (dupResult.isDuplicate) {
    logger.info(`[SharePoint Watcher] Duplicate detected: ${fileName} → ${dupResult.existingInvoiceNumber} (${dupResult.level})`);
    await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_DUPLICATES);
    await createAuditLog(
      dupResult.existingInvoiceId || null,
      'WATCHER_DUPLICATE',
      `Duplicate detected for ${fileName}: ${dupResult.detail}`
    );
    return;
  }

  // Step 5: Vendor matching (with auto-create)
  let vendorId: string | undefined;
  try {
    const bankInfo = (ocrResult as any).bank_info || {};
    const vendorResult = await matchOrCreateVendor(ocrResult.vendor_name, {
      bank_name: bankInfo.bank_name || (ocrResult as any).bank_name,
      swift_code: bankInfo.swift_code || (ocrResult as any).swift_code,
      account_number: bankInfo.account_usd || bankInfo.account_number || (ocrResult as any).account_number,
    });
    vendorId = vendorResult?.vendor_id;
  } catch {
    logger.warn(`[SharePoint Watcher] No vendor match for "${ocrResult.vendor_name}"`);
    vendorId = undefined;
  }

  // Step 6: Determine approval tier + brand tier + QB memo
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

  // Upload to structured SharePoint folder (for archival)
  let sharepointUrl: string | undefined;
  if (vendorId) {
    try {
      const uploadResult = await uploadInvoiceToStructuredFolder(
        ocrResult.vendor_name,
        ocrResult.invoice_number,
        ocrResult.invoice_date || new Date(),
        fileBuffer,
        fileName
      );
      if (uploadResult.success && uploadResult.webUrl) {
        sharepointUrl = uploadResult.webUrl;
      }
    } catch (uploadError) {
      logger.warn(`[SharePoint Watcher] Failed to upload to structured folder: ${uploadError}`);
    }
  }

  // Step 7: Save to database
  let invoiceId: string | null = null;
  try {
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
        invoice_currency_original: ocrResult.invoice_currency_original,
        exchange_rate_to_usd: ocrResult.exchange_rate_to_usd || undefined,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        freight_charges: ocrResult.freight_charges || 0,
        additional_charges: ocrResult.additional_charges || 0,
        subtotal: ocrResult.subtotal || undefined,
        tax_amount: (ocrResult as any).tax_amount || undefined,
        discount_amount: (ocrResult as any).discount_amount || undefined,
        ship_to: (ocrResult as any).ship_to || undefined,
        sold_to: (ocrResult as any).sold_to || undefined,
        invoice_type: (ocrResult.invoice_type || InvoiceType.INVOICE) as any,
        category: ((ocrResult as any).category || 'TRIMS') as any,
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
        account_number: (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorId ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: ocrResult.payment_terms,
        sharepoint_folder_url: sharepointUrl,
        sharepoint_filed_at: sharepointUrl ? new Date() : null,
        ...(ocrResult.date_range_start ? { date_range_start: new Date(ocrResult.date_range_start) } : {}),
        ...(ocrResult.date_range_end ? { date_range_end: new Date(ocrResult.date_range_end) } : {}),
      },
      include: { vendor: true },
    });
    invoiceId = invoice.id;

    // Create signature records if detected
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
        action: 'SHAREPOINT_WATCHER_INTAKE',
        performed_by: 'sharepoint_watcher',
        note: `Auto-processed from SharePoint IncomingInvoices: ${fileName}${sharepointUrl ? `. Archived: ${sharepointUrl}` : ''}`,
      },
    });

    // Create exception if vendor not matched
    if (!vendorId) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}". Manual vendor assignment required.`,
        },
      });
    }

    // Step 8: Auto-trigger validation if vendor matched
    if (vendorId && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(
          `[SharePoint Watcher] Auto-validation for ${invoice.invoice_number}: ` +
          `${validationResult.passed ? 'PASSED' : 'FAILED'} (${validationResult.exceptions.length} exceptions)`
        );

        if (!validationResult.passed && validationResult.exceptions.length > 0) {
          // Move to ManualReview if validation flagged exceptions
          await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_MANUAL_REVIEW);
          logger.info(`[SharePoint Watcher] ${fileName} → ManualReview (validation exceptions)`);
          return;
        }
      } catch (validationError) {
        logger.error(`[SharePoint Watcher] Validation failed for ${invoice.invoice_number}:`, validationError);
        await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_MANUAL_REVIEW);
        return;
      }
    }

    // If no vendor match → ManualReview
    if (!vendorId) {
      await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_MANUAL_REVIEW);
      logger.info(`[SharePoint Watcher] ${fileName} → ManualReview (vendor not found)`);
      return;
    }

    // Step 9: Move to ProcessedInvoices
    await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_PROCESSED);
    logger.info(`[SharePoint Watcher] ${fileName} → ProcessedInvoices ✅`);
  } catch (err) {
    logger.error(`[SharePoint Watcher] DB save failed for ${fileName}:`, err);
    await safeMoveByName(fileName, FOLDER_PROCESSING, FOLDER_FAILED);
    if (invoiceId) {
      await createAuditLog(invoiceId, 'WATCHER_DB_FAILED', `Database save failed for ${fileName}: ${err}`);
    }
  }
}

/**
 * Poll cycle: list files in IncomingInvoices, process each one sequentially.
 */
async function pollIncomingFolder(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const files = await listFilesInFolder(FOLDER_INCOMING);

    if (files.length === 0) return;

    logger.info(`[SharePoint Watcher] Found ${files.length} file(s) in IncomingInvoices`);

    // Process files sequentially to avoid overwhelming OCR/API
    for (const file of files) {
      // Only process PDFs
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        logger.info(`[SharePoint Watcher] Skipping non-PDF: ${file.name}`);
        continue;
      }
      try {
        await processIncomingFile(file);
      } catch (err) {
        logger.error(`[SharePoint Watcher] Unhandled error for ${file.name}:`, err);
      }
    }
  } catch (err) {
    logger.error('[SharePoint Watcher] Poll cycle error:', err);
  } finally {
    isProcessing = false;
  }
}

/**
 * Move file by name from one folder to another (fallback when we lose the file ID after move).
 */
async function safeMoveByName(
  fileName: string,
  fromFolder: string,
  toFolder: string
): Promise<void> {
  try {
    const files = await listFilesInFolder(fromFolder);
    const file = files.find((f) => f.name === fileName);
    if (file) {
      await moveFile(file.id, toFolder);
    }
  } catch (err) {
    logger.error(`[SharePoint Watcher] Failed to move ${fileName} from ${fromFolder} to ${toFolder}:`, err);
  }
}

/**
 * Create audit log entry (best-effort, non-blocking).
 */
async function createAuditLog(invoiceId: string | null, action: string, note: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        invoice_id: invoiceId as any,
        action,
        performed_by: 'sharepoint_watcher',
        note,
      },
    });
  } catch {
    // Non-critical
  }
}

/**
 * Start the SharePoint folder watcher.
 * Polls IncomingInvoices every `intervalSeconds` (default 30).
 */
export async function startSharePointWatcher(intervalSeconds: number = 30): Promise<void> {
  if (!isSharePointConfigured()) {
    logger.warn('[SharePoint Watcher] SharePoint not configured — watcher disabled');
    return;
  }

  logger.info(`[SharePoint Watcher] Starting with ${intervalSeconds}s poll interval`);

  // Ensure all folders exist
  try {
    await ensureWatcherFolders();
    logger.info('[SharePoint Watcher] All folders verified');
  } catch (err) {
    logger.error('[SharePoint Watcher] Failed to ensure folders:', err);
  }

  // Initial poll after 10 seconds
  setTimeout(async () => {
    await pollIncomingFolder();
  }, 10_000);

  // Set up recurring poll
  watcherInterval = setInterval(async () => {
    await pollIncomingFolder();
  }, intervalSeconds * 1000);
}

/**
 * Stop the SharePoint folder watcher.
 */
export function stopSharePointWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    logger.info('[SharePoint Watcher] Stopped');
  }
}
