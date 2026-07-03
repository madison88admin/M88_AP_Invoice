import { Response, NextFunction, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { analyzeInvoice } from '../services/ocrService';
import { extractMadisonInvoiceFields, AST_SINGLE_SOURCE_MODE } from '../services/madisonInvoiceExtractor';
import { matchVendor } from '../services/vendorMatchingService';
import { InvoiceStatus, SignatureType } from '@ap-invoice/shared';
import { NextGenService } from '../services/nextGenService';
import { validateInvoiceAgainstPO } from '../services/invoiceValidationAgent';
import { poAuditService } from '../services/poAuditService';
import { geminiOCRService } from '../services/geminiOCRService';
import { groqOCRService } from '../services/groqOCRService';
import { ollamaOCRService } from '../services/ollamaOCRService';
import { consensusExtractor, RawExtractionResult } from '../services/consensusExtractor';
import crypto from 'crypto';
import { createChildLogger } from '../utils/logger';

export const uploadInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.log('=== UPLOAD ENDPOINT HIT ===', new Date().toISOString());
  console.log('Headers:', req.headers.authorization ? 'Token present' : 'NO TOKEN');
  console.log('File:', req.file ? req.file.originalname : 'NO FILE');
  console.log('Body keys:', Object.keys(req.body));

  try {
    console.log('[DEBUG] uploadInvoice called');
    console.log('[DEBUG] req.file:', req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : 'NO FILE');

    if (!req.file) {
      console.error('[ERROR] No file uploaded');
      throw new AppError('No file uploaded', 400);
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    console.log('[DEBUG] File buffer size:', fileBuffer.length);
    console.log('[DEBUG] MIME type:', mimeType);

    // Analyze invoice using OCR
    const ocrResult = await analyzeInvoice(fileBuffer, mimeType);

    console.log('[DEBUG] OCR result:', JSON.stringify(ocrResult, null, 2));

    // DSRS v7.3: PO validation is runtime-blocked in AST mode.
    // PO system becomes async audit only, not runtime logic.
    let poValidation: any = null;
    if (AST_SINGLE_SOURCE_MODE) {
      console.log('[DEBUG] AST zero-leak mode: PO validation skipped (runtime isolated)');
      poValidation = {
        mode: 'AST_ISOLATED',
        skipped: true,
        message: 'PO validation is disabled in AST single-source mode. Use async audit only.',
      };
    } else {
      try {
        const nextGenService = NextGenService.getInstance();
        const nextGenData = await nextGenService.compareInvoiceWithPO({
          po_number: ocrResult.customer_po_number,
          mpo_number: ocrResult.mpo_number,
          amount: ocrResult.total_amount,
          vendor_name: ocrResult.vendor_name,
          brand: ocrResult.brand,
          season: ocrResult.season,
          order_type: ocrResult.order_type,
        });

        // Use new validation agent for enhanced validation
        const validationResult = await validateInvoiceAgainstPO(
          {
            vendor_name: ocrResult.vendor_name || '',
            invoice_number: ocrResult.invoice_number || '',
            invoice_date: ocrResult.invoice_date instanceof Date ? ocrResult.invoice_date.toISOString().split('T')[0] : String(ocrResult.invoice_date),
            due_date: ocrResult.due_date instanceof Date ? ocrResult.due_date.toISOString().split('T')[0] : String(ocrResult.due_date || ''),
            document_type: null, // Not available in OCR result
            amount: ocrResult.total_amount || 0,
            currency: ocrResult.currency || 'USD',
            brand: ocrResult.brand || '',
            season: ocrResult.season || '',
            order_type: ocrResult.order_type || '',
            po_reference_raw: '', // Not available in OCR result
            po_number: ocrResult.customer_po_number || null,
            mpo_number: ocrResult.mpo_number || '',
          },
          {
            vendor_id: nextGenData.nextgen_data?.vendor_id || '',
            vendor_name: nextGenData.nextgen_data?.vendor_name || '',
            brand: nextGenData.nextgen_data?.brand || '',
            season: nextGenData.nextgen_data?.season || '',
            order_type: nextGenData.nextgen_data?.order_type || '',
            currency: nextGenData.nextgen_data?.currency || '',
            amount: nextGenData.nextgen_data?.amount || 0,
            status: nextGenData.nextgen_data?.status || '',
          }
        );

        // Merge validation results
        poValidation = {
          ...nextGenData,
          validation_result: validationResult,
        };

        console.log('[DEBUG] Enhanced PO validation:', JSON.stringify(poValidation, null, 2));
      } catch (nextGenError) {
        console.error('[DEBUG] NextGen validation failed, continuing without PO check:', nextGenError);
        poValidation = {
          po_found: false,
          is_match: false,
          comparison: {
            amount_match: false,
            vendor_match: false,
            brand_match: false,
            season_match: false,
            order_type_match: false,
            differences: ['NextGen validation error'],
          },
          validation_result: {
            status: 'REJECTED' as const,
            confidence: 0,
            summary: 'NextGen validation failed',
            checks: {
              mpo_found: false,
              vendor_match: false,
              vendor_match_score: 0,
              brand_match: false,
              brand_source: 'INVOICE' as const,
              season_match: false,
              order_type_match: false,
              currency_match: false,
              amount_variance_percent: 100,
            },
            issues: ['NextGen validation error'],
            recommendation: 'Manual review required',
          },
        };
      }
    }

    // Match vendor using DB matching only (PO validation no longer drives vendor assignment in AST mode)
    let vendorId: string = '';
    let requiresManualVendorAssignment = false;

    if (!AST_SINGLE_SOURCE_MODE && poValidation?.validation_result?.checks?.vendor_match) {
      // Use NextGen vendor_id from validation if vendor matched (legacy mode only)
      vendorId = poValidation.nextgen_data?.vendor_id || '';
      requiresManualVendorAssignment = false;
      console.log('[DEBUG] Using NextGen vendor_id from validation:', vendorId);
    } else {
      // Fallback to old vendor matching service if validation didn't match
      const vendorMatch = await matchVendor(ocrResult.vendor_name);
      if (vendorMatch) {
        vendorId = vendorMatch.vendor_id;
        requiresManualVendorAssignment = false;
      } else {
        console.log('[DEBUG] Vendor not found in DB or DB unavailable, skipping vendor assignment');
        requiresManualVendorAssignment = false; // Don't block on DB failure
      }
    }

    // Return OCR result with matched vendor
    res.status(200).json({
      success: true,
      ocr_result: ocrResult,
      vendor_match: {
        vendor_id: vendorId,
        vendor_name: ocrResult.vendor_name,
      },
      requires_manual_vendor_assignment: requiresManualVendorAssignment,
      po_validation: poValidation,
    });
  } catch (error) {
    console.error('[DEBUG] uploadInvoice error:', error);
    next(error);
  }
};

export const uploadMadisonInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // FIX: Add request correlation ID for debugging
  const requestId = crypto.randomUUID();
  const logger = createChildLogger(`extraction:${requestId}`);

  logger.info(`[${requestId}] Upload endpoint started`, {
    fileName: req.file?.originalname,
    contentType: req.headers['content-type'],
  });

  console.log('=== MADISON INVOICE UPLOAD ENDPOINT HIT ===', new Date().toISOString());
  console.log('File:', req.file ? req.file.originalname : 'NO FILE');

  try {
    if (!req.file) {
      logger.error(`[${requestId}] No file uploaded`);
      throw new AppError('No file uploaded', 400);
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    logger.info(`[${requestId}] File received`, {
      fileSize: fileBuffer.length,
      mimeType: mimeType,
    });

    console.log('[DEBUG] File buffer size:', fileBuffer.length);
    console.log('[DEBUG] MIME type:', mimeType);

    // Extract Madison-specific invoice fields (Engine 1)
    const startTime = Date.now();
    const madisonRawResult = await extractMadisonInvoiceFields(fileBuffer);

    logger.info(`[${requestId}] Madison extraction completed`, {
      status: madisonRawResult.status || 'unknown',
      duration_ms: Date.now() - startTime,
    });

    console.log('[DEBUG] Madison extraction result:', JSON.stringify(madisonRawResult, null, 2));

    // DSRS v7.3 Dual-Engine Consensus: run pdf2json+madison and Gemini in parallel
    const pdf2jsonRaw: RawExtractionResult = {
      vendor_name: madisonRawResult.vendor_name || undefined,
      invoice_number: madisonRawResult.invoice_number || undefined,
      invoice_date: madisonRawResult.invoice_date || undefined,
      due_date: madisonRawResult.due_date || undefined,
      payment_terms: madisonRawResult.payment_terms || undefined,
      total_amount: madisonRawResult.amount || undefined,
      currency: madisonRawResult.currency || undefined,
      po_number: madisonRawResult.po_number || undefined,
      mpo_number: madisonRawResult.mpo_number || undefined,
      brand: madisonRawResult.brand || undefined,
      brand_code: madisonRawResult.brand_code || undefined,
      season: madisonRawResult.season || undefined,
      line_items: undefined,
    };

    console.log('[DEBUG] pdf2jsonRaw mapped for consensus:', JSON.stringify(pdf2jsonRaw, null, 2));

    const extractionContext = {
      vendorName: madisonRawResult.vendor_name || undefined,
    };

    let fallbackResult: any = null;
    const consensus = await consensusExtractor.extract(
      madisonRawResult.raw_text || '',
      fileBuffer,
      async () => pdf2jsonRaw,
      async (text, _buffer, context) => {
        if (groqOCRService.isAvailable()) {
          const result = await groqOCRService.extractFromText(text, context);
          if (result) {
            fallbackResult = result;
            return result;
          }
        }
        if (geminiOCRService.isAvailable()) {
          const result = await geminiOCRService.extractFromText(text, context);
          if (result) {
            fallbackResult = result;
            return result;
          }
        }
        if (ollamaOCRService.isAvailable()) {
          const result = await ollamaOCRService.extractFromText(text, context);
          fallbackResult = result;
          return result;
        }
        return null;
      },
      extractionContext
    );

    console.log(`[DEBUG] Consensus extraction: confidence=${consensus.overall_confidence}, status=${consensus.overall_status}, conflicts=${consensus.conflicts.length}, engines=${consensus.engines_used.join('+')}`);

    // DSRS v7.3: Non-destructive consensus fallback. Use the consensus amount only when the
    // AST kernel explicitly failed, has no internal line items, or its own line item sum is
    // inconsistent with the consensus amount. This preserves AST correctness when it works and
    // avoids trusting Gemini when the AST already extracted a valid amount.
    const astInternalSum = madisonRawResult.amount_resolution_debug?.internalLineItemSum ?? 0;
    const astAmount = madisonRawResult.amount ?? 0;
    const consensusAmount = consensus.final.total_amount ?? 0;
    const consensusLineItemsSum = (consensus.final.line_items || [])
      .reduce((sum: number, li: any) => sum + (Number(li.total_amount) || 0), 0);

    const consensusAmountMatchesItsLineItems = consensusAmount > 0
      && Math.abs(consensusLineItemsSum - consensusAmount) / consensusAmount < 0.05;

    // Normalize invoice number: remove spaces around dashes/slashes
    const cleanInvoiceNumber = (value: string | null | undefined) =>
      value ? value.replace(/\s*([\-\\/])\s*/g, '$1').trim() : null;

    // Normalize PO number: extract PO002905 from strings like CSC_F26_PO002905_JAN 28
    const cleanPONumber = (value: string | null | undefined) => {
      if (!value) return null;
      const poMatch = value.match(/\bPO(\d{4,6})\b/i);
      if (poMatch) return 'PO' + poMatch[1].padStart(6, '0');
      return value;
    };

    const astInternalSumBad = astInternalSum > 0
      && consensusAmount > 0
      && Math.abs(astInternalSum - consensusAmount) / consensusAmount > 0.5;

    const astAmountBad = astAmount > 0
      && consensusAmount > 0
      && Math.abs(astAmount - consensusAmount) / consensusAmount > 0.5;

    const astFailed = madisonRawResult.status === 'AST_FAILURE'
      || (astInternalSum === 0 && !madisonRawResult.amount);

    const useConsensusFallback = astFailed
      || (consensusAmountMatchesItsLineItems && (astInternalSumBad || astAmountBad));

    if (useConsensusFallback && consensusAmount) {
      madisonRawResult.amount = consensusAmount;
      madisonRawResult.status = 'EXTRACTED';
      madisonRawResult.status_reason = 'amount_from_consensus_fallback';
    }

    // Compute total quantity from line items if Madison didn't extract qty_shipped
    const lineItems = consensus.final.line_items || [];
    const computedQty = lineItems.length > 0
      ? lineItems.reduce((sum: number, li: any) => sum + (Number(li.quantity) || 0), 0)
      : madisonRawResult.qty_shipped;

    // Merge consensus final fields with Madison metadata (keep bank details, qty, etc.)
    // DSRS v7.3: In AST single-source mode, the AST amount is the authoritative source of truth.
    // If the AST kernel fails to resolve an amount, fall back to the consensus amount so the
    // upload is not rejected. In legacy/consensus mode, prefer the consensus amount when available.
    const finalAmount = AST_SINGLE_SOURCE_MODE
      ? (madisonRawResult.amount ?? consensus.final.total_amount)
      : (consensus.final.total_amount ?? madisonRawResult.amount);
    const finalCurrency = AST_SINGLE_SOURCE_MODE
      ? (madisonRawResult.currency ?? consensus.final.currency)
      : consensus.final.currency;

    console.log('[AMOUNT_DEBUG]', {
      mode: AST_SINGLE_SOURCE_MODE ? 'AST' : 'CONSENSUS',
      madisonAmount: madisonRawResult.amount,
      madisonCurrency: madisonRawResult.currency,
      consensusAmount: consensus.final.total_amount,
      consensusCurrency: consensus.final.currency,
      finalAmount,
      finalCurrency,
      source: AST_SINGLE_SOURCE_MODE ? 'MADISON_AST' : (consensus.final.total_amount !== null ? 'CONSENSUS' : 'MADISON')
    });

    // DSRS v7.3: Capture the actual upload/receipt time as the SLA base date.
    // This is the moment the invoice was received by the system, distinct from invoice_date.
    const invoiceReceivedDate = new Date().toISOString();

    let madisonResult = {
      ...madisonRawResult,
      ...consensus.final,
      amount: finalAmount,
      invoice_received_date: invoiceReceivedDate,
      vendor_name: consensus.final.vendor_name,
      invoice_number: cleanInvoiceNumber(consensus.final.invoice_number),
      invoice_date: consensus.final.invoice_date,
      due_date: AST_SINGLE_SOURCE_MODE
        ? (madisonRawResult.due_date || consensus.final.due_date || null)
        : (consensus.final.due_date || madisonRawResult.due_date || null),
      payment_terms: AST_SINGLE_SOURCE_MODE
        ? (madisonRawResult.payment_terms || consensus.final.payment_terms || null)
        : (consensus.final.payment_terms || madisonRawResult.payment_terms || null),
      currency: finalCurrency,
      po_number: cleanPONumber(consensus.final.po_number || madisonRawResult.po_number || null),
      mpo_number: consensus.final.mpo_number || madisonRawResult.mpo_number || null,
      brand: consensus.final.brand || madisonRawResult.brand || null,
      brand_code: consensus.final.brand_code || madisonRawResult.brand_code || null,
      season: consensus.final.season || madisonRawResult.season || null,
      order_type: madisonRawResult.order_type || null,
      qty_shipped: madisonRawResult.qty_shipped || computedQty || null,
      consensus,
    };

    // If the Madison extractor mixed up two-column delivery/invoice addresses, prefer the LLM fallback result.
    if (fallbackResult?.ship_to) {
      const current = madisonResult.ship_to || '';
      if (!current || current.length > 300 || /MADISON\s*88/i.test(current) || /INVOICE\s*ADDRESS/i.test(current)) {
        madisonResult.ship_to = fallbackResult.ship_to;
        console.log('[DEBUG] ship_to overridden by LLM fallback:', fallbackResult.ship_to);
      }
    }
    if (fallbackResult?.sold_to) {
      const current = madisonResult.sold_to || '';
      if (!current || current.length > 300 || /PT\s*UWU/i.test(current) || /Delivery\s*address/i.test(current)) {
        madisonResult.sold_to = fallbackResult.sold_to;
        console.log('[DEBUG] sold_to overridden by LLM fallback:', fallbackResult.sold_to);
      }
    }

    // Capture debug logs for account number extraction
    const debugLogs: any = {
      account_number_debug: {
        bank_name: madisonResult.bank_details?.bank_name,
        swift_code: madisonResult.bank_details?.swift_code,
        account_number: madisonResult.bank_details?.account_number,
      }
    };

    // Generate a unique audit session id for the async PO audit (DSRS v7.3)
    const poAuditId = crypto.randomUUID();

    // DSRS v7.3: PO validation runs as a non-blocking check. In AST mode it is
    // display-only — it NEVER overrides the AST extraction. The async audit is
    // still scheduled for background checking and change tracking.
    let poValidation: any = null;
    if (AST_SINGLE_SOURCE_MODE) {
      if (madisonResult.mpo_number || madisonResult.po_number) {
        try {
          const nextGenService = NextGenService.getInstance();
          const nextGenData = await nextGenService.compareInvoiceWithPO({
            po_number: madisonResult.po_number || undefined,
            mpo_number: madisonResult.mpo_number || undefined,
            amount: madisonResult.amount || 0,
            vendor_name: madisonResult.vendor_name || '',
            brand: madisonResult.brand || undefined,
            season: madisonResult.season || undefined,
            order_type: madisonResult.order_type || undefined,
          });

          const validationResult = await validateInvoiceAgainstPO(
            {
              vendor_name: madisonResult.vendor_name || '',
              invoice_number: madisonResult.invoice_number || '',
              invoice_date: madisonResult.invoice_date || '',
              due_date: madisonResult.due_date || '',
              document_type: madisonResult.document_type,
              amount: madisonResult.amount || 0,
              currency: madisonResult.currency || 'USD',
              brand: madisonResult.brand || '',
              season: madisonResult.season || '',
              order_type: madisonResult.order_type || '',
              po_reference_raw: madisonResult.po_reference_raw || '',
              po_number: madisonResult.po_number || null,
              mpo_number: madisonResult.mpo_number || '',
            },
            {
              vendor_id: nextGenData.nextgen_data?.vendor_id || '',
              vendor_name: nextGenData.nextgen_data?.vendor_name || '',
              brand: nextGenData.nextgen_data?.brand || '',
              season: nextGenData.nextgen_data?.season || '',
              order_type: nextGenData.nextgen_data?.order_type || '',
              currency: nextGenData.nextgen_data?.currency || '',
              amount: nextGenData.nextgen_data?.amount || 0,
              status: nextGenData.nextgen_data?.status || '',
            }
          );

          poValidation = {
            mode: 'AST_ISOLATED',
            skipped: false,
            message: 'PO validation completed (display-only in AST mode)',
            ...nextGenData,
            validation_result: validationResult,
          };

          console.log('[DEBUG] AST mode PO validation:', JSON.stringify(poValidation, null, 2));
        } catch (nextGenError) {
          console.error('[DEBUG] AST mode PO validation failed:', nextGenError);
          poValidation = {
            mode: 'AST_ISOLATED',
            skipped: false,
            message: 'PO validation failed (NextGen error)',
            po_found: false,
            is_match: false,
            comparison: {
              amount_match: false,
              vendor_match: false,
              brand_match: false,
              season_match: false,
              order_type_match: false,
              differences: ['NextGen validation error'],
            },
            validation_result: {
              status: 'REJECTED' as const,
              confidence: 0,
              summary: 'NextGen validation failed',
              checks: {
                mpo_found: false,
                vendor_match: false,
                vendor_match_score: 0,
                brand_match: false,
                brand_source: 'INVOICE' as const,
                season_match: false,
                order_type_match: false,
                currency_match: false,
                amount_variance_percent: 100,
              },
              issues: ['NextGen validation error'],
              recommendation: 'Manual review required',
            },
          };
        }
      } else {
        poValidation = {
          mode: 'AST_ISOLATED',
          skipped: true,
          message: 'No PO/MPO number found — PO validation skipped',
        };
      }

      // DSRS v7.3 async audit — schedule background PO check without blocking upload
      poAuditService.scheduleAudit(
        poAuditId,
        {
          po_number: madisonResult.po_number || undefined,
          mpo_number: madisonResult.mpo_number || undefined,
          amount: madisonResult.amount || 0,
          vendor_name: madisonResult.vendor_name || '',
          brand: madisonResult.brand || undefined,
          season: madisonResult.season || undefined,
          order_type: madisonResult.order_type || undefined,
        },
        2000
      );
    } else if (madisonResult.mpo_number) {
      try {
        const nextGenService = NextGenService.getInstance();
        const nextGenData = await nextGenService.compareInvoiceWithPO({
          po_number: madisonResult.po_number || undefined,
          mpo_number: madisonResult.mpo_number,
          amount: madisonResult.amount || 0,
          vendor_name: madisonResult.vendor_name || '',
          brand: madisonResult.brand || undefined,
          season: madisonResult.season || undefined,
          order_type: madisonResult.order_type || undefined,
        });

        // Use new validation agent for enhanced validation
        const validationResult = await validateInvoiceAgainstPO(
          {
            vendor_name: madisonResult.vendor_name || '',
            invoice_number: madisonResult.invoice_number || '',
            invoice_date: madisonResult.invoice_date || '',
            due_date: madisonResult.due_date || '',
            document_type: madisonResult.document_type,
            amount: madisonResult.amount || 0,
            currency: madisonResult.currency || 'USD',
            brand: madisonResult.brand || '',
            season: madisonResult.season || '',
            order_type: madisonResult.order_type || '',
            po_reference_raw: madisonResult.po_reference_raw || '',
            po_number: madisonResult.po_number || null,
            mpo_number: madisonResult.mpo_number || '',
          },
          {
            vendor_id: nextGenData.nextgen_data?.vendor_id || '',
            vendor_name: nextGenData.nextgen_data?.vendor_name || '',
            brand: nextGenData.nextgen_data?.brand || '',
            season: nextGenData.nextgen_data?.season || '',
            order_type: nextGenData.nextgen_data?.order_type || '',
            currency: nextGenData.nextgen_data?.currency || '',
            amount: nextGenData.nextgen_data?.amount || 0,
            status: nextGenData.nextgen_data?.status || '',
          }
        );

        // Merge validation results
        poValidation = {
          ...nextGenData,
          validation_result: validationResult,
        };

        console.log('[DEBUG] Enhanced PO validation:', JSON.stringify(poValidation, null, 2));
      } catch (nextGenError) {
        console.error('[DEBUG] NextGen validation failed, continuing without PO check:', nextGenError);
        poValidation = {
          po_found: false,
          is_match: false,
          comparison: {
            amount_match: false,
            vendor_match: false,
            brand_match: false,
            season_match: false,
            order_type_match: false,
            differences: ['NextGen validation error'],
          },
          validation_result: {
            status: 'REJECTED' as const,
            confidence: 0,
            summary: 'NextGen validation failed',
            checks: {
              mpo_found: false,
              vendor_match: false,
              vendor_match_score: 0,
              brand_match: false,
              brand_source: 'INVOICE' as const,
              season_match: false,
              order_type_match: false,
              currency_match: false,
              amount_variance_percent: 100,
            },
            issues: ['NextGen validation error'],
            recommendation: 'Manual review required',
          },
        };
      }

      // Fallback: Use NextGen PO quantity if qty_shipped is null (legacy mode only)
      if (!madisonResult.qty_shipped && poValidation && poValidation.nextgen_data && poValidation.nextgen_data.line_items && poValidation.nextgen_data.line_items.length > 0) {
        // Find the line item that matches the invoice amount (closest match)
        const invoiceAmount = madisonResult.amount || 0;
        let matchedItem = poValidation.nextgen_data.line_items[0];
        let minDiff = Math.abs(poValidation.nextgen_data.line_items[0].unit_price - invoiceAmount);

        for (const item of poValidation.nextgen_data.line_items) {
          const diff = Math.abs(item.unit_price - invoiceAmount);
          if (diff < minDiff) {
            minDiff = diff;
            matchedItem = item;
          }
        }

        madisonResult.qty_shipped = matchedItem.quantity;
        console.log('[DEBUG] Using NextGen PO quantity from matched line item:', matchedItem.quantity, '(unit price:', matchedItem.unit_price, ')');
      }
    }

    // Match vendor using DB matching only (PO validation no longer drives vendor assignment in AST mode)
    let vendorId: string | null = null;
    let requiresManualVendorAssignment = false;

    if (madisonResult.vendor_name) {
      // Fallback to old vendor matching service if validation didn't match
      const vendorMatch = await matchVendor(madisonResult.vendor_name);
      if (vendorMatch) {
        vendorId = vendorMatch.vendor_id;
        requiresManualVendorAssignment = false;
        console.log('[DEBUG] Vendor matched via DB:', vendorMatch.vendor_name);
      } else {
        console.log('[DEBUG] Vendor not found in DB or DB unavailable, skipping vendor assignment');
        requiresManualVendorAssignment = false; // Don't block on DB failure
      }
    }

    // Return Madison extraction result with debug logs
    res.status(200).json({
      success: true,
      extraction: madisonResult,
      vendor_match: vendorId ? {
        vendor_id: vendorId,
        vendor_name: madisonResult.vendor_name,
      } : null,
      requires_manual_vendor_assignment: requiresManualVendorAssignment,
      po_validation: poValidation,
      consensus: {
        overall_confidence: (madisonResult as any).consensus?.overall_confidence,
        overall_status: (madisonResult as any).consensus?.overall_status,
        requires_review: (madisonResult as any).consensus?.requires_review,
        conflicts: (madisonResult as any).consensus?.conflicts,
        engines_used: (madisonResult as any).consensus?.engines_used,
        extraction_time_ms: (madisonResult as any).consensus?.extraction_time_ms,
      },
      po_audit: AST_SINGLE_SOURCE_MODE
        ? {
            status: 'PENDING',
            message: 'PO validation running in background',
            poll_url: `/api/invoices/${poAuditId}/po-status`,
            audit_id: poAuditId,
          }
        : null,
      debug: debugLogs,
    });
  } catch (error) {
    console.error('[DEBUG] uploadMadisonInvoice error:', error);
    next(error);
  }
};

export const confirmOCR = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { invoice_id } = req.params;
    const {
      invoice_number,
      invoice_date,
      due_date,
      invoice_received_date,
      vendor_id,
      total_amount,
      currency,
      payment_terms,
      incoterm,
      subtotal,
      tax_amount,
      discount_amount,
      bank_charges,
      freight_charges,
      additional_charges,
      ship_to,
      sold_to,
      invoice_type,
      category,
      bill_to_entity,
      bank_info,
      signatures,
      is_urgent,
      priority_flag,
      po_audit_id,
    } = req.body;

    // Import invoice service dynamically to avoid circular dependency
    const invoiceService = await import('../services/invoiceService');

    // Create invoice record with RECEIVED status
    const invoice = await invoiceService.createInvoice(
      {
        invoice_number,
        invoice_date,
        due_date,
        invoice_received_date: invoice_received_date || new Date(),
        vendor_id,
        total_amount,
        currency,
        payment_terms,
        incoterm,
        subtotal,
        tax_amount,
        discount_amount,
        bank_charges: bank_charges || 0,
        freight_charges: freight_charges || 0,
        additional_charges: additional_charges || 0,
        ship_to,
        sold_to,
        invoice_type,
        category,
        bill_to_entity: bill_to_entity || 'MADISON_88_LTD',
        ocr_raw_data: {
          bank_info,
          signatures,
        },
        is_urgent: is_urgent || false,
        priority_flag: priority_flag || false,
      },
      req.user!.id
    );

    // DSRS v7.3: transfer async PO audit result from upload session to invoice id
    if (po_audit_id) {
      const transferred = poAuditService.transferAudit(po_audit_id, invoice.id);
      console.log(`[DEBUG] PO audit transfer from ${po_audit_id} to invoice ${invoice.id}: ${transferred}`);
    }

    // Create signature records if detected
    if (signatures && signatures.length > 0) {
      const db = await import('../config/database');
      if (!db.isDbEnabled()) {
        console.warn('[DEBUG] Prisma unavailable, skipping signature records');
      } else {
        const prisma = db.default;
        for (const sig of signatures) {
          await prisma.signature.create({
            data: {
              invoice_id: invoice.id,
              signatory_name: sig.signatory_name || sig.signer_name,
              signed_at: sig.signed_at ? new Date(sig.signed_at) : null,
              signatory_role: (sig.signatory_role || sig.role || 'COORDINATOR') as any,
              signature_type: (sig.signature_type || SignatureType.DIGITAL) as any,
            },
          });
        }
      }
    }

    res.status(201).json(invoice);
  } catch (error) {
    next(error);
  }
};
