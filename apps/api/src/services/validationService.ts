import prisma, { isDbEnabled } from '../config/database';
import { ExceptionReason, InvoiceStatus, InvoiceType, BillToEntity, SignatoryRole, APPROVAL_THRESHOLDS, determineApprovalTier } from '@ap-invoice/shared';
import { createApprovalRequest } from './approvalService';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { nextGenService } from './nextGenService';
import crypto from 'crypto';

export interface ValidationResult {
  passed: boolean;
  reason?: ExceptionReason;
  message: string;
  detail?: string;
}

export interface InvoiceValidationResult {
  invoice_id: string;
  passed: boolean;
  results: ValidationResult[];
  exceptions: Array<{
    reason: ExceptionReason;
    detail?: string;
  }>;
}

// Late submission thresholds
const LATE_SUBMISSION_WARNING_DAYS = 7;
const LATE_SUBMISSION_ERROR_DAYS = 14;

/**
 * Run all 17 validation rules against a raw invoice object (no DB required).
 * Used for testing/mock mode when database is unavailable.
 */
export async function validateInvoiceWithData(
  invoiceData: any
): Promise<InvoiceValidationResult> {
  const invoice = invoiceData;
  const results: ValidationResult[] = [];
  const exceptions: Array<{ reason: ExceptionReason; detail: string }> = [];

  const rules = [
    { fn: () => validateVendorMatch(invoice.vendor), reason: ExceptionReason.VENDOR_NOT_FOUND },
    { fn: () => validateInvoiceNumber(invoice.invoice_number), reason: ExceptionReason.MISSING_PO_REFERENCE },
    { fn: () => validateInvoiceDate(invoice.invoice_date ? new Date(invoice.invoice_date) : null), reason: ExceptionReason.OCR_LOW_CONFIDENCE },
    { fn: () => validateDueDate(invoice.due_date ? new Date(invoice.due_date) : null, invoice.invoice_date ? new Date(invoice.invoice_date) : null), reason: ExceptionReason.OCR_LOW_CONFIDENCE },
    { fn: () => validateAmount(Number(invoice.total_amount)), reason: ExceptionReason.AMOUNT_MISMATCH },
    { fn: () => validateCurrency(invoice.currency, invoice.invoice_currency_original, invoice.exchange_rate_to_usd ? Number(invoice.exchange_rate_to_usd) : undefined), reason: ExceptionReason.AMOUNT_MISMATCH },
    { fn: () => validatePaymentTerms(invoice.payment_terms || ''), reason: ExceptionReason.AMOUNT_MISMATCH },
    { fn: () => validateIncoterm(invoice.incoterm), reason: ExceptionReason.AMOUNT_MISMATCH },
    { fn: async () => validateBankDetails(invoice), reason: ExceptionReason.MISSING_BANK_INFO },
    { fn: () => validateSignatures(Number(invoice.total_amount), invoice.signatures || []), reason: ExceptionReason.MISSING_SIGNATURE },
    { fn: async () => checkDuplicateInvoice(invoice), reason: ExceptionReason.DUPLICATE_INVOICE },
    { fn: () => checkLateSubmission(invoice), reason: ExceptionReason.LATE_SUBMISSION },
    { fn: () => checkUrgentPayment(invoice), reason: ExceptionReason.LATE_SUBMISSION },
    { fn: () => validateHandwrittenDocument(invoice), reason: ExceptionReason.HANDWRITTEN_DOCUMENT },
    { fn: async () => checkMissingBankInfo(invoice), reason: ExceptionReason.MISSING_BANK_INFO },
    { fn: () => validateInvoiceTemplate(invoice.invoice_type as InvoiceType, invoice.invoice_template_type), reason: ExceptionReason.HANDWRITTEN_DOCUMENT },
    { fn: async () => validatePOAgainstNextGen(invoice), reason: ExceptionReason.AMOUNT_MISMATCH },
    { fn: async () => validateVendorThreshold(invoice), reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED },
  ];

  for (const rule of rules) {
    const result: ValidationResult = await Promise.resolve(rule.fn());
    results.push(result);
    if (!result.passed) {
      exceptions.push({ reason: result.reason || rule.reason, detail: result.detail || '' });
    }
  }

  const passed = results.every(r => r.passed);
  return {
    invoice_id: invoice.id || 'mock',
    passed,
    results,
    exceptions,
  };
}

export async function validateInvoice(invoiceId: string): Promise<InvoiceValidationResult> {
  if (!isDbEnabled()) {
    throw new AppError('Database not available', 500);
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      signatures: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Clear previous pending exceptions before re-running validation so edits can be validated cleanly
  await prisma.exception.deleteMany({
    where: {
      invoice_id: invoiceId,
      status: 'PENDING' as any,
    },
  });

  const results: ValidationResult[] = [];
  const exceptions: Array<{ reason: ExceptionReason; detail: string }> = [];

  // RULE 1 — Vendor match validation
  const vendorResult = validateVendorMatch(invoice.vendor);
  results.push(vendorResult);
  if (!vendorResult.passed) {
    exceptions.push({ reason: ExceptionReason.VENDOR_NOT_FOUND, detail: vendorResult.detail || '' });
  }

  // RULE 2 — Invoice number format validation
  const invoiceNumberResult = validateInvoiceNumber(invoice.invoice_number);
  results.push(invoiceNumberResult);
  if (!invoiceNumberResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_PO_REFERENCE, detail: invoiceNumberResult.detail || '' });
  }

  // RULE 3 — Invoice date validity
  const invoiceDateResult = validateInvoiceDate(invoice.invoice_date);
  results.push(invoiceDateResult);
  if (!invoiceDateResult.passed) {
    exceptions.push({ reason: ExceptionReason.OCR_LOW_CONFIDENCE, detail: invoiceDateResult.detail || '' });
  }

  // RULE 4 — Due date validity
  const dueDateResult = validateDueDate(invoice.due_date, invoice.invoice_date);
  results.push(dueDateResult);
  if (!dueDateResult.passed) {
    exceptions.push({ reason: ExceptionReason.OCR_LOW_CONFIDENCE, detail: dueDateResult.detail || '' });
  }

  // RULE 5 — Amount validity
  const amountResult = validateAmount(Number(invoice.total_amount));
  results.push(amountResult);
  if (!amountResult.passed) {
    exceptions.push({ reason: ExceptionReason.AMOUNT_MISMATCH, detail: amountResult.detail || '' });
  }

  // RULE 6 — Currency validity
  const currencyResult = validateCurrency(invoice.currency, invoice.invoice_currency_original || undefined, invoice.exchange_rate_to_usd ? Number(invoice.exchange_rate_to_usd) : undefined);
  results.push(currencyResult);
  if (!currencyResult.passed) {
    exceptions.push({ reason: ExceptionReason.AMOUNT_MISMATCH, detail: currencyResult.detail || '' });
  }

  // RULE 7 — Payment terms validity
  const paymentTermsResult = validatePaymentTerms(invoice.payment_terms || '');
  results.push(paymentTermsResult);
  if (!paymentTermsResult.passed) {
    exceptions.push({ reason: ExceptionReason.AMOUNT_MISMATCH, detail: paymentTermsResult.detail || '' });
  }

  // RULE 8 — Incoterm validity
  const incotermResult = validateIncoterm(invoice.incoterm);
  results.push(incotermResult);
  if (!incotermResult.passed) {
    exceptions.push({ reason: ExceptionReason.AMOUNT_MISMATCH, detail: incotermResult.detail || '' });
  }

  // RULE 9 — Bank info completeness
  const bankResult = await validateBankDetails(invoice);
  results.push(bankResult);
  if (!bankResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_BANK_INFO, detail: bankResult.detail || '' });
  }

  // RULE 10 — Signature presence
  const signatureResult = validateSignatures(Number(invoice.total_amount), invoice.signatures);
  results.push(signatureResult);
  if (!signatureResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_SIGNATURE, detail: signatureResult.detail || '' });
  }

  // RULE 11 — Duplicate detection
  const duplicateResult = await checkDuplicateInvoice(invoice);
  results.push(duplicateResult);
  if (!duplicateResult.passed) {
    exceptions.push({ reason: duplicateResult.reason || ExceptionReason.DUPLICATE_INVOICE, detail: duplicateResult.detail || '' });
  }

  // RULE 12 — Late submission check
  const lateResult = checkLateSubmission(invoice);
  results.push(lateResult);
  if (!lateResult.passed) {
    exceptions.push({ reason: ExceptionReason.LATE_SUBMISSION, detail: lateResult.detail || '' });
  }

  // RULE 13 — Urgent payment flag
  const urgentResult = checkUrgentPayment(invoice);
  results.push(urgentResult);
  if (!urgentResult.passed) {
    exceptions.push({ reason: ExceptionReason.LATE_SUBMISSION, detail: urgentResult.detail || '' });
  }

  // RULE 14 — Handwritten document
  const handwrittenResult = validateHandwrittenDocument(invoice);
  results.push(handwrittenResult);
  if (!handwrittenResult.passed) {
    exceptions.push({ reason: ExceptionReason.HANDWRITTEN_DOCUMENT, detail: handwrittenResult.detail || '' });
  }

  // RULE 15 — Missing bank info (vendor-level)
  const bankInfoResult = await checkMissingBankInfo(invoice);
  results.push(bankInfoResult);
  if (!bankInfoResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_BANK_INFO, detail: bankInfoResult.detail || '' });
  }

  // RULE 16 — Invoice template validation
  const templateResult = validateInvoiceTemplate(invoice.invoice_type as InvoiceType, invoice.invoice_template_type as any);
  results.push(templateResult);
  if (!templateResult.passed) {
    exceptions.push({ reason: ExceptionReason.HANDWRITTEN_DOCUMENT, detail: templateResult.detail || '' });
  }

  // RULE 18 — Vendor threshold exceeded
  const vendorThresholdResult = await validateVendorThreshold(invoice);
  results.push(vendorThresholdResult);
  if (!vendorThresholdResult.passed) {
    exceptions.push({ reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED, detail: vendorThresholdResult.detail || '' });
  }

  const passed = results.every(r => r.passed);

  // Create exception records for failed validations
  if (exceptions.length > 0) {
    for (const exc of exceptions) {
      await prisma.exception.create({
        data: {
          invoice_id: invoiceId,
          reason: exc.reason as any,
          detail: exc.detail,
        },
      });
    }

    // Update invoice status to EXCEPTION_FLAGGED
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
    });
  } else {
    // Batch threshold check: hold invoices below $100 cumulative per vendor
    const batchCheck = await checkBatchThreshold(invoiceId);

    if (batchCheck.held) {
      // Invoice is held — status already updated to ON_HOLD by checkBatchThreshold
      exceptions.push({
        reason: ExceptionReason.BATCH_THRESHOLD_NOT_MET,
        detail: `Vendor cumulative amount $${batchCheck.cumulative.toFixed(2)} is below $100 batch threshold. Invoice held until threshold is reached.`,
      });
      results.push({
        passed: false,
        reason: ExceptionReason.BATCH_THRESHOLD_NOT_MET,
        message: 'Batch threshold not met',
        detail: `Vendor cumulative amount $${batchCheck.cumulative.toFixed(2)} is below $100 batch threshold.`,
      });
    } else {
      // Update invoice status to VALIDATION_PENDING
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.VALIDATION_PENDING as any },
      });

      // Auto-create approval request when validation passes
      try {
        await createApprovalRequest(invoiceId, 'system');
      } catch (error) {
        // Log error but don't fail validation if approval request fails
        logger.error('Failed to create approval request:', error);
      }
    }
  }

  return {
    invoice_id: invoiceId,
    passed,
    results,
    exceptions,
  };
}

// RULE 1 — Vendor match validation
function validateVendorMatch(vendor: any): ValidationResult {
  if (!vendor) {
    return {
      passed: false,
      reason: ExceptionReason.VENDOR_NOT_FOUND,
      message: 'Vendor not assigned',
      detail: 'Invoice must be matched to a vendor in the system',
    };
  }

  return {
    passed: true,
    message: 'Vendor is assigned',
  };
}

// RULE 2 — Invoice number format validation
function validateInvoiceNumber(invoiceNumber: string): ValidationResult {
  if (!invoiceNumber || invoiceNumber.trim().length === 0) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_PO_REFERENCE,
      message: 'Invoice number is missing',
      detail: 'Invoice number is required',
    };
  }

  // Check for valid invoice number format (alphanumeric with optional hyphens/underscores)
  const validFormat = /^[A-Z0-9\-_]+$/i.test(invoiceNumber);
  if (!validFormat) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_PO_REFERENCE,
      message: 'Invalid invoice number format',
      detail: `Invoice number "${invoiceNumber}" contains invalid characters`,
    };
  }

  return {
    passed: true,
    message: 'Invoice number format is valid',
  };
}

// RULE 3 — Invoice date validity
function validateInvoiceDate(invoiceDate: Date | null): ValidationResult {
  if (!invoiceDate) {
    return {
      passed: false,
      reason: ExceptionReason.OCR_LOW_CONFIDENCE,
      message: 'Invoice date is missing',
      detail: 'Invoice date is required',
    };
  }

  const date = new Date(invoiceDate);
  if (isNaN(date.getTime())) {
    return {
      passed: false,
      reason: ExceptionReason.OCR_LOW_CONFIDENCE,
      message: 'Invalid invoice date',
      detail: `Invoice date "${invoiceDate}" is not a valid date`,
    };
  }

  // Check if invoice date is in the future
  const now = new Date();
  if (date > now) {
    return {
      passed: false,
      reason: ExceptionReason.OCR_LOW_CONFIDENCE,
      message: 'Invoice date is in the future',
      detail: `Invoice date cannot be in the future (date: ${date.toISOString()})`,
    };
  }

  return {
    passed: true,
    message: 'Invoice date is valid',
  };
}

// RULE 4 — Due date validity
function validateDueDate(dueDate: Date | null, invoiceDate: Date | null): ValidationResult {
  if (!dueDate) {
    return {
      passed: true,
      message: 'Due date is optional',
    };
  }

  const date = new Date(dueDate);
  if (isNaN(date.getTime())) {
    return {
      passed: false,
      reason: ExceptionReason.OCR_LOW_CONFIDENCE,
      message: 'Invalid due date',
      detail: `Due date "${dueDate}" is not a valid date`,
    };
  }

  // Due date should be after invoice date
  if (invoiceDate) {
    const invDate = new Date(invoiceDate);
    if (date < invDate) {
      return {
        passed: false,
        reason: ExceptionReason.OCR_LOW_CONFIDENCE,
        message: 'Due date is before invoice date',
        detail: `Due date (${date.toISOString()}) cannot be before invoice date (${invDate.toISOString()})`,
      };
    }
  }

  return {
    passed: true,
    message: 'Due date is valid',
  };
}

// RULE 5 — Amount validity
function validateAmount(amount: number): ValidationResult {
  if (!amount || amount <= 0) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Invoice amount must be positive',
      detail: `Invalid amount: ${amount}`,
    };
  }

  // Check for unreasonably large amounts (e.g., > 10 million)
  if (amount > 10000000) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Invoice amount is unreasonably large',
      detail: `Amount ${amount} exceeds reasonable threshold`,
    };
  }

  return {
    passed: true,
    message: 'Invoice amount is valid',
  };
}

// RULE 6 — Currency validity
function validateCurrency(currency: string | undefined, currencyOriginal?: string, exchangeRate?: number): ValidationResult {
  if (!currency || currency.trim().length === 0) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Currency is missing',
      detail: 'Currency is required',
    };
  }

  // Primary currency must be USD
  if (currency !== 'USD') {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Primary currency must be USD',
      detail: `Currency "${currency}" is not USD. Original amount should be stored and converted to USD.`,
    };
  }

  // Validate exchange rate is present for non-USD original currency
  if (currencyOriginal && currencyOriginal !== 'USD' && !exchangeRate) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Exchange rate missing for non-USD currency',
      detail: `Original currency ${currencyOriginal} requires exchange_rate_to_usd`,
    };
  }

  return {
    passed: true,
    message: 'Currency is valid',
  };
}

// RULE 7 — Payment terms validity
function validatePaymentTerms(paymentTerms: string): ValidationResult {
  if (!paymentTerms || paymentTerms.trim().length === 0) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Payment terms are missing',
      detail: 'Payment terms are required',
    };
  }

  return {
    passed: true,
    message: 'Payment terms are valid',
  };
}

// RULE 8 — Incoterm validity
function validateIncoterm(incoterm: string | null): ValidationResult {
  if (!incoterm) {
    return {
      passed: true,
      message: 'Incoterm is optional',
    };
  }

  const validIncoterms = ['EXW', 'DAP', 'FOB', 'CIF', 'DDP', 'CFR', 'FCA', 'CPT', 'CIP', 'DAF', 'DES', 'DEQ', 'DDU'];
  const upperIncoterm = incoterm.toUpperCase();

  if (!validIncoterms.includes(upperIncoterm)) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Invalid incoterm',
      detail: `Incoterm "${incoterm}" is not a valid incoterm`,
    };
  }

  return {
    passed: true,
    message: 'Incoterm is valid',
  };
}

// RULE 16 — Invoice template validation
function validateInvoiceTemplate(invoiceType: InvoiceType, expectedTemplate?: any): ValidationResult {
  // STATEMENT type: flag for manual review — do not auto-post
  if (invoiceType === InvoiceType.STATEMENT) {
    return {
      passed: false,
      reason: ExceptionReason.HANDWRITTEN_DOCUMENT,
      message: 'Statement type requires manual review',
      detail: 'STATEMENT type invoices should not be auto-posted to QuickBooks',
    };
  }

  // PROFORMA type must NOT be posted to QuickBooks directly
  if (invoiceType === InvoiceType.PROFORMA) {
    return {
      passed: false,
      reason: ExceptionReason.HANDWRITTEN_DOCUMENT,
      message: 'PI type requires Purchasing Coordinator confirmation',
      detail: 'Proforma invoices require confirmation from Purchasing Coordinator before processing',
    };
  }

  return {
    passed: true,
    message: 'Invoice template is valid',
  };
}

// RULE 9 — Bank details validation
async function validateBankDetails(invoice: any): Promise<ValidationResult> {
  if (!invoice.vendor) {
    return {
      passed: false,
      reason: ExceptionReason.VENDOR_NOT_FOUND,
      message: 'Vendor not assigned',
      detail: 'Cannot validate bank details without vendor assignment',
    };
  }

  const ocrBankInfo = (invoice as any).ocr_raw_data?.bank_info;

  // If OCR didn't extract bank info, allow workflow to proceed if vendor has bank details on file.
  // This avoids blocking digital/manual invoices where OCR bank extraction is unavailable.
  if (!ocrBankInfo || !ocrBankInfo.swift_code || !ocrBankInfo.account_number) {
    if (invoice.vendor?.swift_code && invoice.vendor?.account_number) {
      return {
        passed: true,
        message: 'Vendor bank details on file; OCR bank extraction not required',
      };
    }
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Bank details not extracted from OCR',
      detail: 'OCR did not extract complete bank information and vendor bank details are incomplete',
    };
  }

  // Compare with vendor records
  const vendorSwift = invoice.vendor.swift_code;
  const vendorAccount = invoice.vendor.account_number;

  // Normalize SWIFT codes for comparison
  const normalizeSwift = (swift: string) => swift.toUpperCase().replace(/\s/g, '').replace(/X+$/, '');
  const ocrSwiftNormalized = normalizeSwift(ocrBankInfo.swift_code || '');
  const vendorSwiftNormalized = normalizeSwift(vendorSwift || '');

  // Compare SWIFT codes
  if (vendorSwift && ocrSwiftNormalized && vendorSwiftNormalized !== ocrSwiftNormalized) {
    return {
      passed: false,
      reason: ExceptionReason.BANK_DETAIL_MISMATCH,
      message: 'SWIFT code does not match vendor records',
      detail: `OCR SWIFT: "${ocrBankInfo.swift_code}" vs Vendor SWIFT: "${vendorSwift}"`,
    };
  }

  // Compare account numbers (normalize by removing spaces and dashes)
  const normalizeAccount = (account: string) => account.replace(/[\s-]/g, '');
  const ocrAccountNormalized = normalizeAccount(ocrBankInfo.account_number || '');
  const vendorAccountNormalized = normalizeAccount(vendorAccount || '');

  if (vendorAccount && ocrAccountNormalized && vendorAccountNormalized !== ocrAccountNormalized) {
    return {
      passed: false,
      reason: ExceptionReason.BANK_DETAIL_MISMATCH,
      message: 'Account number does not match vendor records',
      detail: `OCR Account: "${ocrBankInfo.account_number}" vs Vendor Account: "${vendorAccount}"`,
    };
  }

  return {
    passed: true,
    message: 'Bank details match vendor records',
  };
}

// RULE 10 — Signature validation (3-tier per new flow)
function validateSignatures(amount: number, signatures: any[]): ValidationResult {
  // Check for "Computer-generated, no signature required" exemption
  if (signatures && signatures.some((sig: any) =>
    sig.signatory_name && sig.signatory_name.toLowerCase().includes('computer-generated')
  )) {
    return {
      passed: true,
      message: 'Computer-generated invoice - signature not required',
    };
  }

  // Digital workflow: signatures are created during approval. If no signatures
  // exist yet, skip validation so the invoice can proceed to approval request.
  if (!signatures || signatures.length === 0) {
    return {
      passed: true,
      message: 'Digital workflow - signatures will be collected during approval',
    };
  }

  // Count signed signatures
  const signedSignatures = signatures?.filter((sig: any) => sig.signed_at) || [];
  const signedRoles = signedSignatures.map((sig: any) => sig.signatory_role as string);

  const tier = determineApprovalTier(amount);

  // Planning Tier: Coordinator required for all invoices
  if (!signedRoles.includes(SignatoryRole.COORDINATOR)) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_SIGNATURE,
      message: 'Missing Coordinator signature',
      detail: 'A Purchasing Coordinator signature is required for all invoices',
    };
  }

  // Tier 2+: Purchasing Manager
  if (tier >= 2) {
    if (!signedRoles.includes(SignatoryRole.PURCHASING_MANAGER)) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing Purchasing Manager signature',
        detail: 'A Purchasing Manager signature is required for invoices above $2,000',
      };
    }
  }

  // Tier 2+ ($2,001+): MLO Account Holder + MLO Planning Manager + Sr. Manager Global Production
  if (tier >= 2) {
    if (!signedRoles.includes(SignatoryRole.MLO_ACCOUNT_HOLDER)) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing MLO Account Holder signature',
        detail: 'An MLO Account Holder signature is required for invoices above $2,000',
      };
    }
    if (!signedRoles.includes(SignatoryRole.MLO_PLANNING_MANAGER)) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing MLO Planning Manager signature',
        detail: 'An MLO Planning Manager signature is required for invoices above $2,000',
      };
    }
    if (!signedRoles.includes(SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION)) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing Sr. Manager Global Production signature',
        detail: 'Sr. Manager of Global Production Operations signature required for invoices above $2,000',
      };
    }
  }

  // Tier 3: Ms. Polly
  if (tier >= 3) {
    if (!signedRoles.includes(SignatoryRole.MS_POLLY)) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing Ms. Polly signature',
        detail: 'Invoices over $100,000 require Ms. Polly signature',
      };
    }
  }

  return {
    passed: true,
    message: 'Signature requirements met',
  };
}

// RULE 11 — Duplicate detection
async function checkDuplicateInvoice(invoice: any): Promise<ValidationResult> {
  if (!isDbEnabled()) {
    return { passed: true, message: 'Duplicate check skipped — DB unavailable' };
  }

  // Hash: SHA-256(invoice_number + vendor_id + amount + invoice_date)
  const hashInput = `${invoice.invoice_number}${invoice.vendor_id || ''}${invoice.total_amount}${invoice.invoice_date || ''}`;
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  // Check for existing invoice with same invoice_number + vendor
  let duplicate: any = null;
  try {
  duplicate = await prisma.invoice.findFirst({
    where: {
      invoice_number: invoice.invoice_number,
      vendor_id: invoice.vendor_id,
      id: { not: invoice.id },
    },
  });

  } catch {
    return { passed: true, message: 'Duplicate check skipped — DB unavailable' };
  }

  if (duplicate) {
    return {
      passed: false,
      reason: ExceptionReason.DUPLICATE_INVOICE,
      message: 'Duplicate invoice detected',
      detail: `Invoice ${invoice.invoice_number} already exists for this vendor (ID: ${duplicate.id})`,
    };
  }

  // Secondary fuzzy check: same vendor + same amount + date within ±3 days, different invoice number
  try {
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;
    if (invoiceDate) {
      const threeDaysBefore = new Date(invoiceDate.getTime() - 3 * 24 * 60 * 60 * 1000);
      const threeDaysAfter = new Date(invoiceDate.getTime() + 3 * 24 * 60 * 60 * 1000);

      const fuzzyDuplicate = await prisma.invoice.findFirst({
        where: {
          vendor_id: invoice.vendor_id,
          total_amount: Number(invoice.total_amount),
          invoice_date: {
            gte: threeDaysBefore,
            lte: threeDaysAfter,
          },
          invoice_number: { not: invoice.invoice_number },
          id: { not: invoice.id },
        },
      });

      if (fuzzyDuplicate) {
        return {
          passed: false,
          reason: ExceptionReason.DUPLICATE_INVOICE,
          message: 'Suspected duplicate invoice detected (fuzzy match)',
          detail: `Invoice with different number (${fuzzyDuplicate.invoice_number}) but same vendor, amount, and date within ±3 days (ID: ${fuzzyDuplicate.id})`,
        };
      }
    }
  } catch {
    // Skip fuzzy check if DB unavailable
  }

  return {
    passed: true,
    message: 'No duplicate invoice found',
  };
}

// RULE 12 — Late submission
function checkLateSubmission(invoice: any): ValidationResult {
  if (!invoice.invoice_received_date) {
    return {
      passed: true,
      message: 'No received date - cannot check late submission',
    };
  }

  const invoiceDate = new Date(invoice.invoice_date);
  const receivedDate = new Date(invoice.invoice_received_date);
  
  const daysDiff = Math.floor((receivedDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));

  // Check if invoice is old (more than 90 days)
  const daysSinceInvoice = Math.floor((new Date().getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceInvoice > 90) {
    return {
      passed: false,
      reason: ExceptionReason.LATE_SUBMISSION,
      message: 'Old invoice detected',
      detail: `Invoice date is ${daysSinceInvoice} days ago - Accounting review required`,
    };
  }

  // Late submission error threshold
  if (daysDiff > LATE_SUBMISSION_ERROR_DAYS) {
    return {
      passed: false,
      reason: ExceptionReason.LATE_SUBMISSION,
      message: 'Invoice submitted late',
      detail: `Invoice submitted ${daysDiff} days after invoice date (threshold: ${LATE_SUBMISSION_ERROR_DAYS} days)`,
    };
  }

  // Late submission warning threshold (still passes validation)
  if (daysDiff > LATE_SUBMISSION_WARNING_DAYS) {
    return {
      passed: true,
      message: 'Invoice submitted late but within acceptable range',
      detail: `Invoice submitted ${daysDiff} days after invoice date (warning threshold: ${LATE_SUBMISSION_WARNING_DAYS} days)`,
    };
  }

  return {
    passed: true,
    message: 'Invoice submitted within acceptable timeframe',
  };
}

// RULE 13 — Urgent payment
function checkUrgentPayment(invoice: any): ValidationResult {
  // Check priority_flag
  if (invoice.priority_flag) {
    return {
      passed: false,
      reason: ExceptionReason.LATE_SUBMISSION,
      message: 'Urgent payment flag detected',
      detail: invoice.priority_pay_date 
        ? `Priority payment requested by ${new Date(invoice.priority_pay_date).toLocaleDateString()}`
        : 'Priority payment requested - immediate attention required',
    };
  }

  return {
    passed: true,
    message: 'No urgent payment flag',
  };
}

// RULE 14 — Handwritten document
function validateHandwrittenDocument(invoice: any): ValidationResult {
  if (invoice.is_handwritten) {
    return {
      passed: false,
      reason: ExceptionReason.HANDWRITTEN_DOCUMENT,
      message: 'Handwritten document detected',
      detail: 'Document flagged as handwritten - manual data entry by Purchasing Coordinator required before processing',
    };
  }

  return {
    passed: true,
    message: 'Document is not handwritten',
  };
}

// RULE 15 — Missing bank info
async function checkMissingBankInfo(invoice: any): Promise<ValidationResult> {
  if (!invoice.vendor) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Vendor not assigned',
      detail: 'Cannot check bank info without vendor assignment',
    };
  }

  // Check if vendor has SWIFT code
  if (!invoice.vendor.swift_code) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Vendor missing SWIFT code',
      detail: `Vendor "${invoice.vendor.name}" does not have SWIFT code on file - route to Purchasing Coordinator to obtain from vendor`,
    };
  }

  // Check if vendor has account number
  if (!invoice.vendor.account_number) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Vendor missing account number',
      detail: `Vendor "${invoice.vendor.name}" does not have account number on file - route to Purchasing Coordinator to obtain from vendor`,
    };
  }

  return {
    passed: true,
    message: 'Vendor bank information is complete',
  };
}

// RULE 17 — PO cross-check via NextGen (fetch-only)
// FIX 4: Only validate if MPO matches. If MPO mismatch → skip validation, do not compare vendor/brand.
async function validatePOAgainstNextGen(invoice: any): Promise<ValidationResult> {
  const poRef = invoice.mpo_number || invoice.po_number;

  // No PO reference on invoice — skip (not all invoices have POs)
  if (!poRef) {
    return {
      passed: true,
      message: 'No PO/MPO reference — skipping NextGen check',
    };
  }

  try {
    // Fetch PO from NextGen (read-only)
    const po = invoice.mpo_number
      ? await nextGenService.fetchPOByMPO(invoice.mpo_number, {
          vendor_name: invoice.vendor?.name,
          amount: Number(invoice.total_amount),
        })
      : await nextGenService.fetchPOByNumber(invoice.po_number);

    // FIX 4: If PO not found or MPO mismatch, skip validation (do not compare vendor/brand)
    if (!po) {
      return {
        passed: true,
        message: `PO ${poRef} not found in NextGen — skipping validation (MPO mismatch)`,
        detail: `Referenced PO could not be found. MPO mismatch detected - skipping vendor/brand comparison.`,
      };
    }

    // FIX 4: Only proceed with comparison if MPO matches
    // If we got here, MPO matches, so we can safely compare amount and vendor
    const differences: string[] = [];

    // Amount check (>5% variance = fail)
    const poAmount = Number(po.amount);
    const invoiceAmount = Number(invoice.total_amount);
    if (poAmount > 0) {
      const variance = Math.abs(invoiceAmount - poAmount) / poAmount;
      if (variance > 0.05) {
        differences.push(
          `Amount: invoice $${invoiceAmount.toFixed(2)} vs PO $${poAmount.toFixed(2)} (${(variance * 100).toFixed(1)}% variance)`
        );
      }
    }

    // Vendor name check (only if MPO matches)
    if (invoice.vendor?.name && po.vendor_name) {
      const invoiceVendor = invoice.vendor.name.toLowerCase().trim();
      const poVendor = po.vendor_name.toLowerCase().trim();
      if (invoiceVendor !== poVendor) {
        differences.push(`Vendor: invoice "${invoice.vendor.name}" vs PO "${po.vendor_name}"`);
      }
    }

    if (differences.length > 0) {
      return {
        passed: false,
        reason: ExceptionReason.AMOUNT_MISMATCH,
        message: `Invoice does not match PO ${poRef} in NextGen`,
        detail: differences.join('; '),
      };
    }

    return {
      passed: true,
      message: `PO ${poRef} verified in NextGen — amount and vendor match`,
    };
  } catch (error) {
    // NextGen unavailable — log warning but don't block validation
    logger.warn(`NextGen PO check failed for ${poRef}: ${error instanceof Error ? error.message : 'unknown error'}`);
    return {
      passed: true,
      message: `NextGen unavailable — PO ${poRef} check deferred to pre-post stage`,
    };
  }
}

// RULE 18 — Vendor cumulative threshold
async function validateVendorThreshold(invoice: any): Promise<ValidationResult> {
  if (!invoice.vendor_id || !invoice.total_amount) {
    return {
      passed: true,
      message: 'Cannot validate threshold without vendor and amount',
    };
  }

  try {
    // Configuration: 90-day lookback window and $500,000 threshold
    const THRESHOLD_AMOUNT = 500000; // $500,000
    const THRESHOLD_DAYS = 90; // 90-day cumulative window

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - THRESHOLD_DAYS);

    // Calculate vendor cumulative total for the past 90 days (excluding current invoice and rejected invoices)
    const vendorCumulative = await prisma.invoice.aggregate({
      _sum: { total_amount: true },
      where: {
        vendor_id: invoice.vendor_id,
        status: { not: InvoiceStatus.REJECTED as any },
        created_at: { gte: cutoffDate },
        id: { not: invoice.id }, // Exclude current invoice
      },
    });

    const existingTotal = Number(vendorCumulative._sum.total_amount || 0);
    const currentTotal = existingTotal + Number(invoice.total_amount);

    if (currentTotal > THRESHOLD_AMOUNT) {
      return {
        passed: false,
        reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED,
        message: `Vendor cumulative threshold exceeded`,
        detail: `Vendor cumulative total $${currentTotal.toFixed(2)} exceeds $${THRESHOLD_AMOUNT.toLocaleString()} threshold for the last ${THRESHOLD_DAYS} days. Route to Purchasing Coordinator for approval. Existing: $${existingTotal.toFixed(2)}, Current invoice: $${Number(invoice.total_amount).toFixed(2)}`,
      };
    }

    return {
      passed: true,
      message: `Vendor within cumulative threshold ($${currentTotal.toFixed(2)} of $${THRESHOLD_AMOUNT.toLocaleString()})`,
    };
  } catch (error) {
    logger.warn(`Vendor threshold check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    // Don't block on threshold check if there's an error
    return {
      passed: true,
      message: 'Vendor threshold check deferred',
      detail: 'Could not validate vendor threshold - will be checked during approval stage',
    };
  }
}

/**
 * Batch threshold check: hold invoices for a vendor until cumulative reaches $100.
 * Once reached, the vendor is "approved" and invoices proceed through the workflow.
 */
export async function checkBatchThreshold(invoiceId: string): Promise<{ held: boolean; cumulative: number; released: number }> {
  const BATCH_THRESHOLD = 100;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice || !invoice.vendor_id) {
    return { held: false, cumulative: 0, released: 0 };
  }

  // Calculate cumulative for this vendor using only ON_HOLD invoices plus the current invoice.
  // This ensures invoices are held/released as each new invoice is validated, matching the
  // user's batch workflow: hold until cumulative reaches $100, then release all held invoices.
  const heldInvoices = await prisma.invoice.findMany({
    where: {
      vendor_id: invoice.vendor_id,
      status: InvoiceStatus.ON_HOLD as any,
      id: { not: invoiceId },
      created_at: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    },
  });

  const heldTotal = heldInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const currentAmount = Number(invoice.total_amount);
  const cumulative = heldTotal + currentAmount;
  const held = cumulative < BATCH_THRESHOLD;

  if (held) {
    // Mark current invoice as ON_HOLD
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.ON_HOLD as any },
    });

    await prisma.exception.create({
      data: {
        invoice_id: invoiceId,
        reason: ExceptionReason.BATCH_THRESHOLD_NOT_MET as any,
        detail: `Vendor cumulative amount $${cumulative.toFixed(2)} is below $${BATCH_THRESHOLD} batch threshold. Invoice held until threshold is reached.`,
      },
    });

    return { held: true, cumulative, released: 0 };
  }

  // Threshold reached: release all held invoices for this vendor together with current invoice
  const heldInvoiceIds = heldInvoices.map((inv) => inv.id);

  for (const heldInvoice of heldInvoices) {
    await prisma.invoice.update({
      where: { id: heldInvoice.id },
      data: { status: InvoiceStatus.VALIDATION_PENDING as any },
    });

    // Create approval request for each released invoice
    try {
      await createApprovalRequest(heldInvoice.id, 'system');
    } catch (error) {
      logger.error('Failed to create approval request for released invoice:', error);
    }

    // Resolve the batch threshold exception since the cumulative has been reached
    const batchExceptions = await prisma.exception.findMany({
      where: {
        invoice_id: heldInvoice.id,
        reason: ExceptionReason.BATCH_THRESHOLD_NOT_MET as any,
        status: 'PENDING' as any,
      },
    });
    for (const exc of batchExceptions) {
      await prisma.exception.update({
        where: { id: exc.id },
        data: {
          status: 'RESOLVED' as any,
          resolved_at: new Date(),
          resolved_by: 'system',
          resolution_notes: `Auto-resolved: vendor cumulative reached $${cumulative.toFixed(2)} and threshold $${BATCH_THRESHOLD} met`,
        },
      });
    }
  }

  return { held: false, cumulative, released: heldInvoiceIds.length };
}
