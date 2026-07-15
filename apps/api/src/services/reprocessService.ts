import prisma from '../config/database';
import { InvoiceStatus, ExceptionReason, ExceptionStatus } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { validateInvoice } from './validationService';
import { createApprovalRequest } from './approvalService';
import { logger } from '../utils/logger';
import { getGraphClient } from './sharePointService';
import { extractMadisonInvoiceFields, AST_SINGLE_SOURCE_MODE } from './madisonInvoiceExtractor';
import { analyzeInvoice } from './ocrService';
import { matchVendor } from './vendorMatchingService';
import { fieldDecisionEngine } from './fieldDecisionEngine';
import { geminiOCRService } from './geminiOCRService';
import { qwenOCRService } from './qwenOCRService';
import { groqOCRService } from './groqOCRService';
import { ollamaOCRService } from './ollamaOCRService';

/**
 * Reprocess an invoice: cancel its current payment, reset status, re-validate,
 * and regenerate approval request.
 *
 * Allowed from: PAYMENT_SCHEDULED, POSTED_TO_QB, PAID (if payment needs to be voided)
 * Not allowed from: PAYMENT_CONFIRMATION_SENT (final state — too late to reprocess)
 */
export async function reprocessInvoice(
  invoiceId: string,
  userId: string,
  reason: string
): Promise<{ invoice_id: string; old_status: string; new_status: string; message: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: true,
      signatures: true,
      exceptions: true,
      vendor: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Check allowed statuses for reprocessing
  const allowedStatuses = [
    InvoiceStatus.POSTED_TO_QB,
    InvoiceStatus.PAYMENT_SCHEDULED,
    InvoiceStatus.PAID,
    InvoiceStatus.ON_HOLD,
    InvoiceStatus.PENDING_ACCOUNTING,
  ];

  if (!allowedStatuses.includes(invoice.status as InvoiceStatus)) {
    throw new AppError(
      `Invoice in status ${invoice.status} cannot be reprocessed. Allowed statuses: ${allowedStatuses.join(', ')}`,
      400
    );
  }

  const oldStatus = invoice.status;

  // 1. Cancel/void any linked payments
  if (invoice.payments.length > 0) {
    for (const payment of invoice.payments as any[]) {
      if (payment.status === 'SCHEDULED' || payment.status === 'PAID') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'CANCELLED',
            reference: payment.reference ? `${payment.reference} (VOIDED - reprocess)` : 'VOIDED - reprocess',
          },
        });
      }
    }
  }

  // 2. Delete existing signatures (will be recreated during approval)
  await prisma.signature.deleteMany({
    where: { invoice_id: invoiceId },
  });

  // 3. Delete PENDING exceptions (keep RESOLVED/WAIVED for history)
  await prisma.exception.deleteMany({
    where: {
      invoice_id: invoiceId,
      status: 'PENDING' as any,
    },
  });

  // 4. Close any open stage timestamps
  const openStages = await prisma.stageTimestamp.findMany({
    where: { invoice_id: invoiceId, exited_at: null },
  });
  for (const stage of openStages) {
    await prisma.stageTimestamp.update({
      where: { id: stage.id },
      data: {
        exited_at: new Date(),
        is_breached: false,
      },
    });
  }

  // 5. Reset invoice to VALIDATION_PENDING
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.VALIDATION_PENDING as any,
      qb_posted_at: null,
    },
  });

  // 6. Audit log the reprocessing action
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'INVOICE_REPROCESSED',
      performed_by: userId,
      note: `Invoice reprocessed by user. Previous status: ${oldStatus}. Reason: ${reason}. Payments voided: ${invoice.payments.length}. Signatures reset.`,
    },
  });

  logger.info(`Invoice ${invoice.invoice_number} reprocessed by ${userId}. Old status: ${oldStatus}`);

  // 7. Re-run validation (which will auto-create approval request if it passes)
  try {
    const validationResult = await validateInvoice(invoiceId);

    if (validationResult.passed) {
      // Check batch threshold before creating approval
      const { checkBatchThreshold } = require('./validationService');
      const batchResult = await checkBatchThreshold(invoiceId);

      if (!batchResult.held) {
        // Approval request is auto-created inside validateInvoice when validation passes
        // But if it was from an exception resolution path, we need to create it explicitly
        const existingSignatures = await prisma.signature.findMany({
          where: { invoice_id: invoiceId },
        });
        if (existingSignatures.length === 0) {
          await createApprovalRequest(invoiceId, userId, { fromExceptionResolution: true });
        }
      }

      return {
        invoice_id: invoiceId,
        old_status: oldStatus as string,
        new_status: 'VALIDATION_PENDING (validation passed, approval request created)',
        message: `Invoice reprocessed successfully. Validation passed. ${batchResult.held ? 'Held for batch threshold.' : 'Approval request created.'}`,
      };
    } else {
      return {
        invoice_id: invoiceId,
        old_status: oldStatus as string,
        new_status: 'EXCEPTION_FLAGGED',
        message: `Invoice reprocessed. Validation flagged ${validationResult.exceptions.length} exception(s).`,
      };
    }
  } catch (error) {
    logger.error(`Reprocessing validation failed for invoice ${invoiceId}:`, error);
    return {
      invoice_id: invoiceId,
      old_status: oldStatus as string,
      new_status: 'VALIDATION_PENDING (validation error — manual review needed)',
      message: `Invoice reset to VALIDATION_PENDING but validation encountered an error: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
}

/**
 * Bulk reprocess multiple invoices.
 */
export async function reprocessInvoices(
  invoiceIds: string[],
  userId: string,
  reason: string
): Promise<{
  summary: { total: number; success: number; failed: number };
  results: Array<{ invoice_id: string; status: 'success' | 'error'; message?: string }>;
}> {
  const results: Array<{ invoice_id: string; status: 'success' | 'error'; message?: string }> = [];

  for (const invoiceId of invoiceIds) {
    try {
      const result = await reprocessInvoice(invoiceId, userId, reason);
      results.push({ invoice_id: invoiceId, status: 'success', message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ invoice_id: invoiceId, status: 'error', message });
    }
  }

  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;

  return {
    summary: { total: invoiceIds.length, success, failed },
    results,
  };
}

/**
 * Download the original PDF for an invoice from SharePoint.
 */
async function downloadInvoicePdf(invoice: any): Promise<Buffer> {
  const sharepointUrl = invoice.sharepoint_folder_url || invoice.raw_file_url;
  if (!sharepointUrl) {
    throw new AppError('No SharePoint URL or raw file URL found for this invoice — cannot re-download PDF', 400);
  }

  // Extract file path from SharePoint URL
  // URL format: https://madison88.sharepoint.com/sites/APInvoice/AP-Invoices/vendor/year/month/file.pdf
  const urlParts = sharepointUrl.split('/sites/APInvoice/');
  if (urlParts.length < 2) {
    // Try raw_file_url as a direct path
    const client = await getGraphClient();
    const downloadUrl = `/sites/${process.env.SHAREPOINT_SITE_ID}/drive/items/${process.env.SHAREPOINT_DRIVE_ID}:/${sharepointUrl}:/content`;
    const response = await client.api(downloadUrl).get();
    return Buffer.isBuffer(response) ? response : Buffer.from(response, 'binary');
  }

  const filePath = urlParts[1];
  const client = await getGraphClient();
  const downloadUrl = `/sites/${process.env.SHAREPOINT_SITE_ID}/drive/items/${process.env.SHAREPOINT_DRIVE_ID}:/${filePath}:/content`;
  const response = await client.api(downloadUrl).get();
  return Buffer.isBuffer(response) ? response : Buffer.from(response, 'binary');
}

/**
 * Re-extract an invoice: download the original PDF, re-run the full extraction pipeline
 * (Madison extractor + AI engines + field decision engine), update the invoice with
 * new extracted data, then re-run validation.
 *
 * Allowed from any status except PAYMENT_CONFIRMATION_SENT.
 */
export async function reExtractInvoice(
  invoiceId: string,
  userId: string
): Promise<{ invoice_id: string; invoice_number: string; old_values: Record<string, any>; new_values: Record<string, any>; message: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true, signatures: true, exceptions: true },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  if (invoice.status === 'PAYMENT_CONFIRMATION_SENT') {
    throw new AppError('Cannot re-extract invoice in PAYMENT_CONFIRMATION_SENT status', 400);
  }

  // 1. Download the original PDF
  logger.info(`[ReExtract] Downloading PDF for invoice ${invoice.invoice_number}...`);
  let fileBuffer: Buffer;
  try {
    fileBuffer = await downloadInvoicePdf(invoice);
    logger.info(`[ReExtract] Downloaded PDF: ${fileBuffer.length} bytes`);
  } catch (downloadError) {
    logger.error(`[ReExtract] Failed to download PDF:`, downloadError);
    throw new AppError(
      `Failed to download original PDF: ${downloadError instanceof Error ? downloadError.message : 'unknown error'}. Ensure SharePoint credentials are configured and the file still exists.`,
      400
    );
  }

  // 2. Run AI-first extraction (analyzeInvoice — tries Gemini/Ollama/Groq first, regex cross-validates)
  logger.info(`[ReExtract] Running AI-first extraction (analyzeInvoice) for ${invoice.invoice_number}...`);
  const ocrResult = await analyzeInvoice(fileBuffer, 'application/pdf');

  logger.info(`[ReExtract] AI-first extraction completed — vendor: "${ocrResult.vendor_name}", invoice#: "${ocrResult.invoice_number}", amount: ${ocrResult.total_amount}, confidence: ${ocrResult.ocr_confidence_score}`);

  // 3. Also run Madison extractor for vendor-specific rules and PO parsing
  const madisonResult = await extractMadisonInvoiceFields(fileBuffer);

  // 4. Build decision engines list for field decision engine
  const extractionContext = {
    vendorName: ocrResult.vendor_name || madisonResult.vendor_name || undefined,
  };

  let geminiResult: any = null;
  let qwenResult: any = null;
  let groqResult: any = null;
  let ollamaResult: any = null;

  const parallelEngines: Promise<any>[] = [];

  if (geminiOCRService.isAvailable()) {
    parallelEngines.push(
      geminiOCRService.extractFromText(madisonResult.raw_text || '', extractionContext)
        .then(r => { if (r) geminiResult = r; return r; })
        .catch(e => { console.error('[ReExtract] Gemini error:', e); return null; })
    );
  }
  if (qwenOCRService.isAvailable()) {
    parallelEngines.push(
      qwenOCRService.extractFromText(madisonResult.raw_text || '', extractionContext)
        .then(r => { if (r) qwenResult = r; return r; })
        .catch(e => { console.error('[ReExtract] Qwen error:', e); return null; })
    );
  }
  if (parallelEngines.length > 0) {
    await Promise.all(parallelEngines);
  }
  if (!geminiResult && !qwenResult) {
    if (groqOCRService.isAvailable()) {
      groqResult = await groqOCRService.extractFromText(madisonResult.raw_text || '', extractionContext)
        .catch(e => { console.error('[ReExtract] Groq error:', e); return null; });
    }
    if (!groqResult && ollamaOCRService.isAvailable()) {
      ollamaResult = await ollamaOCRService.extractFromText(madisonResult.raw_text || '', extractionContext)
        .catch(e => { console.error('[ReExtract] Ollama error:', e); return null; });
    }
  }

  // 5. Field Decision Engine — include AI-first result as highest priority engine
  const decisionEngines: Array<{ engine_name: any; data: Record<string, any>; confidence: number }> = [
    {
      engine_name: 'ai-first',
      data: {
        vendor_name: ocrResult.vendor_name,
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date ? new Date(ocrResult.invoice_date).toISOString().split('T')[0] : '',
        due_date: ocrResult.due_date ? new Date(ocrResult.due_date).toISOString().split('T')[0] : null,
        payment_terms: ocrResult.payment_terms,
        total_amount: ocrResult.total_amount,
        currency: ocrResult.currency,
        po_number: ocrResult.customer_po_number,
        mpo_number: ocrResult.mpo_number,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        season: ocrResult.season,
        qty_shipped: ocrResult.qty_shipped,
        ship_to: ocrResult.ship_to,
        sold_to: ocrResult.sold_to,
        line_items: ocrResult.line_items,
        bank_name: ocrResult.bank_info?.bank_name,
        swift_code: ocrResult.bank_info?.swift_code,
        account_number: ocrResult.bank_info?.account_usd,
        signatures: ocrResult.signatures,
        subtotal: ocrResult.subtotal,
        bank_charges: ocrResult.bank_charges,
        freight_charges: ocrResult.freight_charges,
        courier_charges: ocrResult.courier_charges,
        handling_fee: ocrResult.handling_fee,
        tt_charge: ocrResult.tt_charge,
        tax_amount: ocrResult.tax_amount,
        discount_amount: ocrResult.discount_amount,
        setup_charge: ocrResult.setup_charge,
        sample_charge: ocrResult.sample_charge,
        min_order_charge: ocrResult.min_order_charge,
        additional_charges: ocrResult.additional_charges,
        incoterm: ocrResult.incoterm,
        invoice_type: ocrResult.invoice_type,
      },
      confidence: Math.round((ocrResult.ocr_confidence_score || 0.75) * 100),
    },
    {
      engine_name: 'madison',
      data: {
        vendor_name: madisonResult.vendor_name,
        invoice_number: madisonResult.invoice_number,
        invoice_date: madisonResult.invoice_date,
        due_date: madisonResult.due_date,
        payment_terms: madisonResult.payment_terms,
        total_amount: madisonResult.amount,
        currency: madisonResult.currency,
        po_number: madisonResult.po_number,
        mpo_number: madisonResult.mpo_number,
        brand: madisonResult.brand,
        brand_code: madisonResult.brand_code,
        season: madisonResult.season,
        ship_to: madisonResult.ship_to,
        sold_to: madisonResult.sold_to,
      },
      confidence: 75,
    },
  ];
  if (geminiResult) decisionEngines.push({ engine_name: 'gemini', data: geminiResult, confidence: geminiResult.confidence || 70 });
  if (qwenResult) decisionEngines.push({ engine_name: 'qwen', data: qwenResult, confidence: qwenResult.confidence || 70 });
  if (groqResult) decisionEngines.push({ engine_name: 'groq', data: groqResult, confidence: groqResult.confidence || 65 });
  if (ollamaResult) decisionEngines.push({ engine_name: 'ollama', data: ollamaResult, confidence: ollamaResult.confidence || 60 });

  let fieldDecision: any = null;
  try {
    fieldDecision = await fieldDecisionEngine.decide(decisionEngines, {
      vendorName: madisonResult.vendor_name || undefined,
      rawText: madisonResult.raw_text || undefined,
    });
  } catch (decisionError) {
    console.error('[ReExtract] FieldDecision error:', decisionError);
  }

  const decisionFinal = fieldDecision?.final || {
    vendor_name: madisonResult.vendor_name || '',
    invoice_number: madisonResult.invoice_number || '',
    invoice_date: madisonResult.invoice_date || '',
    due_date: madisonResult.due_date || null,
    payment_terms: madisonResult.payment_terms || null,
    total_amount: madisonResult.amount || 0,
    currency: madisonResult.currency || 'USD',
    po_number: madisonResult.po_number,
    mpo_number: madisonResult.mpo_number,
    brand: madisonResult.brand,
    brand_code: madisonResult.brand_code,
    season: madisonResult.season,
  };

  // 5. Compute final values (same logic as upload controller)
  const cleanInvoiceNumber = (value: string | null | undefined) =>
    value ? value.replace(/\s*([\-\\/])\s*/g, '$1').trim() : null;
  const cleanPONumber = (value: string | null | undefined) => {
    if (!value) return null;
    const poMatch = value.match(/\bPO(\d{4,6})\b/i);
    if (poMatch) return 'PO' + poMatch[1].padStart(6, '0');
    return value;
  };

  const finalAmount = AST_SINGLE_SOURCE_MODE
    ? (madisonResult.amount ?? decisionFinal.total_amount)
    : (decisionFinal.total_amount ?? madisonResult.amount);
  const finalCurrency = AST_SINGLE_SOURCE_MODE
    ? (madisonResult.currency ?? decisionFinal.currency)
    : decisionFinal.currency;

  // 6. Capture old values for comparison
  const oldValues: Record<string, any> = {
    vendor_name_raw: invoice.vendor_name_raw,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    total_amount: Number(invoice.total_amount),
    currency: invoice.currency,
    mpo_number: invoice.mpo_number,
    brand: invoice.brand,
    brand_code: invoice.brand_code,
    season: invoice.season,
    payment_terms: invoice.payment_terms,
    bank_charges: Number(invoice.bank_charges || 0),
    freight_charges: Number(invoice.freight_charges || 0),
    additional_charges: Number(invoice.additional_charges || 0),
    discount_amount: Number(invoice.discount_amount || 0),
    invoice_type: invoice.invoice_type,
  };

  // 7. Build update data — only update fields that have new values
  const updateData: Record<string, any> = {};

  if (decisionFinal.vendor_name && decisionFinal.vendor_name !== oldValues.vendor_name_raw) {
    updateData.vendor_name_raw = decisionFinal.vendor_name;
  }
  const newInvoiceNumber = cleanInvoiceNumber(decisionFinal.invoice_number);
  if (newInvoiceNumber && newInvoiceNumber !== oldValues.invoice_number) {
    updateData.invoice_number = newInvoiceNumber;
  }
  if (decisionFinal.invoice_date) {
    const newDate = new Date(decisionFinal.invoice_date);
    if (!isNaN(newDate.getTime())) updateData.invoice_date = newDate;
  }
  if (decisionFinal.due_date) {
    const newDueDate = new Date(decisionFinal.due_date);
    if (!isNaN(newDueDate.getTime())) updateData.due_date = newDueDate;
  }
  if (finalAmount != null && finalAmount !== oldValues.total_amount) {
    updateData.total_amount = finalAmount;
  }
  if (finalCurrency && finalCurrency !== oldValues.currency) {
    updateData.currency = finalCurrency;
  }
  const newMpo = decisionFinal.mpo_number || madisonResult.mpo_number;
  if (newMpo && newMpo !== oldValues.mpo_number) {
    updateData.mpo_number = newMpo;
  }
  if (decisionFinal.brand && decisionFinal.brand !== oldValues.brand) {
    updateData.brand = decisionFinal.brand;
  }
  if (decisionFinal.brand_code && decisionFinal.brand_code !== oldValues.brand_code) {
    updateData.brand_code = decisionFinal.brand_code;
  }
  if (decisionFinal.season && decisionFinal.season !== oldValues.season) {
    updateData.season = decisionFinal.season;
  }
  if (decisionFinal.payment_terms && decisionFinal.payment_terms !== oldValues.payment_terms) {
    updateData.payment_terms = decisionFinal.payment_terms;
  }
  if (madisonResult.document_type) {
    updateData.invoice_type = madisonResult.document_type;
  }

  // Update charges — prefer AI-first result, fall back to Madison
  const aiFirstCharges = (decisionEngines[0] as any).data;
  if (aiFirstCharges.bank_charges != null) updateData.bank_charges = aiFirstCharges.bank_charges;
  else if (madisonResult.bank_charge != null) updateData.bank_charges = madisonResult.bank_charge;
  if (aiFirstCharges.freight_charges != null) updateData.freight_charges = aiFirstCharges.freight_charges;
  else if (madisonResult.freight_charges != null) updateData.freight_charges = madisonResult.freight_charges;
  if (aiFirstCharges.additional_charges != null) updateData.additional_charges = aiFirstCharges.additional_charges;
  else if (madisonResult.additional_charges != null) updateData.additional_charges = madisonResult.additional_charges;
  if (aiFirstCharges.discount_amount != null) updateData.discount_amount = aiFirstCharges.discount_amount;
  else if (madisonResult.discount_amount != null) updateData.discount_amount = madisonResult.discount_amount;
  if (aiFirstCharges.tt_charge != null) updateData.tt_charge = aiFirstCharges.tt_charge;
  if (aiFirstCharges.courier_charges != null) updateData.courier_charges = aiFirstCharges.courier_charges;
  if (aiFirstCharges.handling_fee != null) updateData.handling_fee = aiFirstCharges.handling_fee;
  if (aiFirstCharges.tax_amount != null) updateData.tax_amount = aiFirstCharges.tax_amount;
  if (aiFirstCharges.setup_charge != null) updateData.setup_charge = aiFirstCharges.setup_charge;
  if (aiFirstCharges.sample_charge != null) updateData.sample_charge = aiFirstCharges.sample_charge;
  if (aiFirstCharges.min_order_charge != null) updateData.min_order_charge = aiFirstCharges.min_order_charge;

  // Update bank details — prefer AI-first, fall back to Madison
  if (aiFirstCharges.bank_name) updateData.bank_name = aiFirstCharges.bank_name;
  else if (madisonResult.bank_details?.bank_name) updateData.bank_name = madisonResult.bank_details.bank_name;
  if (aiFirstCharges.swift_code) updateData.swift_code = aiFirstCharges.swift_code;
  else if (madisonResult.bank_details?.swift_code) updateData.swift_code = madisonResult.bank_details.swift_code;
  if (aiFirstCharges.account_number) updateData.account_number = aiFirstCharges.account_number;
  else if (madisonResult.bank_details?.account_number) updateData.account_number = madisonResult.bank_details.account_number;

  // Update ship_to/sold_to — prefer AI-first
  if (aiFirstCharges.ship_to) updateData.ship_to = aiFirstCharges.ship_to;
  else if (madisonResult.ship_to) updateData.ship_to = madisonResult.ship_to;
  if (aiFirstCharges.sold_to) updateData.sold_to = aiFirstCharges.sold_to;
  else if (madisonResult.sold_to) updateData.sold_to = madisonResult.sold_to;

  // Update PO number
  const newPoNumber = cleanPONumber(decisionFinal.po_number || madisonResult.po_number || null);
  if (newPoNumber) updateData.customer_po_number = newPoNumber;

  // Update qty_shipped — prefer AI-first
  if (aiFirstCharges.qty_shipped) updateData.qty_shipped = aiFirstCharges.qty_shipped;
  else if (madisonResult.qty_shipped) updateData.qty_shipped = madisonResult.qty_shipped;

  // Update incoterm
  if (aiFirstCharges.incoterm) updateData.incoterm = aiFirstCharges.incoterm;

  // Update OCR raw data with new extraction results
  updateData.ocr_raw_data = {
    ai_first_result: ocrResult,
    madison_result: madisonResult,
    decision: fieldDecision,
    re_extracted_at: new Date().toISOString(),
    re_extracted_by: userId,
    raw_text: madisonResult.raw_text,
  } as any;

  // Update OCR confidence
  if (fieldDecision?.overall_confidence) {
    updateData.ocr_confidence_score = fieldDecision.overall_confidence;
  }

  // 8. Re-match vendor
  if (decisionFinal.vendor_name) {
    try {
      const vendorMatch = await matchVendor(decisionFinal.vendor_name);
      if (vendorMatch) {
        updateData.vendor_id = vendorMatch.vendor_id;
      }
    } catch (e) {
      // Keep existing vendor if re-match fails
    }
  }

  // 9. Capture new values for response
  const newValues: Record<string, any> = { ...updateData };
  delete newValues.ocr_raw_data; // Don't return raw data in response

  // 10. Update the invoice
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: updateData,
  });

  // 11. Audit log
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'INVOICE_RE_EXTRACTED',
      performed_by: userId,
      note: `Invoice re-extracted with new OCR pipeline. Updated fields: ${Object.keys(updateData).filter(k => k !== 'ocr_raw_data').join(', ') || 'none'}`,
    },
  });

  logger.info(`[ReExtract] Invoice ${invoice.invoice_number} re-extracted. Updated fields: ${Object.keys(updateData).filter(k => k !== 'ocr_raw_data').join(', ') || 'none'}`);

  // 12. Reset status and re-validate if invoice was in EXCEPTION_FLAGGED or VALIDATION_PENDING
  const shouldRevalidate = ['EXCEPTION_FLAGGED', 'VALIDATION_PENDING', 'RECEIVED', 'OCR_PROCESSING'].includes(invoice.status as string);
  if (shouldRevalidate) {
    // Delete existing PENDING exceptions
    await prisma.exception.deleteMany({
      where: { invoice_id: invoiceId, status: 'PENDING' as any },
    });

    // Reset to VALIDATION_PENDING
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VALIDATION_PENDING as any },
    });

    // Re-run validation
    try {
      const validationResult = await validateInvoice(invoiceId);
      return {
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        old_values: oldValues,
        new_values: newValues,
        message: `Invoice re-extracted successfully. ${Object.keys(updateData).filter(k => k !== 'ocr_raw_data').length} fields updated. Validation ${validationResult.passed ? 'passed' : 'flagged ' + validationResult.exceptions.length + ' exception(s)'}.`,
      };
    } catch (validationError) {
      return {
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        old_values: oldValues,
        new_values: newValues,
        message: `Invoice re-extracted successfully. ${Object.keys(updateData).filter(k => k !== 'ocr_raw_data').length} fields updated. Validation encountered an error: ${validationError instanceof Error ? validationError.message : 'unknown'}`,
      };
    }
  }

  return {
    invoice_id: invoiceId,
    invoice_number: invoice.invoice_number,
    old_values: oldValues,
    new_values: newValues,
    message: `Invoice re-extracted successfully. ${Object.keys(updateData).filter(k => k !== 'ocr_raw_data').length} fields updated. Status remains ${invoice.status} — reprocessing not triggered.`,
  };
}

/**
 * Bulk re-extract multiple invoices.
 */
export async function reExtractInvoices(
  invoiceIds: string[],
  userId: string
): Promise<{
  summary: { total: number; success: number; failed: number };
  results: Array<{ invoice_id: string; status: 'success' | 'error'; message?: string; changes?: Record<string, any> }>;
}> {
  const results: Array<{ invoice_id: string; status: 'success' | 'error'; message?: string; changes?: Record<string, any> }> = [];

  for (const invoiceId of invoiceIds) {
    try {
      const result = await reExtractInvoice(invoiceId, userId);
      results.push({
        invoice_id: invoiceId,
        status: 'success',
        message: result.message,
        changes: { old: result.old_values, new: result.new_values },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ invoice_id: invoiceId, status: 'error', message });
    }
  }

  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;

  return {
    summary: { total: invoiceIds.length, success, failed },
    results,
  };
}
