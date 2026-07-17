import { Response, NextFunction, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { analyzeInvoice } from '../services/ocrService';
import { extractMadisonInvoiceFields, AST_SINGLE_SOURCE_MODE } from '../services/madisonInvoiceExtractor';
import { matchVendor, matchOrCreateVendor } from '../services/vendorMatchingService';
import { InvoiceStatus, SignatureType } from '@ap-invoice/shared';
import { sanitizeInvoiceType, sanitizeCategory } from '../utils/enumSanitizer';
import { NextGenService } from '../services/nextGenService';
import { validateInvoiceAgainstPO } from '../services/invoiceValidationAgent';
import { poAuditService } from '../services/poAuditService';
import { geminiOCRService } from '../services/geminiOCRService';
import { groqOCRService } from '../services/groqOCRService';
import { ollamaOCRService } from '../services/ollamaOCRService';
import { qwenOCRService } from '../services/qwenOCRService';
import { fieldDecisionEngine, EngineName } from '../services/fieldDecisionEngine';
import { validateLineItems, formatLineItemValidation } from '../services/lineItemValidator';
import { detectFraud } from '../services/fraudDetector';
import { smartRetry } from '../services/smartRetry';
import { runSelfValidation } from '../services/selfValidation';
import { validateAgainstVendorHistory } from '../services/vendorHistoryValidator';
import { activeLearningService, vendorTemplateService } from '../services/continuousLearningService';
import { detectMultiInvoice, splitPdfByPageRanges } from '../services/multiInvoiceDetector';
import crypto from 'crypto';
import { createChildLogger } from '../utils/logger';

// ─── Async upload job storage ───
interface UploadJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
}
const uploadJobs = new Map<string, UploadJob>();

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
        // Auto-create vendor if no match and we have a valid vendor name
        const bankInfo = (ocrResult as any).bank_info || {};
        const vendorResult = await matchOrCreateVendor(ocrResult.vendor_name, {
          bank_name: bankInfo.bank_name || (ocrResult as any).bank_name,
          swift_code: bankInfo.swift_code || (ocrResult as any).bank_swift,
          account_number: bankInfo.account_usd || bankInfo.account_number || (ocrResult as any).bank_account,
        });
        if (vendorResult) {
          vendorId = vendorResult.vendor_id;
          requiresManualVendorAssignment = false;
          console.log('[DEBUG] Auto-created vendor:', ocrResult.vendor_name, 'id:', vendorId);
        } else {
          console.log('[DEBUG] Vendor not found in DB or DB unavailable, skipping vendor assignment');
          requiresManualVendorAssignment = false;
        }
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

// Internal: process a single invoice PDF (called directly for multi-invoice splits)
async function processSingleInvoice(
  req: Request,
  res: Response,
  next: NextFunction,
  requestId?: string
) {
  // FIX: Add request correlation ID for debugging
  const reqId = requestId || crypto.randomUUID();
  const logger = createChildLogger(`extraction:${reqId}`);

  logger.info(`[${reqId}] Upload endpoint started`, {
    fileName: req.file?.originalname,
    contentType: req.headers['content-type'],
  });

  console.log('=== MADISON INVOICE UPLOAD ENDPOINT HIT ===', new Date().toISOString());
  console.log('File:', req.file ? req.file.originalname : 'NO FILE');

  try {
    if (!req.file) {
      logger.error(`[${reqId}] No file uploaded`);
      throw new AppError('No file uploaded', 400);
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    logger.info(`[${reqId}] File received`, {
      fileSize: fileBuffer.length,
      mimeType: mimeType,
    });

    console.log('[DEBUG] File buffer size:', fileBuffer.length);
    console.log('[DEBUG] MIME type:', mimeType);

    // Extract Madison-specific invoice fields (Engine 1)
    const startTime = Date.now();
    const madisonRawResult = await extractMadisonInvoiceFields(fileBuffer);

    logger.info(`[${reqId}] Madison extraction completed`, {
      status: madisonRawResult.status || 'unknown',
      duration_ms: Date.now() - startTime,
    });

    console.log('[DEBUG] Madison extraction result:', JSON.stringify(madisonRawResult, null, 2));

    const extractionContext = {
      vendorName: madisonRawResult.vendor_name || undefined,
    };

    // ============================================================================
    // PARALLEL ENGINE EXTRACTION — Gemini + Qwen simultaneously, Groq → Ollama fallback
    // ============================================================================
    let geminiResult: any = null;
    let qwenResult: any = null;
    let groqResult: any = null;
    let ollamaResult: any = null;

    const parallelEngines: Promise<any>[] = [];

    if (geminiOCRService.isAvailable()) {
      parallelEngines.push(
        geminiOCRService.extractFromText(madisonRawResult.raw_text || '', extractionContext)
          .then(r => { if (r) geminiResult = r; return r; })
          .catch(e => { console.error('[Gemini] error:', e); return null; })
      );
    }

    if (qwenOCRService.isAvailable()) {
      parallelEngines.push(
        qwenOCRService.extractFromText(madisonRawResult.raw_text || '', extractionContext)
          .then(r => { if (r) qwenResult = r; return r; })
          .catch(e => { console.error('[Qwen] error:', e); return null; })
      );
    }

    if (parallelEngines.length > 0) {
      await Promise.all(parallelEngines);
    }

    // Sequential fallback only if no LLM produced results
    if (!geminiResult && !qwenResult) {
      if (groqOCRService.isAvailable()) {
        groqResult = await groqOCRService.extractFromText(madisonRawResult.raw_text || '', extractionContext)
          .catch(e => { console.error('[Groq] error:', e); return null; });
      }
      if (!groqResult && ollamaOCRService.isAvailable()) {
        ollamaResult = await ollamaOCRService.extractFromText(madisonRawResult.raw_text || '', extractionContext)
          .catch(e => { console.error('[Ollama] error:', e); return null; });
      }
    }

    // ============================================================================
    // FIELD DECISION ENGINE — single source of truth
    // ============================================================================
    const decisionEngines: Array<{ engine_name: EngineName; data: Record<string, any>; confidence: number }> = [
      {
        engine_name: 'madison',
        data: {
          vendor_name: madisonRawResult.vendor_name,
          invoice_number: madisonRawResult.invoice_number,
          invoice_date: madisonRawResult.invoice_date,
          due_date: madisonRawResult.due_date,
          payment_terms: madisonRawResult.payment_terms,
          total_amount: madisonRawResult.amount,
          currency: madisonRawResult.currency,
          po_number: madisonRawResult.po_number,
          mpo_number: madisonRawResult.mpo_number,
          brand: madisonRawResult.brand,
          brand_code: madisonRawResult.brand_code,
          season: madisonRawResult.season,
          ship_to: madisonRawResult.ship_to,
          sold_to: madisonRawResult.sold_to,
        },
        confidence: 75,
      },
    ];

    if (geminiResult) {
      decisionEngines.push({ engine_name: 'gemini', data: geminiResult, confidence: geminiResult.confidence || 70 });
    }
    if (qwenResult) {
      decisionEngines.push({ engine_name: 'qwen', data: qwenResult, confidence: qwenResult.confidence || 70 });
    }
    if (groqResult) {
      decisionEngines.push({ engine_name: 'groq', data: groqResult, confidence: groqResult.confidence || 65 });
    }
    if (ollamaResult) {
      decisionEngines.push({ engine_name: 'ollama', data: ollamaResult, confidence: ollamaResult.confidence || 60 });
    }

    let fieldDecision: any = null;
    let lineItemValidation: any = null;
    let fraudCheck: any = null;
    let selfValidation: any = null;
    let vendorHistoryCheck: any = null;
    let activeLearningQuestions: any = null;
    let fieldPredictions: any = null;
    let layoutChangeDetection: any = null;
    let fallbackResult: any = geminiResult || qwenResult || groqResult || ollamaResult || null;

    try {
      fieldDecision = await fieldDecisionEngine.decide(decisionEngines, {
        vendorName: madisonRawResult.vendor_name || undefined,
        rawText: madisonRawResult.raw_text || undefined,
      });

      console.log(`[FieldDecision] confidence=${fieldDecision.overall_confidence}, status=${fieldDecision.overall_status}, review_fields=${fieldDecision.review_fields.join(', ') || 'none'}`);

      // Line Item Computation Validation
      const allLineItems = fieldDecision.final.line_items || [];
      if (allLineItems.length > 0) {
        lineItemValidation = validateLineItems(allLineItems, fieldDecision.final.total_amount || undefined);
        if (!lineItemValidation.all_pass) {
          console.log(`[LineItemValidation] ${lineItemValidation.failing_count} failed, ${lineItemValidation.warning_count} warnings`);
        }
      }

      // Fraud Detection
      fraudCheck = detectFraud({
        invoiceVendorName: fieldDecision.final.vendor_name || undefined,
        invoiceNumber: fieldDecision.final.invoice_number || undefined,
        totalAmount: fieldDecision.final.total_amount || undefined,
        currency: fieldDecision.final.currency || undefined,
        poNumber: fieldDecision.final.po_number || undefined,
        mpoNumber: fieldDecision.final.mpo_number || undefined,
      });

      if (!fraudCheck.passed) {
        console.log(`[FraudDetection] Risk: ${fraudCheck.risk_level} — ${fraudCheck.summary}`);
      }

      // Smart Retry: re-run only low-confidence fields with focused prompts
      if (fieldDecision.review_fields.length > 0) {
        console.log(`[SmartRetry] Attempting retry for ${fieldDecision.review_fields.length} low-confidence fields...`);
        try {
          const retriedDecision = await smartRetry(fieldDecision, madisonRawResult.raw_text || '', decisionEngines);
          if (retriedDecision !== fieldDecision) {
            fieldDecision = retriedDecision;
            console.log(`[SmartRetry] Updated decision: confidence=${fieldDecision.overall_confidence}, review_fields=${fieldDecision.review_fields.length}`);
          }
        } catch (retryError) {
          console.error('[SmartRetry] Error:', retryError);
        }
      }

      // Self Validation: AI reviews the extracted JSON for inconsistencies
      try {
        selfValidation = await runSelfValidation(fieldDecision, madisonRawResult.raw_text || undefined);
        if (!selfValidation.passed) {
          console.log(`[SelfValidation] ${selfValidation.summary}`);
        }
      } catch (validationError) {
        console.error('[SelfValidation] Error:', validationError);
      }

      // Vendor History Validation (bank account, currency, invoice number patterns)
      try {
        vendorHistoryCheck = await validateAgainstVendorHistory({
          vendorName: fieldDecision.final.vendor_name || '',
          bankName: madisonRawResult.bank_details?.bank_name || undefined,
          bankAccount: madisonRawResult.bank_details?.account_number || undefined,
          swiftCode: madisonRawResult.bank_details?.swift_code || undefined,
          currency: fieldDecision.final.currency || undefined,
          invoiceNumber: fieldDecision.final.invoice_number || undefined,
          totalAmount: fieldDecision.final.total_amount || undefined,
        });
        if (!vendorHistoryCheck.passed) {
          console.log(`[VendorHistory] ${vendorHistoryCheck.summary}`);
        }
      } catch (historyError) {
        console.error('[VendorHistory] Error:', historyError);
      }

      // Active Learning: generate questions for uncertain fields
      try {
        activeLearningQuestions = activeLearningService.generateQuestions(fieldDecision, {
          vendorName: fieldDecision.final.vendor_name || undefined,
        });
        if (activeLearningQuestions.needs_input) {
          console.log(`[ActiveLearning] ${activeLearningQuestions.questions.length} questions for user review`);
        }
      } catch (learningError) {
        console.error('[ActiveLearning] Error:', learningError);
      }

      // Vendor Template: predict missing fields from historical patterns
      try {
        const vendorName = fieldDecision.final.vendor_name || '';
        if (vendorName) {
          const template = await vendorTemplateService.autoGenerateTemplate(vendorName);
          if (template) {
            const predictions = vendorTemplateService.predictMissingFields(
              vendorName,
              fieldDecision.final,
              template
            );
            if (predictions.length > 0) {
              fieldPredictions = predictions;
              console.log(`[VendorTemplate] Predicted ${predictions.length} missing fields for ${vendorName}`);
            }

            // Detect layout changes
            const layoutCheck = await vendorTemplateService.detectLayoutChange(vendorName, fieldDecision.final);
            if (layoutCheck.layout_changed) {
              console.log(`[VendorTemplate] Layout change detected for ${vendorName}: ${layoutCheck.changes.length} changes`);
              layoutChangeDetection = layoutCheck;
            }
          }
        }
      } catch (templateError) {
        console.error('[VendorTemplate] Error:', templateError);
      }
    } catch (decisionError) {
      console.error('[FieldDecision] Error:', decisionError);
    }

    // Use Field Decision Engine output as the single source of truth
    const decision = fieldDecision;
    const decisionFinal = decision?.final || {
      vendor_name: madisonRawResult.vendor_name || '',
      invoice_number: madisonRawResult.invoice_number || '',
      invoice_date: madisonRawResult.invoice_date || '',
      due_date: madisonRawResult.due_date || null,
      payment_terms: madisonRawResult.payment_terms || null,
      total_amount: madisonRawResult.amount || 0,
      currency: madisonRawResult.currency || 'USD',
      po_number: madisonRawResult.po_number,
      mpo_number: madisonRawResult.mpo_number,
      brand: madisonRawResult.brand,
      brand_code: madisonRawResult.brand_code,
      season: madisonRawResult.season,
      line_items: [],
    };

    console.log(`[DEBUG] Field Decision: confidence=${decision?.overall_confidence}, status=${decision?.overall_status}, conflicts=${decision?.conflicts.length}, engines=${decision?.engines_used.join('+')}`);

    // AST fallback: if the AST kernel failed, use the decision engine's amount
    const astInternalSum = madisonRawResult.amount_resolution_debug?.internalLineItemSum ?? 0;
    const astAmount = madisonRawResult.amount ?? 0;
    const decisionAmount = decisionFinal.total_amount ?? 0;
    const decisionLineItemsSum = (decisionFinal.line_items || [])
      .reduce((sum: number, li: any) => sum + (Number(li.total_amount) || 0), 0);

    const decisionAmountMatchesLineItems = decisionAmount > 0
      && Math.abs(decisionLineItemsSum - decisionAmount) / decisionAmount < 0.05;

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
      && decisionAmount > 0
      && Math.abs(astInternalSum - decisionAmount) / decisionAmount > 0.5;

    const astAmountBad = astAmount > 0
      && decisionAmount > 0
      && Math.abs(astAmount - decisionAmount) / decisionAmount > 0.5;

    const astFailed = madisonRawResult.status === 'AST_FAILURE'
      || (astInternalSum === 0 && !madisonRawResult.amount);

    const useDecisionFallback = astFailed
      || (decisionAmountMatchesLineItems && (astInternalSumBad || astAmountBad));

    if (useDecisionFallback && decisionAmount) {
      madisonRawResult.amount = decisionAmount;
      madisonRawResult.status = 'EXTRACTED';
      madisonRawResult.status_reason = 'amount_from_decision_engine';
    }

    // Compute total quantity from line items
    const lineItems = decisionFinal.line_items || [];
    const computedQty = lineItems.length > 0
      ? lineItems.reduce((sum: number, li: any) => sum + (Number(li.quantity) || 0), 0)
      : madisonRawResult.qty_shipped;

    // In AST mode, Madison amount is authoritative. If AST failed, use decision engine amount.
    const finalAmount = AST_SINGLE_SOURCE_MODE
      ? (madisonRawResult.amount ?? decisionFinal.total_amount)
      : (decisionFinal.total_amount ?? madisonRawResult.amount);
    const finalCurrency = AST_SINGLE_SOURCE_MODE
      ? (madisonRawResult.currency ?? decisionFinal.currency)
      : decisionFinal.currency;

    console.log('[AMOUNT_DEBUG]', {
      mode: AST_SINGLE_SOURCE_MODE ? 'AST' : 'DECISION',
      madisonAmount: madisonRawResult.amount,
      madisonCurrency: madisonRawResult.currency,
      decisionAmount: decisionFinal.total_amount,
      decisionCurrency: decisionFinal.currency,
      finalAmount,
      finalCurrency,
      source: AST_SINGLE_SOURCE_MODE ? 'MADISON_AST' : (decisionFinal.total_amount ? 'DECISION' : 'MADISON')
    });

    const invoiceReceivedDate = new Date().toISOString();

    let madisonResult = {
      ...madisonRawResult,
      ...decisionFinal,
      amount: finalAmount,
      invoice_received_date: invoiceReceivedDate,
      vendor_name: decisionFinal.vendor_name,
      invoice_number: cleanInvoiceNumber(decisionFinal.invoice_number),
      invoice_date: decisionFinal.invoice_date,
      due_date: AST_SINGLE_SOURCE_MODE
        ? (madisonRawResult.due_date || decisionFinal.due_date || null)
        : (decisionFinal.due_date || madisonRawResult.due_date || null),
      payment_terms: AST_SINGLE_SOURCE_MODE
        ? (madisonRawResult.payment_terms || decisionFinal.payment_terms || null)
        : (decisionFinal.payment_terms || madisonRawResult.payment_terms || null),
      currency: finalCurrency,
      po_number: cleanPONumber(decisionFinal.po_number || madisonRawResult.po_number || null),
      mpo_number: decisionFinal.mpo_number || madisonRawResult.mpo_number || null,
      brand: decisionFinal.brand || madisonRawResult.brand || null,
      brand_code: decisionFinal.brand_code || madisonRawResult.brand_code || null,
      season: decisionFinal.season || madisonRawResult.season || null,
      order_type: madisonRawResult.order_type || null,
      qty_shipped: madisonRawResult.qty_shipped || computedQty || null,
      decision: fieldDecision,
      field_decision: fieldDecision,
      line_item_validation: lineItemValidation,
      fraud_check: fraudCheck,
      self_validation: selfValidation,
      vendor_history_check: vendorHistoryCheck,
      active_learning: activeLearningQuestions,
      field_predictions: fieldPredictions,
      layout_change: layoutChangeDetection,
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
        // Auto-create vendor if no match and we have a valid vendor name
        const bankDetails = madisonResult.bank_details || {};
        const vendorResult = await matchOrCreateVendor(madisonResult.vendor_name, {
          bank_name: bankDetails.bank_name,
          swift_code: bankDetails.swift_code,
          account_number: bankDetails.account_number,
        });
        if (vendorResult) {
          vendorId = vendorResult.vendor_id;
          requiresManualVendorAssignment = false;
          console.log('[DEBUG] Auto-created vendor:', madisonResult.vendor_name, 'id:', vendorId);
        } else {
          console.log('[DEBUG] Vendor not found in DB or DB unavailable, skipping vendor assignment');
          requiresManualVendorAssignment = false;
        }
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
      decision: {
        overall_confidence: (madisonResult as any).decision?.overall_confidence,
        overall_status: (madisonResult as any).decision?.overall_status,
        requires_review: (madisonResult as any).decision?.requires_review,
        review_fields: (madisonResult as any).decision?.review_fields,
        conflicts: (madisonResult as any).decision?.conflicts,
        engines_used: (madisonResult as any).decision?.engines_used,
        engine_notes: (madisonResult as any).decision?.engine_notes,
        extraction_time_ms: (madisonResult as any).decision?.extraction_time_ms,
        fields: (madisonResult as any).decision?.fields,
      },
      line_item_validation: (madisonResult as any).line_item_validation,
      fraud_check: (madisonResult as any).fraud_check,
      self_validation: (madisonResult as any).self_validation,
      vendor_history_check: (madisonResult as any).vendor_history_check,
      active_learning: (madisonResult as any).active_learning,
      field_predictions: (madisonResult as any).field_predictions,
      layout_change: (madisonResult as any).layout_change,
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
    console.error('[DEBUG] processSingleInvoice error:', error);
    next(error);
  }
}

// ─── Public upload endpoint with multi-invoice detection ───
export const uploadMadisonInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = crypto.randomUUID();
  const logger = createChildLogger(`extraction:${requestId}`);

  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // ─── Multi-invoice detection ───
    if (mimeType === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      try {
        const detection = await detectMultiInvoice(fileBuffer);
        if (detection.isMultiInvoice && detection.invoiceCount > 1) {
          console.log(`[MultiInvoice] Detected ${detection.invoiceCount} invoices in PDF — splitting...`);
          logger.info(`[${requestId}] Multi-invoice PDF detected: ${detection.invoiceCount} invoices`);

          const splitBuffers = await splitPdfByPageRanges(fileBuffer, detection.pageRanges);
          const allResults: any[] = [];

          for (let i = 0; i < splitBuffers.length; i++) {
            console.log(`[MultiInvoice] Processing invoice ${i + 1}/${splitBuffers.length}...`);
            try {
              const mockReq = {
                file: { buffer: splitBuffers[i], originalname: `split_${i + 1}.pdf`, mimetype: mimeType },
                user: (req as any).user,
                headers: req.headers,
                body: req.body,
              } as any;

              let splitResultData: any = null;
              let splitResultError: string | null = null;

              const mockRes = {
                status: () => mockRes,
                json: (data: any) => { splitResultData = data; return mockRes; },
              } as any;

              const mockNext = (err?: any) => {
                if (err) splitResultError = err.message || String(err);
              };

              await processSingleInvoice(mockReq, mockRes, mockNext, `${requestId}_split${i + 1}`);

              if (splitResultError) {
                allResults.push({ success: false, error: splitResultError, split_index: i });
              } else if (splitResultData) {
                allResults.push({ success: true, split_index: i, ...splitResultData });
              }
            } catch (splitErr: any) {
              console.error(`[MultiInvoice] Error processing split ${i + 1}:`, splitErr);
              allResults.push({ success: false, error: splitErr.message || String(splitErr), split_index: i });
            }
          }

          return res.status(200).json({
            success: true,
            is_multi_invoice: true,
            invoice_count: allResults.length,
            multi_invoice_detection: {
              invoice_count: detection.invoiceCount,
              page_ranges: detection.pageRanges.map(r => ({
                pages: `${r.startPage + 1}-${r.endPage + 1}`,
                invoice_number: r.invoiceNumber,
                vendor_name: r.vendorName,
                amount: r.amount,
              })),
            },
            results: allResults,
          });
        }
      } catch (detectErr) {
        console.warn('[MultiInvoice] Detection failed, processing as single invoice:', detectErr);
      }
    }

    // Single invoice — process normally
    return processSingleInvoice(req, res, next, requestId);
  } catch (error) {
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
      date_range_start,
      date_range_end,
      vendor_id,
      vendor_name_raw,
      total_amount,
      invoice_currency_original,
      exchange_rate_to_usd,
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
      order_type,
      brand,
      brand_code,
      season,
      mpo_number,
      material_code,
      material_name,
      customer_po_number,
      bill_to_entity,
      is_handwritten,
      is_urgent,
      priority_flag,
      priority_pay_date,
      bank_info,
      signatures,
      ocr_confidence_score,
      ocr_raw_data,
      po_validation,
      po_audit_id,
      qty_shipped,
      line_items,
    } = req.body;

    // Import invoice service dynamically to avoid circular dependency
    const invoiceService = await import('../services/invoiceService');

    // Create invoice record — pass through ALL extracted fields to prevent data loss
    const invoice = await invoiceService.createInvoice(
      {
        invoice_number,
        invoice_date,
        due_date,
        invoice_received_date: invoice_received_date || new Date(),
        date_range_start,
        date_range_end,
        vendor_id,
        vendor_name_raw,
        total_amount,
        invoice_currency_original,
        exchange_rate_to_usd,
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
        invoice_type: sanitizeInvoiceType(invoice_type),
        category: sanitizeCategory(category),
        order_type,
        brand,
        brand_code,
        season,
        mpo_number,
        material_code: material_code || ocr_raw_data?.material_code,
        material_name: material_name || ocr_raw_data?.material_name,
        customer_po_number,
        bill_to_entity: bill_to_entity || 'MADISON_88_LTD',
        is_handwritten: is_handwritten || false,
        is_urgent: is_urgent || false,
        priority_flag: priority_flag || false,
        priority_pay_date,
        qty_shipped,
        line_items: line_items || ocr_raw_data?.line_items,
        ocr_confidence_score,
        // Preserve full OCR raw data for audit trail — merge bank_info and signatures into ocr_raw_data
        ocr_raw_data: ocr_raw_data || {
          bank_info,
          signatures,
          ocr_confidence_score,
        },
        po_validation,
        // Extract bank fields from bank_info if available
        bank_name: bank_info?.bank_name,
        swift_code: bank_info?.swift_code,
        account_number: bank_info?.account_usd || bank_info?.account_number,
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
              ocr_detected: sig.ocr_detected ?? false,
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

// ─── Async upload: returns job ID immediately, processes in background ───
export const uploadMadisonInvoiceAsync = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const jobId = crypto.randomUUID();
    const fileBuffer = Buffer.from(req.file.buffer);
    const fileName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const user = (req as any).user;

    uploadJobs.set(jobId, {
      id: jobId,
      status: 'processing',
      createdAt: Date.now(),
    });

    // Process in background — reuse the same logic as uploadMadisonInvoice
    // by calling the internal function with a mock req/res
    setImmediate(async () => {
      try {
        const mockReq = {
          file: { buffer: fileBuffer, originalname: fileName, mimetype: mimeType },
          user,
          headers: req.headers,
          body: req.body,
        } as any;

        let resultData: any = null;
        let resultError: string | null = null;

        // Capture the response by intercepting res.json
        const mockRes = {
          status: () => mockRes,
          json: (data: any) => { resultData = data; return mockRes; },
        } as any;

        const mockNext = (err?: any) => {
          if (err) resultError = err.message || String(err);
        };

        await uploadMadisonInvoice(mockReq, mockRes, mockNext);

        const job = uploadJobs.get(jobId);
        if (job) {
          if (resultError) {
            job.status = 'failed';
            job.error = resultError;
          } else if (resultData) {
            job.status = 'completed';
            job.result = resultData;
          } else {
            job.status = 'failed';
            job.error = 'No result returned from extraction';
          }
        }
      } catch (err: any) {
        const job = uploadJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = err.message || String(err);
        }
      }

      // Clean up old jobs (older than 10 minutes)
      const now = Date.now();
      for (const [id, j] of uploadJobs.entries()) {
        if (now - j.createdAt > 600000) uploadJobs.delete(id);
      }
    });

    res.status(202).json({ jobId, status: 'processing', message: 'Upload received, processing started' });
  } catch (error) {
    next(error);
  }
};

// ─── Poll upload job status ───
export const getUploadJobStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const job = uploadJobs.get(req.params.jobId);
    if (!job) {
      throw new AppError('Job not found', 404);
    }
    res.json({
      jobId: job.id,
      status: job.status,
      result: job.status === 'completed' ? job.result : undefined,
      error: job.status === 'failed' ? job.error : undefined,
    });
  } catch (error) {
    next(error);
  }
};
