import { Request, Response, NextFunction } from 'express';
import { checkEmailDuplicate, generateFileHash, getDuplicateReplacementDecision, isHardDuplicate, supersedeInvoiceForReplacement } from '../services/emailDuplicateService';
import { createJob, completeJob, failJob, cleanupOldJobs } from '../services/jobStore';
import { analyzeInvoice } from '../services/ocrService';
import { getUnknownVendorPlaceholder, matchVendor } from '../services/vendorMatchingService';
import { recordEmailIntakeEvent } from '../services/emailIntakeMonitoringService';
import { getVendorPaymentTermDefault, preferExtractedPaymentTerms } from '../services/vendorDefaultsService';
import { validateInvoice } from '../services/validationService';
import { buildMultiInvoiceSourceMetadata, detectMultiInvoice, splitPdfByPageRanges } from '../services/multiInvoiceDetector';
import { uploadToStorage } from '../services/supabaseStorageService';
import { InvoiceStatus, InvoiceSource, InvoiceType, SignatureType, ExceptionReason, determineApprovalTier, BrandTier, isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import { parseMPOReference } from '../utils/mpoReference';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { classifyInvoiceDocument } from '../services/structuredInvoiceService';
import { getPayableBlockReason } from '../services/payableDocumentGuard';
import { ensureInvoiceBankSnapshot } from '../services/invoiceBankSnapshotService';
import { normalizeInvoiceReference, createDuplicateRevisionReviewFromCandidate } from '../services/accountingControlService';
import { createInvoiceOnceByFileHash, findActiveBusinessMatch, findExactFileMatch } from '../services/exactFileIntakeService';
import { resolveInvoiceSubtotal } from '../services/financialDetailsService';

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
 * Resolve a supplier without ever allowing a missing required vendor relation
 * to abort intake. A real vendor match is returned as MATCHED; an unknown or
 * conflicting bank-master match is routed to the single seeded placeholder
 * and remains EXCEPTION_FLAGGED for Accounting review. The placeholder is
 * deliberately not treated as a successful match, so it can never auto-pass
 * validation or payment approval.
 */
async function resolveIntakeVendor(
  vendorName: string | null | undefined,
  beneficiaryName?: string | null,
): Promise<{ vendorId: string; vendorMatched: boolean; matchConfidence?: number; matchType?: string }> {
  let vendorMatch: Awaited<ReturnType<typeof matchVendor>> = null;
  try {
    vendorMatch = await matchVendor(vendorName, beneficiaryName);
  } catch (error) {
    logger.warn('[EmailIntake] Vendor match failed; routing to review placeholder:', error);
  }

  if (vendorMatch?.vendor_id) {
    return {
      vendorId: vendorMatch.vendor_id,
      vendorMatched: true,
      matchConfidence: vendorMatch.confidence,
      matchType: vendorMatch.match_type,
    };
  }

  const placeholderId = await getUnknownVendorPlaceholder();
  if (!placeholderId) {
    throw new Error('UNKNOWN VENDOR placeholder is unavailable; invoice was not committed and requires intake recovery');
  }

  return {
    vendorId: placeholderId,
    vendorMatched: false,
    matchConfidence: 0,
    matchType: 'unmatched_review',
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
  multiInvoiceSource?: any,
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
  let replacementParentId: string | null = null;
  let recoveryStoragePath: string | undefined;
  let recoveryInvoiceNumber: string | undefined;

  try {
    // Step 1: Pre-OCR duplicate check (Level 1: email message ID, Level 2: file hash)
    const preOcrDuplicate = await checkEmailDuplicate(fileBuffer, {
      internetMessageId: emailMetadata.internetMessageId,
      conversationId: emailMetadata.conversationId,
    });

    // Exact re-delivery of an unprotected invoice becomes a replacement
    // cycle. Protected invoices remain blocked before any new row is created.
    if (isHardDuplicate(preOcrDuplicate) && preOcrDuplicate.existingInvoiceId) {
      const replacement = await getDuplicateReplacementDecision(preOcrDuplicate.existingInvoiceId);
      if (!replacement?.canReplace) {
        const reason = replacement?.reason || `Duplicate blocked: identical email/PDF already captured as ${preOcrDuplicate.existingInvoiceNumber || preOcrDuplicate.existingInvoiceId}.`;
        logger.warn(`[${requestId}] ${reason}${partLabel}`);
        return { success: false, duplicate: true, duplicateLevel: preOcrDuplicate.level, invoiceId: preOcrDuplicate.existingInvoiceId, invoiceNumber: preOcrDuplicate.existingInvoiceNumber, status: 'DUPLICATE_BLOCKED', error: reason };
      }
      replacementParentId = replacement.existingInvoiceId;
      logger.info(`[${requestId}] Exact duplicate will replace unprotected invoice ${replacement.existingInvoiceNumber}${partLabel}`);
    }

    // Step 1b: Upload to VPS Supabase Storage FIRST (before OCR — ensures file is saved even if OCR fails)
    let storagePath: string | undefined;
    try {
      const uploadedPath = await uploadToStorage(fileBuffer, fileName, mimeType);
      if (uploadedPath) {
        storagePath = uploadedPath;
        recoveryStoragePath = uploadedPath;
        logger.info(`[${requestId}] Invoice uploaded to VPS storage${partLabel}: ${storagePath}`);
      }
    } catch (storageError) {
      logger.warn(`[${requestId}] Failed to upload to VPS storage${partLabel}:`, storageError);
    }

    // Step 2: OCR extraction
    const ocrResult: any = await analyzeInvoice(fileBuffer, mimeType);
    recoveryInvoiceNumber = typeof ocrResult.invoice_number === 'string' ? ocrResult.invoice_number : undefined;
    logger.info(`[${requestId}] OCR completed${partLabel}: ${ocrResult.invoice_number}, vendor: ${ocrResult.vendor_name}`);

    // This legacy email controller writes directly with prisma, so it must
    // enforce the same pre-create gate as the newer intake service.
    const classification = ocrResult.document_classification || classifyInvoiceDocument({
      fileName,
      mimeType,
      text: String(ocrResult.raw_text || ocrResult.raw_data?.raw_text || ''),
    });
    const payableBlockReason = getPayableBlockReason({
      document_type: ocrResult.document_type,
      source_document_type: ocrResult.source_document_type,
      invoice_type: ocrResult.invoice_type,
      document_classification: classification,
      is_non_invoice_document: ocrResult.is_non_invoice_document,
      raw_text: ocrResult.raw_text || ocrResult.raw_data?.raw_text,
      fileName,
    });
    if (payableBlockReason) {
      return { success: false, status: 'REVIEW_REQUIRED', error: payableBlockReason };
    }
    const subtotalResolution = resolveInvoiceSubtotal(ocrResult);
    const parsedSubtotal = subtotalResolution.subtotal;
    if (parsedSubtotal === null || parsedSubtotal <= 0) {
      return {
        success: false,
        status: 'REVIEW_REQUIRED',
        error: 'Invoice subtotal is missing or cannot be safely derived from the extracted financial details. No invoice record was created.',
      };
    }

    // Step 3: Post-OCR duplicate check (Level 3: business key)
    const postOcrDuplicate = await checkEmailDuplicate(fileBuffer, undefined, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: ocrResult.total_amount,
      invoiceDate: ocrResult.invoice_date,
    });

    if (isHardDuplicate(postOcrDuplicate) && postOcrDuplicate.existingInvoiceId) {
      const replacement = await getDuplicateReplacementDecision(postOcrDuplicate.existingInvoiceId);
      if (!replacement?.canReplace) {
        const reason = replacement?.reason || `Duplicate blocked: identical PDF already captured as ${postOcrDuplicate.existingInvoiceNumber || postOcrDuplicate.existingInvoiceId}.`;
        logger.warn(`[${requestId}] ${reason}${partLabel}`);
        return { success: false, duplicate: true, duplicateLevel: postOcrDuplicate.level, invoiceId: postOcrDuplicate.existingInvoiceId, invoiceNumber: postOcrDuplicate.existingInvoiceNumber, status: 'DUPLICATE_BLOCKED', error: reason };
      }
      replacementParentId = replacement.existingInvoiceId;
      logger.info(`[${requestId}] Post-OCR exact duplicate will replace unprotected invoice ${replacement.existingInvoiceNumber}${partLabel}`);
    }

    // Step 4: Vendor matching
    const resolvedVendor = await resolveIntakeVendor(
      ocrResult.vendor_name,
      (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name,
    );
    const vendorId = resolvedVendor.vendorId;
    const vendorMatched = resolvedVendor.vendorMatched;

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

    // Step 9: Create invoice with email metadata through the same atomic
    // file-hash/business-key guard used by the Power Automate file watcher.
    // Resent emails can have a new Message-ID or slightly different PDF bytes;
    // those must still reuse the existing active invoice instead of creating a
    // second AP row after approval.
    const parsedMpo = ocrResult.mpo_number
      ? parseMPOReference(ocrResult.mpo_number)
      : { baseMpo: null, orderSequence: null, materialCode: null };
    const invoiceData: any = {
        invoice_number: ocrResult.invoice_number,
        ...(replacementParentId ? { parent_invoice_id: replacementParentId, revision: 1 } : {}),
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
        subtotal: parsedSubtotal,
        invoice_type: (ocrResult.invoice_type || InvoiceType.INVOICE) as any,
        order_type: ocrResult.order_type as any,
        order_type_detail: (ocrResult as any).order_type === 'OTHER' ? (ocrResult as any).order_type_detail : undefined,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        brand_tier: brand_tier,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        mpo_base_number: parsedMpo.baseMpo || undefined,
        mpo_order_sequence: parsedMpo.orderSequence || undefined,
        material_code: parsedMpo.materialCode || undefined,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: (ocrResult.bill_to_entity || 'MADISON_88_LTD') as any,
        is_handwritten: ocrResult.is_handwritten || false,
        is_urgent: ocrResult.is_urgent || false,
        priority_flag: ocrResult.is_urgent || false,
        is_duplicate: false,
        invoice_hash: fileHash,
        normalized_invoice_number: normalizeInvoiceReference(ocrResult.invoice_number) || undefined,
        line_items_signature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: {
          ...ocrResult,
          financial_details_resolution: subtotalResolution,
          vendor_match_status: vendorMatched ? 'MATCHED' : 'REVIEW_REQUIRED',
          vendor_match_type: resolvedVendor.matchType,
          vendor_match_confidence: resolvedVendor.matchConfidence,
          vendor_match_reason: vendorMatched ? undefined : 'No safe active vendor/bank-master match; Accounting mapping required',
          email_internet_message_id: emailMetadata.internetMessageId,
          email_conversation_id: emailMetadata.conversationId,
          email_sender: emailMetadata.senderEmail,
          email_subject: emailMetadata.subject,
          email_received_date: emailMetadata.receivedDate,
          email_attachment_name: emailMetadata.attachmentName,
          multi_invoice_split_index: splitIndex,
          multi_invoice_source: multiInvoiceSource,
        } as any,
        beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || undefined,
        bank_name: (ocrResult as any).bank_info?.bank_name || (ocrResult as any).bank_name || undefined,
        swift_code: (ocrResult as any).bank_info?.swift_code || (ocrResult as any).swift_code || undefined,
        account_number: (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        bank_match_status: vendorMatched ? 'MATCHED_VENDOR_MASTER' : 'UNMATCHED_VENDOR_REVIEW',
        bank_match_details: vendorMatched ? undefined : {
          reason: 'No safe active vendor/bank-master match',
          source_vendor_name: ocrResult.vendor_name || null,
          beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || null,
        },
        status: (vendorMatched ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: preferExtractedPaymentTerms(ocrResult.payment_terms, await getVendorPaymentTermDefault(vendorId)),
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        // Persist line items to InvoiceLine table for line-level validation matching
        ...(buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number) ? {
          invoice_lines: buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number),
        } : {}),
    };
    const saved = await createInvoiceOnceByFileHash(invoiceData, { vendor: true, invoice_lines: true });
    const invoice = saved.invoice;
    if (!saved.created) {
      const reason = saved.duplicateType === 'BUSINESS_KEY'
        ? `Duplicate invoice ${invoice.invoice_number} for the same vendor was already captured; existing record reused.`
        : `Identical PDF was already captured as ${invoice.invoice_number}; existing record reused.`;
      logger.warn(`[${requestId}] Email duplicate blocked${partLabel}: ${reason}`);
      await recordEmailIntakeEvent({
        source: 'POWER_AUTOMATE', stage: 'DUPLICATE', status: 'BLOCKED', fileName,
        invoiceId: invoice.id,
        error: reason,
        metadata: { duplicate_level: saved.duplicateType || 'FILE_HASH', existing_invoice_id: invoice.id, existing_invoice_number: invoice.invoice_number, file_hash: fileHash, request_id: requestId },
      });
      return { success: false, duplicate: true, duplicateLevel: saved.duplicateType || 'FILE_HASH', invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, status: 'DUPLICATE_BLOCKED', error: reason };
    }
    const duplicateCandidate = replacementParentId ? null : (postOcrDuplicate.isDuplicate ? postOcrDuplicate : preOcrDuplicate);
    if (duplicateCandidate?.isDuplicate && duplicateCandidate.existingInvoiceId) {
      await createDuplicateRevisionReviewFromCandidate({
        invoiceId: invoice.id,
        candidateInvoiceId: duplicateCandidate.existingInvoiceId,
        incoming: {
          vendor_id: invoice.vendor_id,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          total_amount: invoice.total_amount,
          currency: invoice.currency,
          invoice_hash: invoice.invoice_hash,
          line_items_signature: invoice.line_items_signature,
        },
        reason: `${fileName} matches existing invoice ${duplicateCandidate.existingInvoiceNumber || duplicateCandidate.existingInvoiceId}; Purchasing Coordinator classification required.`,
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.EXCEPTION_FLAGGED } as any });
    }
    if (replacementParentId) {
      await supersedeInvoiceForReplacement(replacementParentId, invoice.id, 'email-intake');
    }
    await ensureInvoiceBankSnapshot(invoice.id, 'email-controller');

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
    const exceptions: string[] = [];
    if (!vendorMatched) {
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
    if (vendorMatched && invoice.status === InvoiceStatus.RECEIVED as any) {
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
    if (recoveryStoragePath) {
      await recordEmailIntakeEvent({
        source: 'POWER_AUTOMATE',
        stage: 'FAILED',
        status: 'FAILED',
        fileName,
        error: error.message || String(error),
        metadata: {
          storage_path: recoveryStoragePath,
          invoice_number: recoveryInvoiceNumber,
          recovery_required: true,
          retryable: true,
          request_id: requestId,
          split_index: splitIndex,
        },
      });
    }
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
  multiInvoiceSource?: any,
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
  let replacementParentId: string | null = null;
  let recoveryStoragePath: string | undefined;
  let recoveryInvoiceNumber: string | undefined;

  try {
    // Check file hash duplicate
    const dupCheck = await checkEmailDuplicate(fileBuffer);

    if (isHardDuplicate(dupCheck) && dupCheck.existingInvoiceId) {
      const replacement = await getDuplicateReplacementDecision(dupCheck.existingInvoiceId);
      if (!replacement?.canReplace) {
        const reason = replacement?.reason || `Duplicate blocked: identical PDF already captured as ${dupCheck.existingInvoiceNumber || dupCheck.existingInvoiceId}.`;
        logger.warn(`[${requestId}] ${reason}${partLabel}`);
        return { success: false, duplicate: true, duplicateLevel: dupCheck.level, invoiceId: dupCheck.existingInvoiceId, invoiceNumber: dupCheck.existingInvoiceNumber, status: 'DUPLICATE_BLOCKED', error: reason };
      }
      replacementParentId = replacement.existingInvoiceId;
      logger.info(`[${requestId}] Exact duplicate will replace unprotected invoice ${replacement.existingInvoiceNumber}${partLabel}`);
    }

    // Upload to VPS Supabase Storage FIRST (before OCR — ensures file is saved even if OCR fails)
    let storagePath: string | undefined;
    try {
      const uploadedPath = await uploadToStorage(fileBuffer, fileName, mimeType);
      if (uploadedPath) {
        storagePath = uploadedPath;
        recoveryStoragePath = uploadedPath;
        logger.info(`[${requestId}] Invoice uploaded to VPS storage${partLabel}: ${storagePath}`);
      }
    } catch (storageError) {
      logger.warn(`[${requestId}] Failed to upload to VPS storage${partLabel}:`, storageError);
    }

    // OCR
    const ocrResult: any = await analyzeInvoice(fileBuffer, mimeType);
    recoveryInvoiceNumber = typeof ocrResult.invoice_number === 'string' ? ocrResult.invoice_number : undefined;
    logger.info(`[${requestId}] OCR completed${partLabel}: ${ocrResult.invoice_number}, vendor: ${ocrResult.vendor_name}`);

    const classification = ocrResult.document_classification || classifyInvoiceDocument({
      fileName,
      mimeType,
      text: String(ocrResult.raw_text || ocrResult.raw_data?.raw_text || ''),
    });
    const payableBlockReason = getPayableBlockReason({
      document_type: ocrResult.document_type,
      source_document_type: ocrResult.source_document_type,
      invoice_type: ocrResult.invoice_type,
      document_classification: classification,
      is_non_invoice_document: ocrResult.is_non_invoice_document,
      raw_text: ocrResult.raw_text || ocrResult.raw_data?.raw_text,
      fileName,
    });
    if (payableBlockReason) {
      return { success: false, status: 'REVIEW_REQUIRED', error: payableBlockReason };
    }

    const subtotalResolution = resolveInvoiceSubtotal(ocrResult);
    if (subtotalResolution.subtotal === null) {
      return {
        success: false,
        status: 'REVIEW_REQUIRED',
        error: 'Invoice subtotal is missing or cannot be safely derived from the extracted financial details. No invoice record was created.',
      };
    }

    // Business duplicate check
    const bizDup = await checkEmailDuplicate(fileBuffer, undefined, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: ocrResult.total_amount,
      invoiceDate: ocrResult.invoice_date,
    });

    if (isHardDuplicate(bizDup) && bizDup.existingInvoiceId) {
      const replacement = await getDuplicateReplacementDecision(bizDup.existingInvoiceId);
      if (!replacement?.canReplace) {
        const reason = replacement?.reason || `Duplicate blocked: identical PDF already captured as ${bizDup.existingInvoiceNumber || bizDup.existingInvoiceId}.`;
        logger.warn(`[${requestId}] ${reason}${partLabel}`);
        return { success: false, duplicate: true, duplicateLevel: bizDup.level, invoiceId: bizDup.existingInvoiceId, invoiceNumber: bizDup.existingInvoiceNumber, status: 'DUPLICATE_BLOCKED', error: reason };
      }
      replacementParentId = replacement.existingInvoiceId;
      logger.info(`[${requestId}] Post-OCR exact duplicate will replace unprotected invoice ${replacement.existingInvoiceNumber}${partLabel}`);
    }

    // Vendor match
    const resolvedVendor = await resolveIntakeVendor(
      ocrResult.vendor_name,
      (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name,
    );
    const vendorId = resolvedVendor.vendorId;
    const vendorMatched = resolvedVendor.vendorMatched;

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

    // The legacy manual-upload path used to run its duplicate check before a
    // non-atomic insert. Two simultaneous uploads could therefore both pass
    // the check and create two active AP rows. Serialize the exact file hash
    // and normalized supplier invoice identity around the insert as well.
    let racedDuplicate: any = null;
    const invoice = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fileHash}))`;
      if (!replacementParentId) {
        const exact = await findExactFileMatch(fileHash, tx);
        if (exact) {
          racedDuplicate = exact;
          return exact;
        }
        if (ocrResult.invoice_number && vendorId) {
          const businessLockKey = `${String(vendorId).trim()}:${String(normalizeInvoiceReference(ocrResult.invoice_number) || ocrResult.invoice_number).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessLockKey}))`;
          const businessMatch = await findActiveBusinessMatch({
            invoice_number: ocrResult.invoice_number,
            normalized_invoice_number: normalizeInvoiceReference(ocrResult.invoice_number),
            vendor_id: vendorId,
            vendor_name_raw: ocrResult.vendor_name,
            mpo_number: ocrResult.mpo_number,
            customer_po_number: ocrResult.customer_po_number,
            total_amount: ocrResult.total_amount,
            currency: ocrResult.currency,
            invoice_date: ocrResult.invoice_date,
          }, tx);
          if (businessMatch) {
            racedDuplicate = businessMatch;
            return businessMatch;
          }
        }
      }
      return tx.invoice.create({
      data: {
        invoice_number: ocrResult.invoice_number,
        ...(replacementParentId ? { parent_invoice_id: replacementParentId, revision: 1 } : {}),
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
        order_type_detail: (ocrResult as any).order_type === 'OTHER' ? (ocrResult as any).order_type_detail : undefined,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        brand_tier: brand_tier,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: (ocrResult.bill_to_entity || 'MADISON_88_LTD') as any,
        is_duplicate: false,
        invoice_hash: fileHash,
        normalized_invoice_number: normalizeInvoiceReference(ocrResult.invoice_number) || undefined,
        line_items_signature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        subtotal: subtotalResolution.subtotal || undefined,
        ocr_raw_data: {
          ...ocrResult,
          financial_details_resolution: subtotalResolution,
          vendor_match_status: vendorMatched ? 'MATCHED' : 'REVIEW_REQUIRED',
          vendor_match_type: resolvedVendor.matchType,
          vendor_match_confidence: resolvedVendor.matchConfidence,
          vendor_match_reason: vendorMatched ? undefined : 'No safe active vendor/bank-master match; Accounting mapping required',
          manual_upload_by: uploadedBy,
          multi_invoice_split_index: splitIndex,
          multi_invoice_source: multiInvoiceSource,
        } as any,
        qb_memo: qbMemo,
        bank_match_status: vendorMatched ? 'MATCHED_VENDOR_MASTER' : 'UNMATCHED_VENDOR_REVIEW',
        bank_match_details: vendorMatched ? undefined : {
          reason: 'No safe active vendor/bank-master match',
          source_vendor_name: ocrResult.vendor_name || null,
          beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || null,
        },
        status: (vendorMatched ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        // Keep the manual upload source aligned with the Prisma InvoiceSource
        // enum. 'MANUAL' is not a valid enum value and caused Prisma to reject
        // the insert after the PDF had already been uploaded to storage.
        source: InvoiceSource.MANUAL_UPLOAD as any,
        approval_tier: tier,
        payment_terms: preferExtractedPaymentTerms(ocrResult.payment_terms, await getVendorPaymentTermDefault(vendorId)),
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        // Persist line items to InvoiceLine table for line-level validation matching
        ...(buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number) ? {
          invoice_lines: buildInvoiceLinesData((ocrResult as any).line_items, ocrResult.mpo_number),
        } : {}),
      },
      });
    });
    if (racedDuplicate) {
      const reason = `Duplicate blocked: invoice ${racedDuplicate.invoice_number || ocrResult.invoice_number} for the same vendor was already captured; existing record reused.`;
      logger.warn(`[${requestId}] Manual-upload duplicate blocked${partLabel}: ${reason}`);
      return {
        success: false,
        duplicate: true,
        duplicateLevel: racedDuplicate.invoice_hash === fileHash ? 'FILE_HASH' : 'BUSINESS_KEY',
        invoiceId: racedDuplicate.id,
        invoiceNumber: racedDuplicate.invoice_number,
        status: 'DUPLICATE_BLOCKED',
        error: reason,
      };
    }
    const duplicateCandidate = replacementParentId ? null : (bizDup.isDuplicate ? bizDup : dupCheck);
    if (duplicateCandidate?.isDuplicate && duplicateCandidate.existingInvoiceId) {
      await createDuplicateRevisionReviewFromCandidate({
        invoiceId: invoice.id,
        candidateInvoiceId: duplicateCandidate.existingInvoiceId,
        incoming: {
          vendor_id: invoice.vendor_id,
          invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date,
          total_amount: invoice.total_amount,
          currency: invoice.currency,
          invoice_hash: invoice.invoice_hash,
          line_items_signature: invoice.line_items_signature,
        },
        reason: `${fileName} matches existing invoice ${duplicateCandidate.existingInvoiceNumber || duplicateCandidate.existingInvoiceId}; Purchasing Coordinator classification required.`,
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.EXCEPTION_FLAGGED } as any });
    }
    if (replacementParentId) {
      await supersedeInvoiceForReplacement(replacementParentId, invoice.id, uploadedBy || 'manual-upload');
    }
    await ensureInvoiceBankSnapshot(invoice.id, uploadedBy || 'email-controller');

    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'MANUAL_INVOICE_UPLOAD',
        performed_by: uploadedBy,
        note: `Manual upload: ${fileName}${partLabel ? ` (split ${splitIndex! + 1})` : ''}`,
      },
    });

    const exceptions: string[] = [];
    if (!vendorMatched) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}".`,
        },
      });
      exceptions.push('VENDOR_NOT_FOUND');
    }

    if (vendorMatched) {
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
    if (recoveryStoragePath) {
      await recordEmailIntakeEvent({
        source: 'MANUAL_UPLOAD',
        stage: 'FAILED',
        status: 'FAILED',
        fileName,
        error: error.message || String(error),
        metadata: {
          storage_path: recoveryStoragePath,
          invoice_number: recoveryInvoiceNumber,
          recovery_required: true,
          retryable: true,
          request_id: requestId,
          split_index: splitIndex,
        },
      });
    }
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
            if (detection.hasIsolatedInvoice || detection.isMultiInvoice) {
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
                    buildMultiInvoiceSourceMetadata(fileBuffer, detection.pageRanges[i], i, detection.pageRanges.length),
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
            if (detection.hasIsolatedInvoice || detection.isMultiInvoice) {
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
                    buildMultiInvoiceSourceMetadata(fileBuffer, detection.pageRanges[i], i, detection.pageRanges.length),
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
