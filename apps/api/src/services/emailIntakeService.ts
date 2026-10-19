import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { analyzeInvoice } from './ocrService';
import { evaluateCurrencyPolicy, normalizeToUsd } from './currencyPolicyService';
import { getUnknownVendorPlaceholder, matchOrCreateVendor } from './vendorMatchingService';
import { getVendorPaymentTermDefault, preferExtractedPaymentTerms } from './vendorDefaultsService';
import { validateInvoice } from './validationService';
import { uploadInvoiceToStructuredFolder } from './sharePointService';
import { downloadFromStorage, uploadToStorage } from './supabaseStorageService';
import { buildMultiInvoiceSourceMetadata, detectMultiInvoice, splitPdfByPageRanges } from './multiInvoiceDetector';
import { InvoiceStatus, InvoiceType, InvoiceSource, SignatureType, ExceptionReason, determineApprovalTier, BrandTier } from '@ap-invoice/shared';
import { isTop10Brand, TOP_10_BRANDS } from '@ap-invoice/shared';
import { sanitizeInvoiceType, sanitizeCategory } from '../utils/enumSanitizer';
import prisma, { isDbEnabled } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { alertEmailIntakeFailure, recordEmailIntakeEvent, recordIntakeRecoveryCase } from './emailIntakeMonitoringService';
import { analyzeWithRetry, describeIntakeError } from './intakeRetryService';
import { hasStrongNonInvoiceHeading } from './nonInvoiceSuppression';
import { PDFDocument } from 'pdf-lib';
import { buildIntakeIdempotencyKey, evaluateIntakeControls } from './intakeControlService';
import { checkEmailDuplicate, generateFileHash } from './emailDuplicateService';
import { getPayableBlockReason } from './payableDocumentGuard';
import { normalizeInvoiceReference, createDuplicateRevisionReviewFromCandidate } from './accountingControlService';

const clientId = process.env.GRAPH_API_CLIENT_ID || '';
const clientSecret = process.env.GRAPH_API_CLIENT_SECRET || '';
const tenantId = process.env.GRAPH_API_TENANT_ID || '';
const mailboxAddress = process.env.AP_MAILBOX_ADDRESS || 'PURCHASINGTEAM@madison88.com';
let emailPollerTimer: NodeJS.Timeout | null = null;
let emailPollerStarted = false;
let emailPollInProgress = false;
const processedMessageIds = new Set<string>();

async function countPdfPages(buffer: Buffer): Promise<number | undefined> {
  try {
    return (await PDFDocument.load(buffer, { ignoreEncryption: true })).getPageCount();
  } catch {
    return undefined;
  }
}

async function applyIntakeControls(
  ocrResult: any,
  buffer: Buffer,
): Promise<{ reasons: string[]; metadata: Record<string, unknown> }> {
  const inputPages = await countPdfPages(buffer);
  const rawProcessedPages = Number(ocrResult?.processed_pages ?? ocrResult?.pages_processed ?? ocrResult?.raw_data?.processed_pages);
  const processedPages = Number.isFinite(rawProcessedPages) ? rawProcessedPages : inputPages;
  ocrResult.input_pages = inputPages;
  ocrResult.processed_pages = processedPages;
  const controls = evaluateIntakeControls(ocrResult);
  return {
    reasons: controls.reasons,
    metadata: {
      intake_controls: controls,
      input_pages: inputPages,
      processed_pages: processedPages,
      page_coverage_complete: inputPages === undefined || inputPages === processedPages,
    },
  };
}

const NON_INVOICE_HINTS = /\b(statement|packing\s*(?:list|slip)|delivery\s*(?:note|receipt)|purchase\s*order|quotation|quote|remittance|receipt|shipping\s*document|shipment\s*document|air\s*way\s*bill|airway\s*bill|shipment\s*airwaybill|awb|bill\s*of\s*lading|cargo\s*manifest|forwarder(?:['’]s|s)?\s+billing\s+invoice|expeditors?\s+billing\s+invoice|forwarder(?:['’]s|s)?\s+invoice|expeditors?\s+invoice)\b/i;

export function intakeReviewReason(ocrResult: any, fileName: string, subject = ''): string | null {
  const consensusReviewFields = Array.isArray(ocrResult?.consensus_review_required_fields) ? ocrResult.consensus_review_required_fields : [];
  if (consensusReviewFields.length > 0) return `OCR engines disagreed on: ${consensusReviewFields.join(', ')}.`;
  const type = String(ocrResult?.invoice_type || '').toUpperCase();
  const isProforma = type === 'PROFORMA' || type === 'PROFORMA_INVOICE'
    || String(ocrResult?.document_type || '').toUpperCase() === 'PROFORMA_INVOICE';
  const rawText = String(ocrResult?.raw_text || ocrResult?.raw_data?.raw_text || '');
  const payableBlockReason = getPayableBlockReason({
    document_type: ocrResult?.document_type,
    invoice_type: ocrResult?.invoice_type,
    source_document_type: ocrResult?.source_document_type,
    document_classification: ocrResult?.document_classification || ocrResult?.raw_data?.document_classification,
    is_non_invoice_document: ocrResult?.is_non_invoice_document,
    raw_text: rawText,
    fileName,
  });
  if (payableBlockReason) return payableBlockReason;
  if ((!isProforma && ocrResult?.is_non_invoice_document) || hasStrongNonInvoiceHeading(rawText) || ['AIRWAY_BILL', 'PACKING_LIST', 'DELIVERY_RECEIPT', 'TECH_PACK', 'TRIM_RECEIPT', 'FAKTUR_PAJAK', 'FORWARDER_BILLING_INVOICE', 'FORWARDERS_BILLING_INVOICE', 'EXPEDITOR_BILLING_INVOICE', 'EXPEDITORS_BILLING_INVOICE', 'FORWARDER_INVOICE', 'EXPEDITOR_INVOICE', 'EXPEDITORS_INVOICE'].includes(type)) {
    return 'Document is a shipping/non-invoice document (packing list, AWB, delivery or shipment document) — not eligible for invoice creation.';
  }
  // Body classification wins over filename: only apply filename/subject hints
  // when the extracted type is not clearly payable. Previously a valid
  // INVOICE with "quote"/"receipt"/"layout" in the filename was parked.
  const typeLooksPayable =
    type.startsWith('INVOICE') ||
    type === 'PROFORMA' ||
    type === 'PROFORMA_INVOICE' ||
    type === 'COMMERCIAL' ||
    type === 'SALES' ||
    type === 'DEBIT_NOTE' ||
    type === 'CREDIT_NOTE';
  const normalizedHaystack = `${fileName} ${subject}`.replace(/[_-]+/g, ' ');
  const invoiceHeaderSignals = /\b(?:commercial\s+invoice|tax\s+invoice|sales\s+invoice|invoice)\b/i.test(rawText)
    && /\b(?:invoice\s*(?:no|number)|invoice\s*date|total(?:\s+amount)?|amount\s+due)\b/i.test(rawText)
    && String(ocrResult?.invoice_number || '').trim()
    && String(ocrResult?.vendor_name || '').trim()
    && Number(ocrResult?.total_amount) > 0;
  if ((type === 'STATEMENT' && !invoiceHeaderSignals) || (!typeLooksPayable && NON_INVOICE_HINTS.test(normalizedHaystack))) {
    return `Attachment appears to be a non-invoice document (${type || 'unclassified'}).`;
  }
  const amount = Number(ocrResult?.total_amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'A valid positive total amount was not extracted.';
  if (ocrResult?.invoice_date_extracted === false) return 'Invoice date was not confidently extracted from a labeled date field.';
  const confidence = Number(ocrResult?.ocr_confidence_score);
  const threshold = Number(process.env.OCR_CONFIDENCE_THRESHOLD || 0.60);
  if (Number.isFinite(confidence) && confidence < threshold) return `OCR confidence is below the review threshold (${confidence.toFixed(2)} < ${threshold.toFixed(2)}).`;
  const currency = String(ocrResult?.currency || '').trim().toUpperCase();
  // Non-USD handling is policy-driven (INTAKE_CURRENCY_MODE / vendor allowlists).
  // 'park' keeps the old behavior; 'exception'/'auto' create the invoice with a
  // currency exception so accounting reviews it before posting.
  if (currency && currency !== 'USD') {
    const policy = evaluateCurrencyPolicy(currency, ocrResult?.vendor_name, {
      needsCurrencyConfirmation: !!ocrResult?.needs_currency_confirmation,
      hasUsdEquivalent: Number(ocrResult?.usd_equivalent || 0) > 0,
    });
    if (policy.park) return `Only USD invoices are eligible for automatic capture (received: ${currency}).`;
    // USD-only amounts: normalize now; park when no conversion basis exists.
    const usd = normalizeToUsd(currency, Number(ocrResult?.total_amount || 0), {
      usdEquivalent: (ocrResult as any)?.usd_equivalent ?? null,
      exchangeRateToUsd: (ocrResult as any)?.exchange_rate_to_usd ?? null,
    });
    if (!usd) return `Currency ${currency} has no USD equivalent or exchange rate — cannot store a non-USD amount.`;
    (ocrResult as any)._usdNormalization = usd;
    (ocrResult as any)._currencyPolicy = policy;
  } else if (!currency) {
    return 'Only USD invoices are eligible for automatic capture (received: blank).';
  }
  if (!String(ocrResult?.invoice_number || '').trim()) return 'Invoice or debit-note number was not extracted.';
  if (!String(ocrResult?.vendor_name || '').trim()) return 'Vendor name was not extracted.';
  return null;
}

/**
 * Attach the currency-policy exception to a created invoice when the intake
 * review stored a policy decision that requires one (non-USD under
 * 'exception'/'auto' mode that was not allowlisted). Also flips the invoice to
 * EXCEPTION_FLAGGED so accounting sees it. No-op otherwise.
 */
/**
 * USD-only amounts policy (2026-09-28): stored invoice amounts must be USD.
 * Applies the computed normalization to the OCR result before record creation —
 * total_amount/currency become the USD settlement; the original currency, the
 * original amount, and the rate used are preserved in the reference fields.
 */
function applyUsdNormalization(ocrResult: any): void {
  const usd = ocrResult?._usdNormalization;
  if (!usd || !ocrResult?.currency || String(ocrResult.currency).toUpperCase() === 'USD') return;
  ocrResult.invoice_currency_original = usd.originalCurrency;
  ocrResult.exchange_rate_to_usd = usd.rateUsed;
  ocrResult.total_amount = usd.usdAmount;
  ocrResult.currency = usd.usdCurrency;
}

async function attachCurrencyPolicyException(
  invoiceId: string,
  invoiceNumber: string,
  ocrResult: any
): Promise<void> {
  const policy = ocrResult?._currencyPolicy;
  if (!policy?.needsException) return;
  try {
    await prisma.exception.create({
      data: {
        invoice_id: invoiceId,
        reason: ExceptionReason.AMOUNT_MISMATCH as any,
        detail: `Non-USD intake (${policy.currency}): ${policy.reason}. Verify the settlement amount before posting.`,
      },
    });
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
    });
    logger.info(`Non-USD invoice ${invoiceNumber} (${policy.currency}) created with currency exception`);
  } catch (err) {
    logger.error(`Failed to attach currency exception to ${invoiceNumber}:`, err);
  }
}

async function analyzeIntakeWithRetry(
  buffer: Buffer,
  contentType: string,
  fileName: string,
  source: 'GRAPH' | 'POWER_AUTOMATE' | 'SHAREPOINT',
  context: { mailbox?: string; messageId?: string; attachmentId?: string; intakeKey?: string } = {},
): Promise<any> {
  try {
    const outcome = await analyzeWithRetry(
      () => analyzeInvoice(buffer, contentType),
      {
        label: `OCR ${fileName}`,
        onRetry: (attempt, reason) => recordEmailIntakeEvent({
          source,
          stage: 'RETRY_ATTEMPT',
          mailbox: context.mailbox,
          messageId: context.messageId || context.intakeKey,
          attachmentId: context.attachmentId,
          fileName,
          metadata: { attempt, reason, source, file_name: fileName },
        }),
      },
    );
    return outcome.result;
  } catch (error) {
    const detail = describeIntakeError(error);
    throw new Error(`OCR provider failed for ${fileName}: ${detail}`);
  }
}

type AtomicIntakeEvent = {
  source: 'GRAPH' | 'POWER_AUTOMATE' | 'SHAREPOINT';
  intakeId: string;
  messageId?: string;
  attachmentId?: string;
  fileName: string;
  mailbox?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Persist the invoice and its CREATED event in one database transaction. The
 * PDF is uploaded first, so a transient DB failure can be retried without
 * losing the source document; the event is never allowed to claim CREATED
 * unless the invoice row committed successfully.
 */
async function createInvoiceAndIntakeEvent(invoiceData: any, event: AtomicIntakeEvent): Promise<any> {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({ data: invoiceData, include: { vendor: true } });
    const { ensureInvoiceBankSnapshot } = await import('./invoiceBankSnapshotService');
    await ensureInvoiceBankSnapshot(invoice.id, 'email-intake', tx, event.source);
    await tx.emailIntakeEvent.create({
      data: {
        source: event.source,
        intake_id: event.intakeId,
        mailbox: event.mailbox,
        message_id: event.messageId || event.intakeId,
        attachment_id: event.attachmentId,
        file_name: event.fileName,
        stage: 'CREATED',
        status: 'SUCCESS',
        invoice_id: invoice.id,
        metadata: { ...(event.metadata || {}), invoice_number: invoice.invoice_number },
      } as any,
    });
    return invoice;
  });
}

async function flagDuplicateIntake(invoice: any, duplicate: any, source: string, fileName: string): Promise<void> {
  if (!duplicate?.isDuplicate || !duplicate.existingInvoiceId || duplicate.existingInvoiceId === invoice.id) return;
  await createDuplicateRevisionReviewFromCandidate({
    invoiceId: invoice.id,
    candidateInvoiceId: duplicate.existingInvoiceId,
    incoming: {
      vendor_id: invoice.vendor_id,
      invoice_number: invoice.invoice_number,
      mpo_number: invoice.mpo_number,
      customer_po_number: invoice.customer_po_number,
      invoice_date: invoice.invoice_date,
      total_amount: invoice.total_amount,
      currency: invoice.currency,
      invoice_hash: invoice.invoice_hash,
      line_items_signature: invoice.line_items_signature,
      document_layout_fingerprint: invoice.document_layout_fingerprint,
    },
    reason: `${fileName} matches existing invoice ${duplicate.existingInvoiceNumber || duplicate.existingInvoiceId}; Purchasing Coordinator classification required.`,
  });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.EXCEPTION_FLAGGED } as any });
  await recordEmailIntakeEvent({
    source: source as any,
    stage: 'REVIEW_REQUIRED',
    status: 'REVIEW_REQUIRED',
    fileName,
    invoiceId: invoice.id,
    error: `Duplicate/revision review required; existing record ${duplicate.existingInvoiceNumber || duplicate.existingInvoiceId}.`,
    metadata: { duplicate_level: duplicate.level, existing_invoice_id: duplicate.existingInvoiceId },
  });
}

export function isEmailPollerConfigured(): boolean {
  return Boolean(clientId && clientSecret && tenantId && mailboxAddress);
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  contentBytes: string;
}

export interface EmailMessage {
  id: string;
  subject: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  receivedDateTime: Date;
  hasAttachments: boolean;
  attachments: EmailAttachment[];
}

export async function getGraphClient(): Promise<Client> {
  if (!clientId || !clientSecret || !tenantId) {
    throw new AppError('Microsoft Graph API credentials not configured', 500);
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

  const client = Client.init({
    authProvider: async (done) => {
      try {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        done(null, token.token);
      } catch (error) {
        done(error as Error, null);
      }
    },
  });

  return client;
}

export async function pollAPMailbox(): Promise<void> {
  if (emailPollInProgress) {
    logger.info('Email poll skipped because the previous poll is still running');
    return;
  }

  emailPollInProgress = true;
  try {
    const client = await getGraphClient();
    const configuredLookback = Number(process.env.EMAIL_POLLER_LOOKBACK_MINUTES || 15);
    const lookbackMinutes = Number.isFinite(configuredLookback)
      ? Math.max(5, configuredLookback)
      : 15;
    const receivedAfter = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
    const mailboxPath = `/users/${encodeURIComponent(mailboxAddress)}`;
    
    const messages = await client
      .api(`${mailboxPath}/mailFolders/Inbox/messages`)
      .filter(`receivedDateTime ge ${receivedAfter} and hasAttachments eq true`)
      .select('id,subject,from,receivedDateTime,hasAttachments')
      .orderby('receivedDateTime asc')
      .top(100)
      .get();

    await recordEmailIntakeEvent({
      source: 'GRAPH', stage: 'POLL_SUCCESS', mailbox: mailboxAddress,
      metadata: { message_count: messages.value?.length || 0, received_after: receivedAfter },
    });

    if (messages.value && messages.value.length > 0) {
      logger.info(`Found ${messages.value.length} new emails with attachments`);
      
      for (const message of messages.value) {
        if (processedMessageIds.has(message.id)) continue;

        const marker = `[Graph message ${message.id}]`;
        const alreadyProcessed = await prisma.auditLog.findFirst({
          where: {
            action: 'EMAIL_INTAKE',
            note: { contains: marker },
          },
          select: { id: true },
        });
        if (alreadyProcessed) {
          processedMessageIds.add(message.id);
          continue;
        }

        await recordEmailIntakeEvent({
          source: 'GRAPH', stage: 'RECEIVED', mailbox: mailboxAddress,
          messageId: message.id, metadata: { subject: message.subject, from: message.from?.emailAddress?.address },
        });

        await processEmailMessage(message);

        // Only remember messages that produced an invoice audit record. Failed
        // messages remain eligible for retry during the overlapping lookback.
        const processed = await prisma.auditLog.findFirst({
          where: {
            action: 'EMAIL_INTAKE',
            note: { contains: marker },
          },
          select: { id: true },
        });
        if (processed) processedMessageIds.add(message.id);
      }
    }
  } catch (error) {
    logger.error('Error polling AP mailbox:', error);
    const detail = error instanceof Error ? error.message : String(error);
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'POLL_FAILED', status: 'FAILED', mailbox: mailboxAddress, error: detail });
    await alertEmailIntakeFailure({ source: 'Microsoft Graph mailbox poll', error: detail });
  } finally {
    emailPollInProgress = false;
  }
}

async function processEmailMessage(message: any): Promise<void> {
  try {
    const client = await getGraphClient();
    const mailboxPath = `/users/${encodeURIComponent(mailboxAddress)}`;
    
    const attachments = await client
      .api(`${mailboxPath}/messages/${message.id}/attachments`)
      .get();

    if (attachments.value && attachments.value.length > 0) {
      for (const attachment of attachments.value) {
        if (isInvoiceAttachment(attachment)) {
          await recordEmailIntakeEvent({
            source: 'GRAPH', stage: 'ATTACHMENT_DETECTED', mailbox: mailboxAddress,
            messageId: message.id, attachmentId: attachment.id, fileName: attachment.name,
          });
          await processAttachment(attachment, message);
        }
      }
    }
  } catch (error) {
    logger.error(`Error processing email message ${message.id}:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    await recordEmailIntakeEvent({
      source: 'GRAPH', stage: 'FAILED', status: 'FAILED', mailbox: mailboxAddress,
      messageId: message.id, error: `Attachment processing failed: ${detail}`,
    });
    await alertEmailIntakeFailure({ source: 'Microsoft Graph attachment processing', error: detail });
  }
}

function isInvoiceAttachment(attachment: any): boolean {
  const contentType = attachment.contentType || '';
  const name = (attachment.name || '').toLowerCase();
  
  const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  
  return validTypes.includes(contentType) || 
         validExtensions.some(ext => name.endsWith(ext));
}

async function processAttachment(attachment: any, message: any): Promise<void> {
  try {
    // Convert base64 content to buffer
    const contentBytes = attachment.contentBytes;
    const buffer = Buffer.from(contentBytes, 'base64');
    
    // ─── Multi-invoice detection for PDFs ───
    const isPdf = attachment.contentType === 'application/pdf' || 
                  (attachment.name || '').toLowerCase().endsWith('.pdf');
    
    if (isPdf) {
      try {
        const detection = await detectMultiInvoice(buffer);
        if (detection.isMultiInvoice && detection.invoiceCount > 1) {
          logger.info(`[EmailIntake] Multi-invoice PDF detected: ${detection.invoiceCount} invoices in ${attachment.name}. Splitting...`);
          
          const splitBuffers = await splitPdfByPageRanges(buffer, detection.pageRanges);
          
          for (let i = 0; i < splitBuffers.length; i++) {
            logger.info(`[EmailIntake] Processing split invoice ${i + 1}/${splitBuffers.length} from ${attachment.name}`);
            try {
              await processSingleInvoiceAttachment(
                splitBuffers[i],
                attachment.contentType,
                `${attachment.name}_part${i + 1}`,
                message,
                i,
                attachment.id,
                buildMultiInvoiceSourceMetadata(buffer, detection.pageRanges[i], i, detection.pageRanges.length),
              );
            } catch (splitErr) {
              logger.error(`[EmailIntake] Error processing split ${i + 1} of ${attachment.name}:`, splitErr);
            }
          }
          return; // Done — all splits processed
        }
      } catch (detectErr) {
        logger.warn(`[EmailIntake] Multi-invoice detection failed for ${attachment.name}, processing as single:`, detectErr);
      }
    }
    
    // Single invoice — process normally
    await processSingleInvoiceAttachment(buffer, attachment.contentType, attachment.name, message, undefined, attachment.id);
    
  } catch (error) {
    logger.error(`Error processing attachment ${attachment.name}:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    await recordEmailIntakeEvent({
      source: 'GRAPH', stage: 'FAILED', status: 'FAILED', mailbox: mailboxAddress,
      messageId: message.id, attachmentId: attachment.id, fileName: attachment.name,
      error: `Attachment processing failed: ${detail}`,
    });
    await alertEmailIntakeFailure({ source: 'Microsoft Graph attachment processing', fileName: attachment.name, error: detail });
  }
}

// Internal: process a single invoice buffer (used for both single and multi-invoice PDFs)
async function processSingleInvoiceAttachment(
  buffer: Buffer,
  contentType: string,
  fileName: string,
  message: any,
  splitIndex?: number,
  attachmentId?: string,
  multiInvoiceSource?: any,
): Promise<void> {
  let storagePath: string | undefined;
  try {
    // Store every attachment before classification/OCR. Non-payable documents
    // are routed to REVIEW_REQUIRED after extraction, but their original PDF
    // must remain available for audit and later re-review.
    // Upload to VPS Supabase Storage FIRST (before OCR — ensures file is saved even if OCR fails)
    try {
      const uploadedPath = await uploadToStorage(buffer, fileName, contentType);
      if (uploadedPath) {
        storagePath = uploadedPath;
        logger.info(`[Email Intake] Invoice uploaded to VPS storage: ${storagePath}`);
        await recordEmailIntakeEvent({
          source: 'GRAPH', stage: 'UPLOADED', mailbox: mailboxAddress, messageId: message.id,
          attachmentId, fileName, metadata: { storage_path: storagePath },
        });
      }
    } catch (storageError) {
      logger.warn(`Failed to upload invoice to VPS storage for ${fileName}:`, storageError);
      const detail = storageError instanceof Error ? storageError.message : String(storageError);
      await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'FAILED', status: 'FAILED', mailbox: mailboxAddress, messageId: message.id, attachmentId, fileName, error: `Storage upload failed: ${detail}` });
      await alertEmailIntakeFailure({ source: 'Microsoft Graph storage upload', fileName, error: detail });
    }
    if (!storagePath) {
      await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'FAILED', status: 'FAILED', mailbox: mailboxAddress, messageId: message.id, attachmentId, fileName, error: 'Durable storage upload failed; invoice creation was skipped.', metadata: { storage_required: true, retryable: true } });
      return;
    }

    // Analyze invoice using OCR
    const ocrResult = await analyzeIntakeWithRetry(buffer, contentType, fileName, 'GRAPH', {
      mailbox: mailboxAddress, messageId: message.id, attachmentId,
    });
    const graphFileHash = generateFileHash(buffer);
    const graphIdempotencyKey = buildIntakeIdempotencyKey(message.id, graphFileHash);
    const graphControls = await applyIntakeControls(ocrResult, buffer);
    await recordEmailIntakeEvent({
      source: 'GRAPH', stage: 'EXTRACTED', mailbox: mailboxAddress, messageId: message.id,
      attachmentId, fileName, metadata: { invoice_number: ocrResult.invoice_number, confidence: ocrResult.ocr_confidence_score, idempotency_key: graphIdempotencyKey, ...graphControls.metadata },
    });

    // Do not create invoice rows for non-invoice attachments or incomplete
    // extraction results. Keep the file and route it to manual review instead.
    const reviewReason = intakeReviewReason(ocrResult, fileName, message.subject || '');
    if (reviewReason) {
      await recordEmailIntakeEvent({
        source: 'GRAPH', stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', mailbox: mailboxAddress,
        messageId: message.id, attachmentId, fileName,
        error: reviewReason,
        metadata: { invoice_type: ocrResult.invoice_type, amount: ocrResult.total_amount, currency: ocrResult.currency, invoice_number: ocrResult.invoice_number, storage_path: storagePath, intake_id: graphIdempotencyKey },
      });
      await alertEmailIntakeFailure({ source: 'Invoice intake review required', fileName, error: reviewReason });
      logger.warn(`[Email Intake] ${fileName} routed to review: ${reviewReason}`);
      return;
    }
    if (graphControls.reasons.length > 0) {
      const controlReason = graphControls.reasons.join(' ');
      await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', mailbox: mailboxAddress, messageId: message.id, attachmentId, fileName, error: controlReason, metadata: { ...graphControls.metadata, invoice_number: ocrResult.invoice_number, storage_path: storagePath, intake_id: graphIdempotencyKey } });
      await alertEmailIntakeFailure({ source: 'Invoice intake control', fileName, error: controlReason });
      logger.warn(`[Email Intake] ${fileName} routed to review: ${controlReason}`);
      return;
    }

    const graphDuplicate = await checkEmailDuplicate(buffer, { internetMessageId: message.id }, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: Number(ocrResult.total_amount),
      invoiceDate: ocrResult.invoice_date || null,
      currency: ocrResult.currency,
      mpoNumber: ocrResult.mpo_number,
      customerPoNumber: ocrResult.customer_po_number,
      lineItemsSignature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
      documentLayoutFingerprint: ocrResult.document_layout_fingerprint,
    });
    // A duplicate is retained as a new AP record. The coordinator will
    // classify it after creation; never overwrite the existing PDF.

    // OCR confidence threshold check — flag low confidence for manual review
    const OCR_CONFIDENCE_THRESHOLD = parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.60');
    const ocrConfidence = ocrResult.ocr_confidence_score ?? 0;
    const isLowConfidence = ocrConfidence < OCR_CONFIDENCE_THRESHOLD;
    if (isLowConfidence) {
      logger.warn(`[Email Intake] Low OCR confidence (${(ocrConfidence * 100).toFixed(1)}%) for ${fileName}`);
    }

    // Match vendor read-only; OCR never creates a Vendor Master row.
    let vendorId: string | undefined;
    let vendorMatched = false;
    try {
      const bankInfo = (ocrResult as any).bank_info || {};
      const vendorResult = await matchOrCreateVendor(ocrResult.vendor_name, {
        beneficiary_name: bankInfo.beneficiary_name || (ocrResult as any).beneficiary_name,
        bank_name: bankInfo.bank_name || (ocrResult as any).bank_name,
        swift_code: bankInfo.swift_code || (ocrResult as any).swift_code,
        account_number: bankInfo.account_usd || bankInfo.account_number || (ocrResult as any).account_number,
      });
      vendorId = vendorResult?.vendor_id;
      vendorMatched = Boolean(vendorId);
    } catch (error) {
      logger.warn(`No vendor match found for ${ocrResult.vendor_name}, creating exception`);
      vendorId = undefined;
    }
    if (!vendorMatched) vendorId = (await getUnknownVendorPlaceholder()) || undefined;

    // Determine approval tier from amount
    const tier = determineApprovalTier(ocrResult.total_amount || 0);

    // Generate QB memo: brand_season_ordertype_MPO_approvaldate
    const memoParts = [
      ocrResult.brand_code || ocrResult.brand || '',
      ocrResult.season || '',
      ocrResult.order_type || '',
      ocrResult.mpo_number || '',
    ].filter(Boolean);
    const qbMemo = memoParts.length > 0 ? memoParts.join('_') : undefined;

    // Upload to structured SharePoint folder (secondary, if configured)
    let sharepointUrl: string | undefined;
    if (vendorMatched) {
      try {
        const uploadResult = await uploadInvoiceToStructuredFolder(
          ocrResult.vendor_name,
          ocrResult.invoice_number,
          ocrResult.invoice_date || new Date(),
          buffer,
          fileName
        );
        if (uploadResult.success && uploadResult.webUrl) {
          sharepointUrl = uploadResult.webUrl;
        }
      } catch (uploadError) {
        logger.warn(`Failed to upload invoice to SharePoint for ${ocrResult.invoice_number}:`, uploadError);
        // Continue without SharePoint upload - don't block the entire process
      }
    }

    // Determine brand_tier from brand or brand_code
    let brand_tier: BrandTier | undefined;
    if (ocrResult.brand_code && TOP_10_BRANDS[ocrResult.brand_code]) {
      brand_tier = BrandTier.TOP_10;
    } else if (ocrResult.brand && isTop10Brand(ocrResult.brand)) {
      brand_tier = BrandTier.TOP_10;
    } else {
      brand_tier = BrandTier.OTHER;
    }

    // Create invoice record with BRD v5.0 schema fields
    applyUsdNormalization(ocrResult);
    const invoice = await createInvoiceAndIntakeEvent({
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date) : null,
        invoice_received_date: new Date(),
        vendor_id: vendorId as any,
        vendor_name_raw: ocrResult.vendor_name,
        total_amount: ocrResult.total_amount,
        currency: ocrResult.currency,
        invoice_currency_original: ocrResult.invoice_currency_original,
        exchange_rate_to_usd: ocrResult.exchange_rate_to_usd ? ocrResult.exchange_rate_to_usd : undefined,
        incoterm: ocrResult.incoterm,
        bank_charges: ocrResult.bank_charges || 0,
        freight_charges: ocrResult.freight_charges || 0,
        additional_charges: ocrResult.additional_charges || 0,
        subtotal: ocrResult.subtotal || undefined,
        tax_amount: (ocrResult as any).tax_amount || undefined,
        discount_amount: (ocrResult as any).discount_amount || undefined,
        ship_to: (ocrResult as any).ship_to || undefined,
        sold_to: (ocrResult as any).sold_to || undefined,
        invoice_type: sanitizeInvoiceType(ocrResult.invoice_type) as any,
        category: sanitizeCategory((ocrResult as any).category) as any,
        invoice_template_type: (ocrResult as any).invoice_template_type as any,
        order_type: ocrResult.order_type as any,
        order_type_detail: (ocrResult as any).order_type === 'OTHER' ? (ocrResult as any).order_type_detail : undefined,
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
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: { ...ocrResult, email_internet_message_id: message.id, attachment_file_hash: graphFileHash, intake_idempotency_key: graphIdempotencyKey, multi_invoice_split_index: splitIndex, multi_invoice_source: multiInvoiceSource } as any,
        invoice_hash: graphFileHash,
        normalized_invoice_number: normalizeInvoiceReference(ocrResult.invoice_number) || undefined,
        line_items_signature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
        beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || undefined,
        bank_name: (ocrResult as any).bank_info?.bank_name || (ocrResult as any).bank_name || undefined,
        swift_code: (ocrResult as any).bank_info?.swift_code || (ocrResult as any).swift_code || undefined,
        account_number: (ocrResult as any).bank_info?.account_usd || (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || (ocrResult as any).bank_account || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorMatched && !isLowConfidence ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: preferExtractedPaymentTerms(ocrResult.payment_terms, await getVendorPaymentTermDefault(vendorId)),
        sharepoint_folder_url: sharepointUrl,
        sharepoint_filed_at: sharepointUrl ? new Date() : null,
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        source_message_id: message.id,
        source_attachment_id: attachmentId,
        source_received_at: new Date(message.receivedDateTime || Date.now()),
        ...(ocrResult.date_range_start ? { date_range_start: new Date(ocrResult.date_range_start) } : {}),
        ...(ocrResult.date_range_end ? { date_range_end: new Date(ocrResult.date_range_end) } : {}),
      },
      {
        source: 'GRAPH',
        intakeId: graphIdempotencyKey,
        messageId: message.id,
        attachmentId,
        fileName,
        mailbox: mailboxAddress,
        metadata: { storage_path: storagePath, invoice_number: ocrResult.invoice_number },
      },
    );

    await flagDuplicateIntake(invoice, graphDuplicate, 'GRAPH', fileName);

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

    // Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'EMAIL_INTAKE',
        performed_by: 'email_poller',
        note: `[Graph message ${message.id}] Email intake from ${message.from?.emailAddress?.address}: ${fileName}${splitIndex !== undefined ? ` (part ${splitIndex + 1})` : ''}${sharepointUrl ? `. Uploaded to SharePoint: ${sharepointUrl}` : ''}`,
      },
    });

    // Create exception if vendor not matched
    if (!vendorMatched) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.VENDOR_NOT_FOUND as any,
          detail: `No vendor match found for "${ocrResult.vendor_name}". Manual vendor assignment required.`,
        },
      });
    }

    await attachCurrencyPolicyException(invoice.id, invoice.invoice_number, ocrResult);

    // Create exception if OCR confidence is low
    if (isLowConfidence) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.OCR_LOW_CONFIDENCE as any,
          detail: `OCR confidence ${(ocrConfidence * 100).toFixed(1)}% is below threshold ${(OCR_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%. Manual review of extracted data required.`,
        },
      });
    }
    
    // Auto-trigger validation if invoice was created in RECEIVED status (vendor matched, confidence OK)
    if (vendorMatched && !isLowConfidence && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(
          `Auto-validation completed for ${invoice.invoice_number}: ` +
          `${validationResult.passed ? 'PASSED' : 'FAILED'} ` +
          `(${validationResult.exceptions.length} exceptions)`
        );
      } catch (validationError) {
        logger.error(`Auto-validation failed for ${invoice.invoice_number}:`, validationError);
      }
    }

    logger.info(`Successfully processed invoice ${invoice.invoice_number} from email${splitIndex !== undefined ? ` (part ${splitIndex + 1})` : ''}`);
    
  } catch (error) {
    logger.error(`Error processing attachment ${fileName}:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    await recordEmailIntakeEvent({
      source: 'GRAPH', stage: 'FAILED', status: 'FAILED', mailbox: mailboxAddress,
      messageId: message.id, attachmentId, fileName, error: detail,
      metadata: { storage_path: storagePath, retryable: true },
    });
    await alertEmailIntakeFailure({ source: 'Microsoft Graph', fileName, error: detail });
  }
}

export async function startEmailPoller(intervalMinutes: number = 5): Promise<void> {
  if (emailPollerStarted) {
    logger.info('Email poller is already running; duplicate start ignored');
    return;
  }
  if (!isEmailPollerConfigured()) {
    logger.warn('Email poller not started because Microsoft Graph credentials or mailbox are not configured');
    return;
  }

  const safeIntervalMinutes = Number.isFinite(intervalMinutes)
    ? Math.max(1, intervalMinutes)
    : 5;
  emailPollerStarted = true;
  logger.info(`Starting email poller for ${mailboxAddress} with ${safeIntervalMinutes} minute interval`);
  
  // Initial poll
  await pollAPMailbox();
  
  // Set up recurring poll
  emailPollerTimer = setInterval(async () => {
    await pollAPMailbox();
  }, safeIntervalMinutes * 60 * 1000);
  emailPollerTimer.unref();
}

export function stopEmailPoller(): void {
  if (emailPollerTimer) {
    clearInterval(emailPollerTimer);
    emailPollerTimer = null;
  }
  emailPollerStarted = false;
}

export interface SharePointFileData {
  sharepointUrl: string;
  fileName: string;
  emailSubject: string;
  fromAddress: string;
  toMailbox?: string;
  receivedBy?: string;
  receivedDateTime: string;
}

export async function processSharePointFile(data: SharePointFileData): Promise<{
  success: boolean;
  invoiceNumber?: string;
  invoiceId?: string;
  status?: string;
  exceptions?: string[];
  error?: string;
}> {
  const intakeKey = data.sharepointUrl;
  try {
    logger.info(`Processing SharePoint file: ${data.fileName} from ${data.sharepointUrl}`);
    await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'RECEIVED', messageId: intakeKey, fileName: data.fileName, metadata: { from: data.fromAddress } });
    await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'ATTACHMENT_DETECTED', messageId: intakeKey, fileName: data.fileName });

    // Filename hints stay advisory; OCR/document classification makes the
    // final payable-versus-review decision after the PDF is retained.
    // Download file from SharePoint
    const client = await getGraphClient();
    
    // Extract file path from SharePoint URL
    // URL format: https://madison88.sharepoint.com/sites/APInvoice/AP-Invoices/vendor/year/month/file.pdf
    const urlParts = data.sharepointUrl.split('/sites/APInvoice/');
    if (urlParts.length < 2) {
      throw new Error('Invalid SharePoint URL format');
    }
    
    const filePath = urlParts[1];
    const downloadUrl = `/sites/${process.env.SHAREPOINT_SITE_ID}/drive/items/${process.env.SHAREPOINT_DRIVE_ID}:/${filePath}:/content`;
    
    // Download file content
    const response = await client.api(downloadUrl).get();
    const buffer = Buffer.from(response, 'binary');
    await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'UPLOADED', messageId: intakeKey, fileName: data.fileName, metadata: { sharepoint_url: data.sharepointUrl } });

    // Upload to VPS Supabase Storage (primary storage)
    let storagePath: string | undefined;
    try {
      const uploadedPath = await uploadToStorage(buffer, data.fileName, 'application/pdf');
      if (uploadedPath) {
        storagePath = uploadedPath;
      }
    } catch (storageError) {
      logger.warn(`Failed to upload SharePoint file to VPS storage for ${data.fileName}:`, storageError);
      const detail = storageError instanceof Error ? storageError.message : String(storageError);
      await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'FAILED', status: 'FAILED', messageId: intakeKey, fileName: data.fileName, error: `Storage upload failed: ${detail}` });
      await alertEmailIntakeFailure({ source: 'Power Automate/SharePoint storage upload', fileName: data.fileName, error: detail });
    }
    if (!storagePath) {
      await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'FAILED', status: 'FAILED', messageId: intakeKey, fileName: data.fileName, error: 'Durable storage upload failed; invoice creation was skipped.', metadata: { storage_required: true, retryable: true, intake_id: intakeKey } });
      return { success: false, status: 'FAILED', error: 'Durable storage upload failed' };
    }

    // Analyze invoice using OCR
    const ocrResult = await analyzeIntakeWithRetry(buffer, 'application/pdf', data.fileName, 'SHAREPOINT', { intakeKey });
    const sharePointFileHash = generateFileHash(buffer);
    const sharePointIdempotencyKey = buildIntakeIdempotencyKey(intakeKey, sharePointFileHash);
    const sharePointControls = await applyIntakeControls(ocrResult, buffer);
    await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'EXTRACTED', messageId: intakeKey, fileName: data.fileName, metadata: { invoice_number: ocrResult.invoice_number, confidence: ocrResult.ocr_confidence_score, idempotency_key: sharePointIdempotencyKey, ...sharePointControls.metadata } });

    const reviewReason = intakeReviewReason(ocrResult, data.fileName, data.emailSubject || '');
    if (reviewReason) {
      await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', messageId: intakeKey, fileName: data.fileName, error: reviewReason, metadata: { invoice_number: ocrResult.invoice_number, invoice_type: ocrResult.invoice_type, storage_path: storagePath, intake_id: intakeKey } });
      await alertEmailIntakeFailure({ source: 'SharePoint invoice intake review required', fileName: data.fileName, error: reviewReason });
      logger.warn(`[SharePoint Intake] ${data.fileName} routed to review: ${reviewReason}`);
      return { success: false, status: 'REVIEW_REQUIRED', error: reviewReason };
    }
    if (sharePointControls.reasons.length > 0) {
      const controlReason = sharePointControls.reasons.join(' ');
      await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', messageId: intakeKey, fileName: data.fileName, error: controlReason, metadata: sharePointControls.metadata });
      await alertEmailIntakeFailure({ source: 'SharePoint invoice intake control', fileName: data.fileName, error: controlReason });
      logger.warn(`[SharePoint Intake] ${data.fileName} routed to review: ${controlReason}`);
      return { success: false, status: 'REVIEW_REQUIRED', error: controlReason };
    }
    const sharePointDuplicate = await checkEmailDuplicate(buffer, undefined, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: Number(ocrResult.total_amount),
      invoiceDate: ocrResult.invoice_date || null,
      currency: ocrResult.currency,
      mpoNumber: ocrResult.mpo_number,
      customerPoNumber: ocrResult.customer_po_number,
      lineItemsSignature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
      documentLayoutFingerprint: ocrResult.document_layout_fingerprint,
    });
    // Keep the incoming PDF as a separate record; duplicate classification is
    // performed after the record is committed.

    // OCR confidence threshold check
    const OCR_CONFIDENCE_THRESHOLD = parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.60');
    const ocrConfidence = ocrResult.ocr_confidence_score ?? 0;
    const isLowConfidence = ocrConfidence < OCR_CONFIDENCE_THRESHOLD;
    if (isLowConfidence) {
      logger.warn(`[SharePoint Intake] Low OCR confidence (${(ocrConfidence * 100).toFixed(1)}%) for ${data.fileName}`);
    }

    // Match vendor read-only; OCR never creates a Vendor Master row.
    let vendorId: string | undefined;
    let vendorMatched = false;
    try {
      const bankInfo = (ocrResult as any).bank_info || {};
      const vendorResult = await matchOrCreateVendor(ocrResult.vendor_name, {
        beneficiary_name: bankInfo.beneficiary_name || (ocrResult as any).beneficiary_name,
        bank_name: bankInfo.bank_name || (ocrResult as any).bank_name,
        swift_code: bankInfo.swift_code || (ocrResult as any).swift_code,
        account_number: bankInfo.account_usd || bankInfo.account_number || (ocrResult as any).account_number,
      });
      vendorId = vendorResult?.vendor_id;
      vendorMatched = Boolean(vendorId);
    } catch (error) {
      logger.warn(`No vendor match found for ${ocrResult.vendor_name}, creating exception`);
      vendorId = undefined;
    }
    if (!vendorMatched) vendorId = (await getUnknownVendorPlaceholder()) || undefined;

    // Determine approval tier from amount
    const tier = determineApprovalTier(ocrResult.total_amount || 0);

    // Generate QB memo: brand_season_ordertype_MPO_approvaldate
    const memoParts = [
      ocrResult.brand_code || ocrResult.brand || '',
      ocrResult.season || '',
      ocrResult.order_type || '',
      ocrResult.mpo_number || '',
    ].filter(Boolean);
    const qbMemo = memoParts.length > 0 ? memoParts.join('_') : undefined;

    // Determine brand_tier from brand or brand_code
    let brand_tier: BrandTier | undefined;
    if (ocrResult.brand_code && TOP_10_BRANDS[ocrResult.brand_code]) {
      brand_tier = BrandTier.TOP_10;
    } else if (ocrResult.brand && isTop10Brand(ocrResult.brand)) {
      brand_tier = BrandTier.TOP_10;
    } else {
      brand_tier = BrandTier.OTHER;
    }

    // Create invoice record
    applyUsdNormalization(ocrResult);
    const invoice = await createInvoiceAndIntakeEvent({
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
        order_type_detail: (ocrResult as any).order_type === 'OTHER' ? (ocrResult as any).order_type_detail : undefined,
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
        priority_pay_date: ocrResult.priority_pay_date ? new Date(ocrResult.priority_pay_date) : null,
        is_duplicate: false,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: { ...ocrResult, attachment_file_hash: sharePointFileHash, intake_idempotency_key: sharePointIdempotencyKey } as any,
        invoice_hash: sharePointFileHash,
        normalized_invoice_number: normalizeInvoiceReference(ocrResult.invoice_number) || undefined,
        line_items_signature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
        beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || undefined,
        bank_name: (ocrResult as any).bank_info?.bank_name || (ocrResult as any).bank_name || undefined,
        swift_code: (ocrResult as any).bank_info?.swift_code || (ocrResult as any).swift_code || undefined,
        account_number: (ocrResult as any).bank_info?.account_usd || (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || (ocrResult as any).bank_account || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorMatched && !isLowConfidence ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: preferExtractedPaymentTerms(ocrResult.payment_terms, await getVendorPaymentTermDefault(vendorId)),
        sharepoint_folder_url: data.sharepointUrl,
        sharepoint_filed_at: new Date(),
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        source_message_id: intakeKey,
        source_attachment_id: sharePointIdempotencyKey,
        source_received_at: new Date(),
      },
      {
        source: 'SHAREPOINT',
        intakeId: sharePointIdempotencyKey,
        messageId: intakeKey,
        attachmentId: sharePointIdempotencyKey,
        fileName: data.fileName,
        metadata: { storage_path: storagePath, invoice_number: ocrResult.invoice_number },
      },
    );

    await flagDuplicateIntake(invoice, sharePointDuplicate, 'SHAREPOINT', data.fileName);

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

    // Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'SHAREPOINT_INTAKE',
        performed_by: 'powerautomate',
        note: `SharePoint intake from ${data.fromAddress}: ${data.fileName}. File URL: ${data.sharepointUrl}`,
      },
    });

    // Create exception if vendor not matched
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

    await attachCurrencyPolicyException(invoice.id, invoice.invoice_number, ocrResult);

    // Create exception if OCR confidence is low
    if (isLowConfidence) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.OCR_LOW_CONFIDENCE as any,
          detail: `OCR confidence ${(ocrConfidence * 100).toFixed(1)}% is below threshold ${(OCR_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%. Manual review of extracted data required.`,
        },
      });
      exceptions.push('OCR_LOW_CONFIDENCE');
    }

    // Auto-trigger validation if invoice was created in RECEIVED status (vendor matched)
    if (vendorMatched && !isLowConfidence && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(
          `Auto-validation completed for ${invoice.invoice_number}: ` +
          `${validationResult.passed ? 'PASSED' : 'FAILED'} ` +
          `(${validationResult.exceptions.length} exceptions)`
        );
        if (!validationResult.passed) {
          exceptions.push(...validationResult.exceptions.map(e => e.reason));
        }
      } catch (validationError) {
        logger.error(`Auto-validation failed for ${invoice.invoice_number}:`, validationError);
      }
    }

    logger.info(`Successfully processed invoice ${invoice.invoice_number} from SharePoint`);

    return {
      success: true,
      invoiceNumber: invoice.invoice_number,
      invoiceId: invoice.id,
      status: invoice.status,
      exceptions: exceptions.length > 0 ? exceptions : undefined,
    };

  } catch (error) {
    logger.error(`Error processing SharePoint file ${data.fileName}:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    await recordEmailIntakeEvent({ source: 'SHAREPOINT', stage: 'FAILED', status: 'FAILED', messageId: intakeKey, fileName: data.fileName, error: detail, metadata: { intake_id: intakeKey, retryable: true } });
    await alertEmailIntakeFailure({ source: 'Power Automate/SharePoint', fileName: data.fileName, error: detail });
    return {
      success: false,
      error: detail,
    };
  }
}

export interface PowerAutomateAttachment {
  attachmentBase64: string;
  fileName: string;
  contentType: string;
  emailSubject: string;
  fromAddress: string;
  toMailbox?: string;
  receivedBy?: string;
  receivedDateTime: string;
  /** Set only by the recovery worker so the original attachment keeps its ID. */
  intakeId?: string;
  /** Existing durable object to reuse during recovery; avoids a second upload. */
  storagePath?: string;
  attachmentId?: string;
}

/** Canonical provenance fields persisted for every Power Automate invoice intake. */
function emailProvenance(data: {
  fromAddress?: string;
  toMailbox?: string;
  receivedBy?: string;
  receivedDateTime?: string;
}) {
  const toMailbox = String(data.toMailbox || '').trim();
  return {
    fromAddress: String(data.fromAddress || '').trim(),
    toMailbox,
    receivedBy: String(data.receivedBy || toMailbox || '').trim(),
    receivedDateTime: String(data.receivedDateTime || '').trim(),
  };
}

export async function processPowerAutomateAttachment(data: PowerAutomateAttachment): Promise<{
  success: boolean;
  invoiceNumber?: string;
  invoiceId?: string;
  status?: string;
  exceptions?: string[];
  error?: string;
}> {
  const provenance = emailProvenance(data);
  // The initial key is used for the receive event; once the payload is
  // decoded, all processing events use a content-addressed intake ID so a
  // repeated filename can never satisfy another attachment's completion.
  const receiveKey = data.intakeId || `${data.fromAddress}|${data.receivedDateTime}|${data.fileName}`;
  let intakeKey = data.intakeId || receiveKey;
  // Keep this outside the try block so a later OCR/database failure can be
  // retried from the durable object instead of losing the PDF reference.
  let storagePath: string | undefined = data.storagePath;
  try {
    logger.info(`Processing Power Automate attachment: ${data.fileName} from ${data.fromAddress}`);
    await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'RECEIVED', messageId: receiveKey, fileName: data.fileName, metadata: { ...provenance, subject: data.emailSubject } });
    await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'ATTACHMENT_DETECTED', messageId: receiveKey, fileName: data.fileName });

    // Filename hints stay advisory so invoice-like attachments are never
    // discarded before OCR/classification.
    // Convert base64 to buffer
    const buffer = Buffer.from(data.attachmentBase64, 'base64');
    intakeKey = data.intakeId || buildIntakeIdempotencyKey(receiveKey, generateFileHash(buffer));

    // Upload to VPS Supabase Storage FIRST (before OCR — ensures file is saved even if OCR fails)
    try {
      if (storagePath) {
        logger.info(`[Power Automate] Reusing durable storage object for recovery: ${storagePath}`);
      } else {
        const uploadedPath = await uploadToStorage(buffer, data.fileName, data.contentType || 'application/pdf');
        if (uploadedPath) {
          storagePath = uploadedPath;
          logger.info(`[Power Automate] Invoice uploaded to VPS storage: ${storagePath}`);
        }
      }
      if (storagePath) {
        await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'UPLOADED', messageId: intakeKey, attachmentId: data.attachmentId, fileName: data.fileName, metadata: { storage_path: storagePath, intake_id: intakeKey, ...provenance, subject: data.emailSubject, content_type: data.contentType } });
      }
    } catch (storageError) {
      logger.warn(`Failed to upload invoice to VPS storage for ${data.fileName}:`, storageError);
      const detail = storageError instanceof Error ? storageError.message : String(storageError);
      await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'FAILED', status: 'FAILED', messageId: intakeKey, fileName: data.fileName, error: `Storage upload failed: ${detail}` });
      await alertEmailIntakeFailure({ source: 'Power Automate storage upload', fileName: data.fileName, error: detail });
    }
    if (!storagePath) {
      const recoveryReason = 'Durable storage upload failed; the original source PDF is required before this intake can be reprocessed.';
      await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'RECOVERY_REQUIRED', status: 'REVIEW_REQUIRED', messageId: intakeKey, fileName: data.fileName, error: recoveryReason, metadata: { storage_required: true, retryable: false, source_recovery_required: true, intake_id: intakeKey } });
      await recordIntakeRecoveryCase({
        intakeId: intakeKey,
        source: 'POWER_AUTOMATE',
        messageId: intakeKey,
        attachmentId: data.attachmentId,
        fileName: data.fileName,
        reason: recoveryReason,
        metadata: { ...provenance, subject: data.emailSubject, content_type: data.contentType },
      });
      return { success: false, status: 'REVIEW_REQUIRED', error: recoveryReason };
    }

    // Analyze invoice using OCR
    const ocrResult = await analyzeIntakeWithRetry(buffer, data.contentType, data.fileName, 'POWER_AUTOMATE', { intakeKey });
    const powerAutomateFileHash = generateFileHash(buffer);
    const powerAutomateIdempotencyKey = buildIntakeIdempotencyKey(intakeKey, powerAutomateFileHash);
    const powerAutomateControls = await applyIntakeControls(ocrResult, buffer);
    await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'EXTRACTED', messageId: intakeKey, fileName: data.fileName, metadata: { ...provenance, invoice_number: ocrResult.invoice_number, confidence: ocrResult.ocr_confidence_score, idempotency_key: powerAutomateIdempotencyKey, ...powerAutomateControls.metadata } });

    const reviewReason = intakeReviewReason(ocrResult, data.fileName, data.emailSubject || '');
    if (reviewReason) {
      await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', messageId: intakeKey, fileName: data.fileName, error: reviewReason, metadata: { ...provenance, invoice_number: ocrResult.invoice_number, invoice_type: ocrResult.invoice_type, storage_path: storagePath, intake_id: intakeKey } });
      await alertEmailIntakeFailure({ source: 'Power Automate invoice intake review required', fileName: data.fileName, error: reviewReason });
      logger.warn(`[Power Automate] ${data.fileName} routed to review: ${reviewReason}`);
      return { success: false, status: 'REVIEW_REQUIRED', error: reviewReason };
    }
    if (powerAutomateControls.reasons.length > 0) {
      const controlReason = powerAutomateControls.reasons.join(' ');
      await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', messageId: intakeKey, fileName: data.fileName, error: controlReason, metadata: { ...provenance, ...powerAutomateControls.metadata } });
      await alertEmailIntakeFailure({ source: 'Power Automate invoice intake control', fileName: data.fileName, error: controlReason });
      logger.warn(`[Power Automate] ${data.fileName} routed to review: ${controlReason}`);
      return { success: false, status: 'REVIEW_REQUIRED', error: controlReason };
    }
    const powerAutomateDuplicate = await checkEmailDuplicate(buffer, undefined, {
      vendorName: ocrResult.vendor_name,
      invoiceNumber: ocrResult.invoice_number,
      amount: Number(ocrResult.total_amount),
      invoiceDate: ocrResult.invoice_date || null,
      currency: ocrResult.currency,
      mpoNumber: ocrResult.mpo_number,
      customerPoNumber: ocrResult.customer_po_number,
      lineItemsSignature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
      documentLayoutFingerprint: ocrResult.document_layout_fingerprint,
    });
    // Keep the incoming PDF as a separate record; duplicate classification is
    // performed after the record is committed.

    // OCR confidence threshold check
    const OCR_CONFIDENCE_THRESHOLD = parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.60');
    const ocrConfidence = ocrResult.ocr_confidence_score ?? 0;
    const isLowConfidence = ocrConfidence < OCR_CONFIDENCE_THRESHOLD;
    if (isLowConfidence) {
      logger.warn(`[Power Automate] Low OCR confidence (${(ocrConfidence * 100).toFixed(1)}%) for ${data.fileName}`);
    }

    // Match vendor read-only; OCR never creates a Vendor Master row.
    let vendorId: string | undefined;
    let vendorMatched = false;
    try {
      const bankInfo = (ocrResult as any).bank_info || {};
      const vendorResult = await matchOrCreateVendor(ocrResult.vendor_name, {
        beneficiary_name: bankInfo.beneficiary_name || (ocrResult as any).beneficiary_name,
        bank_name: bankInfo.bank_name || (ocrResult as any).bank_name,
        swift_code: bankInfo.swift_code || (ocrResult as any).swift_code,
        account_number: bankInfo.account_usd || bankInfo.account_number || (ocrResult as any).account_number,
      });
      vendorId = vendorResult?.vendor_id;
      vendorMatched = Boolean(vendorId);
    } catch (error) {
      logger.warn(`No vendor match found for ${ocrResult.vendor_name}, creating exception`);
      vendorId = undefined;
    }
    if (!vendorMatched) vendorId = (await getUnknownVendorPlaceholder()) || undefined;

    // Determine approval tier from amount
    const tier = determineApprovalTier(ocrResult.total_amount || 0);

    // Generate QB memo: brand_season_ordertype_MPO_approvaldate
    const memoParts = [
      ocrResult.brand_code || ocrResult.brand || '',
      ocrResult.season || '',
      ocrResult.order_type || '',
      ocrResult.mpo_number || '',
    ].filter(Boolean);
    const qbMemo = memoParts.length > 0 ? memoParts.join('_') : undefined;

    // Upload to structured SharePoint folder (secondary, if configured)
    let sharepointUrl: string | undefined;
    if (vendorMatched) {
      try {
        const uploadResult = await uploadInvoiceToStructuredFolder(
          ocrResult.vendor_name,
          ocrResult.invoice_number,
          ocrResult.invoice_date || new Date(),
          buffer,
          data.fileName
        );
        if (uploadResult.success && uploadResult.webUrl) {
          sharepointUrl = uploadResult.webUrl;
        }
      } catch (uploadError) {
        logger.warn(`Failed to upload invoice to SharePoint for ${ocrResult.invoice_number}:`, uploadError);
      }
    }

    // Determine brand_tier from brand or brand_code
    let brand_tier: BrandTier | undefined;
    if (ocrResult.brand_code && TOP_10_BRANDS[ocrResult.brand_code]) {
      brand_tier = BrandTier.TOP_10;
    } else if (ocrResult.brand && isTop10Brand(ocrResult.brand)) {
      brand_tier = BrandTier.TOP_10;
    } else {
      brand_tier = BrandTier.OTHER;
    }

    // Create invoice record
    applyUsdNormalization(ocrResult);
    const invoice = await createInvoiceAndIntakeEvent({
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
        order_type_detail: (ocrResult as any).order_type === 'OTHER' ? (ocrResult as any).order_type_detail : undefined,
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
        priority_pay_date: ocrResult.priority_pay_date ? new Date(ocrResult.priority_pay_date) : null,
        is_duplicate: false,
        ocr_confidence_score: ocrResult.ocr_confidence_score || undefined,
        ocr_raw_data: {
          ...ocrResult,
          attachment_file_hash: powerAutomateFileHash,
          intake_idempotency_key: powerAutomateIdempotencyKey,
          intake_id: intakeKey,
          email_from_address: provenance.fromAddress || undefined,
          email_to_mailbox: provenance.toMailbox || undefined,
          email_received_by: provenance.receivedBy || undefined,
          email_received_date_time: provenance.receivedDateTime || undefined,
          email_sender: data.fromAddress || undefined,
          email_subject: data.emailSubject || undefined,
          email_received_date: data.receivedDateTime || undefined,
          email_attachment_name: data.fileName,
        } as any,
        invoice_hash: powerAutomateFileHash,
        normalized_invoice_number: normalizeInvoiceReference(ocrResult.invoice_number) || undefined,
        line_items_signature: Array.isArray((ocrResult as any).line_items) ? JSON.stringify((ocrResult as any).line_items) : undefined,
        beneficiary_name: (ocrResult as any).bank_info?.beneficiary_name || (ocrResult as any).beneficiary_name || undefined,
        bank_name: (ocrResult as any).bank_info?.bank_name || (ocrResult as any).bank_name || undefined,
        swift_code: (ocrResult as any).bank_info?.swift_code || (ocrResult as any).swift_code || undefined,
        account_number: (ocrResult as any).bank_info?.account_usd || (ocrResult as any).bank_info?.account_number || (ocrResult as any).account_number || (ocrResult as any).bank_account || undefined,
        qb_memo: qbMemo,
        qb_account_class: ocrResult.qb_account_class,
        status: (vendorMatched && !isLowConfidence ? InvoiceStatus.RECEIVED : InvoiceStatus.EXCEPTION_FLAGGED) as any,
        source: InvoiceSource.EMAIL as any,
        approval_tier: tier,
        payment_terms: preferExtractedPaymentTerms(ocrResult.payment_terms, await getVendorPaymentTermDefault(vendorId)),
        sharepoint_folder_url: sharepointUrl,
        sharepoint_filed_at: sharepointUrl ? new Date() : null,
        pdf_path: storagePath || undefined,
        raw_file_url: storagePath || undefined,
        source_message_id: intakeKey,
        source_attachment_id: powerAutomateIdempotencyKey,
        source_received_at: new Date(),
      },
      {
        source: 'POWER_AUTOMATE',
        intakeId: intakeKey,
        messageId: intakeKey,
        attachmentId: data.attachmentId || powerAutomateIdempotencyKey,
        fileName: data.fileName,
        metadata: {
          ...provenance,
          storage_path: storagePath,
          invoice_number: ocrResult.invoice_number,
          email_subject: data.emailSubject,
          from: data.fromAddress,
        },
      },
    );

    await flagDuplicateIntake(invoice, powerAutomateDuplicate, 'POWER_AUTOMATE', data.fileName);

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

    // Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invoice.id,
        action: 'POWER_AUTOMATE_INTAKE',
        performed_by: 'powerautomate',
        note: `Power Automate intake from ${provenance.fromAddress || '(unknown sender)'} to ${provenance.toMailbox || '(unknown mailbox)'} received by ${provenance.receivedBy || '(unknown recipient)'} at ${provenance.receivedDateTime || '(unknown time)'}: ${data.fileName}${sharepointUrl ? `. Uploaded to SharePoint: ${sharepointUrl}` : ''}`,
        metadata: {
          source: 'POWER_AUTOMATE',
          fileName: data.fileName,
          emailSubject: data.emailSubject || null,
          ...provenance,
        },
      },
    });

    // Create exception if vendor not matched
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

    await attachCurrencyPolicyException(invoice.id, invoice.invoice_number, ocrResult);

    // Create exception if OCR confidence is low
    if (isLowConfidence) {
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: ExceptionReason.OCR_LOW_CONFIDENCE as any,
          detail: `OCR confidence ${(ocrConfidence * 100).toFixed(1)}% is below threshold ${(OCR_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%. Manual review of extracted data required.`,
        },
      });
      exceptions.push('OCR_LOW_CONFIDENCE');
    }

    // Auto-trigger validation if invoice was created in RECEIVED status (vendor matched)
    if (vendorMatched && !isLowConfidence && invoice.status === InvoiceStatus.RECEIVED as any) {
      try {
        const validationResult = await validateInvoice(invoice.id);
        logger.info(
          `Auto-validation completed for ${invoice.invoice_number}: ` +
          `${validationResult.passed ? 'PASSED' : 'FAILED'} ` +
          `(${validationResult.exceptions.length} exceptions)`
        );
        if (!validationResult.passed) {
          exceptions.push(...validationResult.exceptions.map(e => e.reason));
        }
      } catch (validationError) {
        logger.error(`Auto-validation failed for ${invoice.invoice_number}:`, validationError);
      }
    }

    logger.info(`Successfully processed invoice ${invoice.invoice_number} from Power Automate`);

    return {
      success: true,
      invoiceNumber: invoice.invoice_number,
      invoiceId: invoice.id,
      status: invoice.status,
      exceptions: exceptions.length > 0 ? exceptions : undefined,
    };

  } catch (error) {
    logger.error(`Error processing Power Automate attachment ${data.fileName}:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    await recordEmailIntakeEvent({
      source: 'POWER_AUTOMATE',
      stage: 'FAILED',
      status: 'FAILED',
      messageId: intakeKey,
      fileName: data.fileName,
      error: detail,
      metadata: { intake_id: intakeKey, storage_path: storagePath, retryable: true },
    });
    await alertEmailIntakeFailure({ source: 'Power Automate', fileName: data.fileName, error: detail });
    return {
      success: false,
      error: detail,
    };
  }
}

/**
 * Reprocess durable Power Automate uploads that never reached a terminal
 * outcome. This is intentionally idempotent: the same intake_id is reused and
 * a terminal event (CREATED, REVIEW_REQUIRED, PDF_REPLACED, or DUPLICATE)
 * prevents another attempt. A bounded retry queue keeps provider/database
 * outages from creating an infinite loop.
 */
export async function recoverOrphanedEmailIntakes(limit = 100): Promise<{ scanned: number; retried: number; completed: number }> {
  if (!isDbEnabled()) return { scanned: 0, retried: 0, completed: 0 };

  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  const candidates = await prisma.emailIntakeEvent.findMany({
    where: { source: 'POWER_AUTOMATE', stage: 'UPLOADED', created_at: { lt: cutoff } },
    orderBy: { created_at: 'asc' },
    take: Math.min(250, Math.max(1, limit)),
  });
  let retried = 0;
  let completed = 0;
  const terminalStages = ['CREATED', 'REVIEW_REQUIRED', 'PDF_REPLACED', 'DUPLICATE', 'SPLIT_COMPLETED'];

  for (const event of candidates) {
    const intakeId = (event as any).intake_id || event.message_id;
    if (!intakeId) continue;
    const terminal = await (prisma.emailIntakeEvent as any).findFirst({
      where: { intake_id: intakeId, stage: { in: terminalStages } },
      orderBy: { created_at: 'desc' },
    });
    if (terminal) {
      completed += 1;
      continue;
    }
    const retries = await (prisma.emailIntakeEvent as any).count({ where: { intake_id: intakeId, stage: 'RETRY_QUEUED' } });
    if (retries >= 3) continue;
    const metadata = (event.metadata && typeof event.metadata === 'object' ? event.metadata : {}) as Record<string, any>;
    const storagePath = typeof metadata.storage_path === 'string' ? metadata.storage_path : undefined;
    if (!storagePath) {
      const recoveryReason = 'Historical upload has no durable storage_path. Re-supply the original PDF to recover this intake.';
      await recordEmailIntakeEvent({
        source: 'POWER_AUTOMATE', stage: 'RECOVERY_REQUIRED', status: 'REVIEW_REQUIRED',
        messageId: intakeId, attachmentId: event.attachment_id || undefined, fileName: event.file_name || undefined,
        error: recoveryReason,
        metadata: { intake_id: intakeId, retryable: false, recovery: true, source_recovery_required: true },
      });
      await recordIntakeRecoveryCase({
        intakeId,
        source: 'POWER_AUTOMATE',
        messageId: event.message_id || intakeId,
        attachmentId: event.attachment_id || undefined,
        fileName: event.file_name || `${intakeId}.pdf`,
        reason: recoveryReason,
        metadata,
      });
      continue;
    }
    const buffer = await downloadFromStorage(storagePath);
    if (!buffer) {
      await recordEmailIntakeEvent({
        source: 'POWER_AUTOMATE', stage: 'RETRY_QUEUED', status: 'FAILED',
        messageId: intakeId, attachmentId: event.attachment_id || undefined, fileName: event.file_name || undefined,
        error: 'Durable PDF could not be downloaded for recovery.',
        metadata: { intake_id: intakeId, storage_path: storagePath, recovery_attempt: retries + 1, retryable: true },
      });
      continue;
    }
    await recordEmailIntakeEvent({
      source: 'POWER_AUTOMATE', stage: 'RETRY_QUEUED', status: 'SUCCESS',
      messageId: intakeId, attachmentId: event.attachment_id || undefined, fileName: event.file_name || undefined,
      metadata: { intake_id: intakeId, storage_path: storagePath, recovery_attempt: retries + 1 },
    });
    retried += 1;
    const result = await processPowerAutomateAttachment({
      attachmentBase64: buffer.toString('base64'),
      fileName: event.file_name || `${intakeId}.pdf`,
      contentType: metadata.content_type || 'application/pdf',
      emailSubject: metadata.subject || '',
      fromAddress: metadata.from || '',
      receivedDateTime: metadata.received_date_time || event.created_at.toISOString(),
      intakeId,
      storagePath,
      attachmentId: event.attachment_id || undefined,
    });
    if (result.success || result.status === 'REVIEW_REQUIRED' || result.status === 'DUPLICATE' || result.status === 'PDF_REPLACED') {
      completed += 1;
    }
  }
  return { scanned: candidates.length, retried, completed };
}

/**
 * Recovery path for legacy Power Automate events that never stored a PDF.
 * The operator supplies the original attachment; the same stable intake ID is
 * reused so a recovered file cannot create a second payable record.
 */
export async function recoverHistoricalIntakeFromSource(input: {
  intakeId: string;
  buffer: Buffer;
  fileName: string;
  contentType?: string;
  emailSubject?: string;
  fromAddress?: string;
  toMailbox?: string;
  receivedBy?: string;
  receivedDateTime?: string;
}) {
  const recoveryRows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "APInvoice_IntakeRecoveryCase" WHERE intake_id = $1 LIMIT 1`, input.intakeId);
  const recoveryCase = recoveryRows[0];
  if (!recoveryCase) throw new AppError('Recovery case not found.', 404);
  if (recoveryCase.status === 'RECOVERED') return { success: true, status: 'RECOVERED', invoiceId: recoveryCase.recovered_invoice_id };

  const attempt = Number(recoveryCase.attempts || 0) + 1;
  await prisma.$executeRawUnsafe(`UPDATE "APInvoice_IntakeRecoveryCase" SET status='RETRY_QUEUED', attempts=$2, last_error=NULL, updated_at=NOW() WHERE intake_id=$1`, input.intakeId, attempt);
  await recordEmailIntakeEvent({
    source: 'POWER_AUTOMATE',
    stage: 'RETRY_QUEUED',
    status: 'SUCCESS',
    messageId: input.intakeId,
    fileName: input.fileName,
    metadata: { intake_id: input.intakeId, recovery_attempt: attempt, source_reupload: true, fromAddress: input.fromAddress || '', toMailbox: input.toMailbox || '', receivedBy: input.receivedBy || '', receivedDateTime: input.receivedDateTime || '' },
  });

  const result = await processPowerAutomateAttachment({
    attachmentBase64: input.buffer.toString('base64'),
    fileName: input.fileName,
    contentType: input.contentType || 'application/pdf',
    emailSubject: input.emailSubject || recoveryCase.metadata?.subject || '',
    fromAddress: input.fromAddress || recoveryCase.metadata?.from || '',
    toMailbox: input.toMailbox || recoveryCase.metadata?.toMailbox || '',
    receivedBy: input.receivedBy || recoveryCase.metadata?.receivedBy || '',
    receivedDateTime: input.receivedDateTime || new Date().toISOString(),
    intakeId: input.intakeId,
    attachmentId: recoveryCase.attachment_id || undefined,
  });

  const nextStatus = result.success ? 'RECOVERED'
    : ['REVIEW_REQUIRED', 'DUPLICATE', 'PDF_REPLACED'].includes(String(result.status || '')) ? 'RECOVERED_REVIEW'
      : 'RETRYABLE_FAILURE';
  await prisma.$executeRawUnsafe(`UPDATE "APInvoice_IntakeRecoveryCase" SET status=$2, recovered_invoice_id=$3, last_error=$4, updated_at=NOW() WHERE intake_id=$1`, input.intakeId, nextStatus, result.invoiceId || null, result.error || null);
  return result;
}
