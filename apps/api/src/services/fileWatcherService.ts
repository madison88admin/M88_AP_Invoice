import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { analyzeInvoice } from './ocrService';
import { matchVendor, matchOrCreateVendor } from './vendorMatchingService';
import { validateInvoice } from './validationService';
import { checkEmailDuplicate, generateFileHash } from './emailDuplicateService';
import { checkDuplicateInvoice } from './duplicateDetectionService';
import { uploadToStorage } from './supabaseStorageService';
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
import { eventBroadcaster } from './eventBroadcaster';
import { detectMultiInvoice, splitPdfByPageRanges } from './multiInvoiceDetector';
import { sanitizeInvoiceType, sanitizeCategory } from '../utils/enumSanitizer';
import { parseMPOReference } from '../utils/mpoReference';

const INCOMING_DIR = process.env.WATCHER_INCOMING_DIR || '/incoming-invoices';
const PROCESSING_DIR = process.env.WATCHER_PROCESSING_DIR || '/incoming-invoices/processing';
const PROCESSED_DIR = process.env.WATCHER_PROCESSED_DIR || '/incoming-invoices/processed';
const DUPLICATES_DIR = process.env.WATCHER_DUPLICATES_DIR || '/incoming-invoices/duplicates';
const MANUAL_REVIEW_DIR = process.env.WATCHER_MANUAL_REVIEW_DIR || '/incoming-invoices/manual-review';
const FAILED_DIR = process.env.WATCHER_FAILED_DIR || '/incoming-invoices/failed';

let watcherInterval: NodeJS.Timeout | null = null;
let recoveryInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
const processedFiles = new Set<string>();

// Hard ceiling for a single file. OCR and the NextGen/storage calls behind it
// have their own timeouts, but a hung call used to pin `isProcessing` forever
// and silently stop every later poll.
const FILE_PROCESSING_TIMEOUT_MS = Number(process.env.FILE_WATCHER_FILE_TIMEOUT_MS || 10 * 60 * 1000);

const status = {
  running: false,
  intervalSeconds: 0,
  processing: false,
  currentFile: null as string | null,
  lastPollStartedAt: null as string | null,
  lastPollFinishedAt: null as string | null,
  lastFileProcessedAt: null as string | null,
  lastError: null as string | null,
  queueDepth: 0,
  processedCount: 0,
  timedOutCount: 0,
};

export function getFileWatcherStatus() {
  let queueDepth = status.queueDepth;
  try {
    if (fs.existsSync(INCOMING_DIR)) {
      queueDepth = fs.readdirSync(INCOMING_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).length;
    }
  } catch {
    // keep last known depth
  }
  return { ...status, incomingDir: INCOMING_DIR, queueDepth };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

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
 * Recover stuck files from processing/ directory on startup.
 * Files left in processing/ are from crashed/interrupted processing cycles.
 * Move them back to incoming/ so they get reprocessed.
 */
function recoverStuckFiles(): void {
  if (!fs.existsSync(PROCESSING_DIR)) return;

  const files = fs.readdirSync(PROCESSING_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) return;

  logger.info(`[File Watcher] Found ${files.length} stuck file(s) in processing/ — recovering...`);

  for (const fileName of files) {
    const processingPath = path.join(PROCESSING_DIR, fileName);
    try {
      const stat = fs.statSync(processingPath);
      if (!stat.isFile()) continue;

      // Check if this file is referenced by an existing invoice in the DB
      // If so, move it to the appropriate final folder instead of reprocessing
      // For now, just move back to incoming for reprocessing
      const incomingPath = path.join(INCOMING_DIR, fileName);

      // Handle name collision in incoming
      let targetPath = incomingPath;
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        targetPath = path.join(INCOMING_DIR, `${base}_recovered_${Date.now()}${ext}`);
      }

      fs.renameSync(processingPath, targetPath);
      logger.info(`[File Watcher] Recovered stuck file: ${fileName} → incoming/`);
    } catch (err) {
      logger.error(`[File Watcher] Failed to recover stuck file ${fileName}:`, err);
    }
  }
}

/**
 * Periodic recovery: move abandoned files in processing/ back to incoming/ so
 * they get reprocessed. Runs on its own timer so a long poll cycle can't
 * starve it, and never touches the file the watcher is working on.
 */
function recoverStuckFilesPeriodic(): void {
  if (!fs.existsSync(PROCESSING_DIR)) return;

  // Must exceed the per-file ceiling, otherwise a legitimately slow file would
  // be yanked out from under the processor.
  const STUCK_THRESHOLD_MS = Math.max(10 * 60 * 1000, FILE_PROCESSING_TIMEOUT_MS + 60_000);
  const now = Date.now();

  let files: string[];
  try {
    files = fs.readdirSync(PROCESSING_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  } catch {
    return;
  }
  if (files.length === 0) return;

  let recovered = 0;
  for (const fileName of files) {
    if (fileName === status.currentFile) continue;
    const processingPath = path.join(PROCESSING_DIR, fileName);
    try {
      const stat = fs.statSync(processingPath);
      if (!stat.isFile()) continue;

      // Only recover files older than 10 minutes
      const ageMs = now - stat.mtimeMs;
      if (ageMs < STUCK_THRESHOLD_MS) continue;

      // Move back to incoming (handle name collision)
      let targetPath = path.join(INCOMING_DIR, fileName);
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        targetPath = path.join(INCOMING_DIR, `${base}_recovered_${Date.now()}${ext}`);
      }

      fs.renameSync(processingPath, targetPath);
      // Remove from processed set so it gets picked up
      processedFiles.delete(fileName);
      recovered++;
      logger.info(`[File Watcher] Recovered stuck file (age: ${Math.round(ageMs / 1000)}s): ${fileName} → incoming/`);
    } catch (err) {
      // File might be in use — skip silently
    }
  }

  if (recovered > 0) {
    logger.info(`[File Watcher] Periodic recovery: ${recovered} stuck file(s) moved back to incoming/`);
  }
}

/**
 * Best-effort recovery of an invoice number from an SFTP filename.
 * SFTP filenames frequently embed the real invoice number, e.g.
 *   "1786950726377__PT_PAXAR_INV_PCI-26031718..pdf" → PCI-26031718
 *   "Bo Hing_Inv_1609160_HT&DRT.pdf"                  → INV-1609160
 * Returns null when no credible pattern is found.
 */
function extractInvoiceNumberFromFilename(fileName: string): string | null {
  const base = path.basename(fileName).replace(/\.pdf$/i, '');

  // Label-prefixed numbers first (most specific, least ambiguous):
  //   PCI-26031718, INV-1609160, INVOICE_123456, I/V.123456, NO-123456
  // Note: underscores are word characters, so we anchor with an explicit
  // non-letter/non-digit boundary instead of \b ("INV_PCI-..." would otherwise fail).
  const labeledPatterns = [
    /(?:^|[^A-Za-z0-9])(PCI[-_. ]?\d{4,10})(?![0-9])/i,
    /(?:^|[^A-Za-z0-9])((?:INV|INVOICE|IV|I\/V)[-_. ]?\d{3,12})(?![0-9])/i,
    /(?:^|[^A-Za-z0-9])(NO[-_. ]?\d{4,10})(?![0-9])/i,
  ];
  const normalize = (value: string): string =>
    value.replace(/[_. ]+/g, '-').replace(/-+/g, '-').trim().toUpperCase();

  for (const pattern of labeledPatterns) {
    const match = base.match(pattern);
    if (!match) continue;
    const raw = normalize(match[1]);
    if (/\d/.test(raw)) return raw;
  }

  // Generic vendor-prefixed pattern: PAX-445-2026, GF-2026-001234
  const generic = base.match(/(?:^|[^A-Za-z0-9])([A-Z]{2,4}[-_. ]\d{4,10}(?:[-_. ]\d{2,8})?)(?![0-9])/i);
  if (generic) {
    const raw = normalize(generic[1]);
    // Never treat SFTP/FTPS watcher names, PO numbers, or MPO references as invoice numbers
    if (/^(SFTP|FTPS|FTP|PO|MPO|SO|DO)/i.test(raw)) return null;
    if (/\d/.test(raw)) return raw;
  }

  return null;
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

  // Step 2a: Detect and decode base64-encoded files (Power Automate SFTP workaround)
  if (fileBuffer.length > 0 && fileBuffer[0] === 0x4a && fileBuffer[1] === 0x56) {
    // Check if it starts with "JVBERi" (base64 of "%PDF-")
    const headerStr = fileBuffer.slice(0, 6).toString('ascii');
    if (headerStr === 'JVBERi') {
      logger.warn(`[File Watcher] Base64-encoded PDF detected for ${fileName} — decoding...`);
      try {
        fileBuffer = Buffer.from(fileBuffer.toString('ascii'), 'base64');
        fs.writeFileSync(processingPath, fileBuffer);
        logger.info(`[File Watcher] Base64 decoded: ${fileName} (${fileBuffer.length} bytes)`);
      } catch (decodeErr) {
        logger.error(`[File Watcher] Base64 decode failed for ${fileName}:`, decodeErr);
        safeMove(processingPath, FAILED_DIR);
        return;
      }
    }
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

  // Step 3b: OCR confidence threshold check
  // If confidence < 60%, route to manual review instead of creating invoice with bad data
  const OCR_CONFIDENCE_THRESHOLD = parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.60');
  const ocrConfidence = ocrResult.ocr_confidence_score ?? 0;
  if (ocrConfidence < OCR_CONFIDENCE_THRESHOLD) {
    logger.warn(
      `[File Watcher] Low OCR confidence (${(ocrConfidence * 100).toFixed(1)}% < ${(OCR_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%) for ${fileName}${partLabel} → ManualReview`
    );
    if (splitIndex === undefined) safeMove(processingPath, MANUAL_REVIEW_DIR);
    await createAuditLog(
      null,
      'WATCHER_LOW_OCR_CONFIDENCE',
      `OCR confidence ${(ocrConfidence * 100).toFixed(1)}% below threshold ${(OCR_CONFIDENCE_THRESHOLD * 100).toFixed(0)}% for ${fileName}${partLabel}. Routed to manual review.`
    );
    return;
  }

  // Step 3c: Recover the invoice number from the original filename when OCR missed it.
  // SFTP filenames frequently embed the real invoice number
  // (e.g. "1786950726377__PT_PAXAR_INV_PCI-26031718..pdf" → PCI-26031718).
  // Doing this before duplicate detection lets the number-based checks catch
  // re-ingested PDFs and avoids creating placeholder numbers like SFTP-<timestamp>.
  if (!ocrResult.invoice_number) {
    const filenameNumber = extractInvoiceNumberFromFilename(fileName);
    if (filenameNumber) {
      logger.info(`[File Watcher] Recovered invoice number "${filenameNumber}" from filename "${fileName}" (OCR returned none)`);
      ocrResult.invoice_number = filenameNumber;
    }
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

  // Step 5b: Fuzzy duplicate check — same vendor + amount + invoice date (±3 days).
  // Catches re-ingested PDFs that slip past the number-based duplicate checks above
  // because the invoice number could not be extracted (OCR missed it AND the
  // filename has none). Only run for KNOWN vendors — matching against the UNKNOWN
  // vendor bucket would produce false positives.
  if (!ocrResult.invoice_number && !isVendorUnknown && ocrResult.total_amount > 0 && ocrResult.invoice_date) {
    try {
      const fuzzyDup = await checkDuplicateInvoice(
        '', // no number available — rely on fuzzy vendor/amount/date matching
        effectiveVendorId,
        ocrResult.total_amount,
        new Date(ocrResult.invoice_date)
      );
      if (fuzzyDup.is_duplicate && fuzzyDup.existing_invoice_id) {
        const reason = fuzzyDup.fuzzy_match_details?.match_reason || fuzzyDup.duplicate_type || 'fuzzy match';
        logger.warn(`[File Watcher] Duplicate (${fuzzyDup.duplicate_type}) for ${fileName}${partLabel} → existing ${fuzzyDup.existing_invoice_number}: ${reason}`);
        if (splitIndex === undefined) safeMove(processingPath, DUPLICATES_DIR);
        await createAuditLog(fuzzyDup.existing_invoice_id, 'WATCHER_DUPLICATE', `Duplicate detected for ${fileName}: ${reason}`);
        return;
      }
    } catch (fuzzyErr) {
      logger.warn(`[File Watcher] Fuzzy duplicate check failed for ${fileName}${partLabel}:`, fuzzyErr);
    }
  }

  // Fix: ensure invoice_number is not empty (unique constraint in DB)
  const effectiveInvoiceNumber = ocrResult.invoice_number || `SFTP-${Date.now()}`;
  if (!ocrResult.invoice_number) {
    logger.warn(
      `[File Watcher] No invoice number found for ${fileName}${partLabel} — using placeholder "${effectiveInvoiceNumber}". ` +
      `The real invoice number may be visible in the PDF; correct it before posting.`
    );
    await createAuditLog(null, 'WATCHER_FALLBACK_INVOICE_NUMBER', `No invoice number extracted for ${fileName}; placeholder ${effectiveInvoiceNumber} used.`);
  }

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
  let finalPdfPath: string | null = null;
  try {
    // Parse MPO reference for base MPO, order sequence, and material code
    const headerParsedMpo = ocrResult.mpo_number ? parseMPOReference(ocrResult.mpo_number) : { baseMpo: null, orderSequence: null, materialCode: null };
    const baseData: any = {
        invoice_number: effectiveInvoiceNumber,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date) : null,
        invoice_received_date: new Date(),
        vendor_id: effectiveVendorId,
        pdf_path: processingPath,
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
        mpo_base_number: headerParsedMpo.baseMpo || undefined,
        mpo_order_sequence: headerParsedMpo.orderSequence || undefined,
        material_code: headerParsedMpo.materialCode || undefined,
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
        beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || undefined,
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
    // Add invoice lines from OCR extraction if present
    const ocrLineItems = (ocrResult as any).line_items;
    if (Array.isArray(ocrLineItems) && ocrLineItems.length > 0) {
      baseData.invoice_lines = {
        create: ocrLineItems.map((line: any, index: number) => {
          // Use per-line MPO if present, otherwise fall back to invoice-level MPO
          const lineMpo = line.mpo_number || null;
          const lineParsedMpo = lineMpo ? parseMPOReference(lineMpo) : headerParsedMpo;
          return {
            line_number: Number(line.line_number || index + 1),
            description: line.description || line.material_name || null,
            mpo_base_number: line.mpo_base_number || lineParsedMpo.baseMpo || null,
            mpo_order_sequence: line.mpo_order_sequence || lineParsedMpo.orderSequence || null,
            material_code: line.material_code || line.item_code || lineParsedMpo.materialCode || null,
            material_name: line.material_name || line.description || null,
            quantity: line.quantity != null ? Number(line.quantity) : null,
            unit_price: line.unit_price != null ? Number(line.unit_price) : null,
            line_amount: line.line_amount != null ? Number(line.line_amount) : (line.total_amount != null ? Number(line.total_amount) : null),
            match_status: 'PENDING',
          };
        }),
      };
    }

    // Detect multiple MPOs in a single invoice
    const lineMpos = Array.isArray(ocrLineItems)
      ? [...new Set(ocrLineItems.map((l: any) => l.mpo_number).filter(Boolean))]
      : [];
    const hasMultipleMpos = lineMpos.length > 1;
    if (hasMultipleMpos) {
      logger.info(`[File Watcher] Invoice ${baseData.invoice_number} has multiple MPOs in one invoice: ${lineMpos.join(', ')}`);
    }

    const invoice = await prisma.invoice.create({
      data: baseData,
      include: { vendor: true, invoice_lines: true },
    });
    invoiceId = invoice.id;

    logger.info(`[File Watcher] Saved invoice ${invoice.invoice_number} with ${invoice.invoice_lines?.length || 0} line items`);

    // If multiple MPOs in one invoice, add a MULTI_PO_CONSOLIDATED exception for manual review
    if (hasMultipleMpos) {
      // Check if line totals match invoice total
      const lineTotalSum = ocrLineItems.reduce((sum: number, l: any) => sum + (Number(l.total_amount || l.line_amount) || 0), 0);
      const invoiceTotal = Number(ocrResult.total_amount) || 0;
      const totalsMatch = Math.abs(lineTotalSum - invoiceTotal) < 0.01;

      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.MULTI_PO_CONSOLIDATED as any,
          detail: `Invoice contains ${lineMpos.length} different MPOs: ${lineMpos.join(', ')}. ${totalsMatch ? 'Line totals match invoice total.' : `WARNING: Line totals ($${lineTotalSum.toFixed(2)}) do NOT match invoice total ($${invoiceTotal.toFixed(2)}) — manual review required.`} Each MPO will be exported separately during posting.`,
        },
      });
      logger.info(`[File Watcher] Added MULTI_PO_CONSOLIDATED exception for invoice ${invoice.invoice_number} (totals match: ${totalsMatch})`);
    }

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

    // For split invoices (multi-invoice PDF), upload the split buffer to Supabase
    // since safeMoveAndUpdatePdfPath is only called for single (non-split) invoices
    if (splitIndex !== undefined) {
      try {
        const splitFileName = `${fileName}.pdf`;
        const storagePath = await uploadToStorage(fileBuffer, splitFileName, 'application/pdf');
        if (storagePath) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { pdf_path: storagePath, raw_file_url: storagePath },
          });
          logger.info(`[File Watcher] Split PDF uploaded to Supabase: ${storagePath}`);
        } else {
          logger.warn(`[File Watcher] Split PDF Supabase upload returned null for ${invoice.invoice_number}`);
        }
      } catch (splitUploadErr) {
        logger.warn(`[File Watcher] Split PDF upload failed for ${invoice.invoice_number}:`, splitUploadErr);
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

    // Push the intake to connected clients so it appears without waiting for
    // the next dashboard poll.
    eventBroadcaster.broadcast({
      type: 'INVOICE_CREATED',
      invoiceId: invoice.id,
      data: { invoice_number: invoice.invoice_number, status: invoice.status, source: 'file_watcher' },
      timestamp: Date.now(),
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
          if (splitIndex === undefined) await safeMoveAndUpdatePdfPath(processingPath, MANUAL_REVIEW_DIR, invoiceId);
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
        if (splitIndex === undefined) await safeMoveAndUpdatePdfPath(processingPath, MANUAL_REVIEW_DIR, invoiceId);
        return;
      }
    }

    // No vendor match → ManualReview (but invoice is saved in DB with EXCEPTION_FLAGGED)
    if (isVendorUnknown) {
      if (splitIndex === undefined) await safeMoveAndUpdatePdfPath(processingPath, MANUAL_REVIEW_DIR, invoiceId);
      logger.info(`[File Watcher] ${fileName}${partLabel} → ManualReview (vendor not found, invoice saved as EXCEPTION_FLAGGED)`);
      return;
    }

    // Step 9: Move to Processed (only for single invoice — multi-invoice moves original in processFile)
    if (splitIndex === undefined) await safeMoveAndUpdatePdfPath(processingPath, PROCESSED_DIR, invoiceId);
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
  status.processing = true;
  status.lastPollStartedAt = new Date().toISOString();

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
      status.currentFile = fileName;

      try {
        await withTimeout(processFile(filePath, fileName), FILE_PROCESSING_TIMEOUT_MS, `Processing ${fileName}`);
        status.processedCount++;
        status.lastFileProcessedAt = new Date().toISOString();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('timed out after')) {
          status.timedOutCount++;
          // Let the file be picked up again by stuck-file recovery.
          processedFiles.delete(fileName);
        }
        status.lastError = `${fileName}: ${message}`;
        logger.error(`[File Watcher] Unhandled error for ${fileName}:`, err);
      } finally {
        status.currentFile = null;
      }
    }

    // Clean up processed set periodically (keep last 200 entries)
    if (processedFiles.size > 200) {
      const toRemove = Array.from(processedFiles).slice(0, 100);
      for (const f of toRemove) processedFiles.delete(f);
    }
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err);
    logger.error('[File Watcher] Poll cycle error:', err);
  } finally {
    isProcessing = false;
    status.processing = false;
    status.lastPollFinishedAt = new Date().toISOString();
  }
}

/**
 * Safely move a file to a target directory, handling name collisions.
 * Returns the final target path, or null if the move failed.
 */
function safeMove(sourcePath: string, targetDir: string): string | null {
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
    return targetPath;
  } catch (err) {
    logger.error(`[File Watcher] Failed to move ${sourcePath} → ${targetDir}:`, err);
    return null;
  }
}

/**
 * Move a file and update the invoice's pdf_path with the final destination.
 * Also uploads the PDF to Supabase Storage so it's accessible from the dashboard.
 */
async function safeMoveAndUpdatePdfPath(
  sourcePath: string,
  targetDir: string,
  invoiceId: string | null,
  fileName?: string
): Promise<string | null> {
  const finalPath = safeMove(sourcePath, targetDir);
  if (finalPath && invoiceId) {
    // Upload to Supabase Storage (best-effort — don't fail if upload fails)
    try {
      const fileBuffer = fs.readFileSync(finalPath);
      const baseName = fileName || path.basename(finalPath);
      const storagePath = await uploadToStorage(fileBuffer, baseName, 'application/pdf');
      if (storagePath) {
        // Save both Supabase storage path and raw_file_url
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { pdf_path: storagePath, raw_file_url: storagePath },
        });
        logger.info(`[File Watcher] PDF uploaded to Supabase storage: ${storagePath}`);
      } else {
        // Upload failed — keep local path
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { pdf_path: finalPath },
        });
      }
    } catch (err) {
      logger.warn(`[File Watcher] Supabase upload failed, keeping local path for invoice ${invoiceId}:`, err);
      try {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { pdf_path: finalPath },
        });
      } catch (updateErr) {
        logger.warn(`[File Watcher] Failed to update pdf_path for invoice ${invoiceId}:`, updateErr);
      }
    }
  }
  return finalPath;
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

  // Recover any stuck files from processing/ before starting
  recoverStuckFiles();

  status.running = true;
  status.intervalSeconds = intervalSeconds;

  // Initial poll after 5 seconds
  setTimeout(async () => {
    await pollIncomingDirectory();
  }, 5_000);

  // Set up recurring poll
  watcherInterval = setInterval(async () => {
    await pollIncomingDirectory();
  }, intervalSeconds * 1000);

  // Stuck-file recovery on an independent timer: it used to run inside the
  // poll cycle, so a wedged cycle also disabled the mechanism meant to rescue it.
  recoveryInterval = setInterval(() => {
    try {
      recoverStuckFilesPeriodic();
    } catch (err) {
      logger.error('[File Watcher] Stuck-file recovery error:', err);
    }
  }, 60_000);
}

/**
 * Run a poll cycle immediately (manual "scan now").
 */
export async function triggerFileWatcherScan(): Promise<{ started: boolean }> {
  if (isProcessing) return { started: false };
  await pollIncomingDirectory();
  return { started: true };
}

/**
 * Stop the file watcher.
 */
export function stopFileWatcher(): void {
  status.running = false;
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    logger.info('[File Watcher] Stopped');
  }
}
