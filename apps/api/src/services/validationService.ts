import prisma, { isDbEnabled } from '../config/database';
import { ExceptionReason, InvoiceStatus, InvoiceType, BillToEntity, SignatoryRole, APPROVAL_THRESHOLDS, determineApprovalTier, VENDOR_THRESHOLD_CONFIG, BATCH_THRESHOLD_CONFIG, getRequiredSignatoryRoles } from '@ap-invoice/shared';
import { createApprovalRequest } from './approvalService';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { nextGenService, getNextGenMetrics } from './nextGenService';
import { checkDuplicateInvoice as checkDuplicateDetailed } from './duplicateDetectionService';
import { parseMPOReference } from '../utils/mpoReference';
import { matchMPOLines } from '../utils/mpoLineMatching';
import { getAliasMap, namesEquivalent } from './aliasService';
import { validateFinanceArithmetic, financeIssueIsBlocking } from './financeControlService';
import { getFinancePolicy, isNonPOCategory } from './financePolicyService';
import { retainValidationSnapshot } from './validationSnapshotService';

// Levenshtein distance for fuzzy string comparison (e.g. SWIFT code OCR typos)
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export type ValidationState = 'MATCHED' | 'WITHIN_TOLERANCE' | 'MISMATCH' | 'INCOMPLETE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface ValidationResult {
  passed: boolean;
  state?: ValidationState;
  reason?: ExceptionReason;
  code?: 'NEXTGEN_UNAVAILABLE' | 'VALIDATION_UNAVAILABLE' | 'NOT_APPLICABLE';
  message: string;
  detail?: string;
  /** True for warning-only results that must not block the workflow (Finance advisory mode). */
  advisory?: boolean;
}

export interface InvoiceValidationResult {
  invoice_id: string;
  passed: boolean;
  state: ValidationState;
  results: ValidationResult[];
  exceptions: Array<{
    reason: ExceptionReason;
    detail?: string;
  }>;
  allExceptionsHandled?: boolean;
}

export function canonicalValidationState(result: ValidationResult): ValidationState {
  if (result.state) return result.state;
  if (result.code === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  if (result.code === 'NEXTGEN_UNAVAILABLE' || result.code === 'VALIDATION_UNAVAILABLE') return 'UNAVAILABLE';
  if (!result.passed && /missing|requires|incomplete|not assigned/i.test(`${result.message} ${result.detail || ''}`)) return 'INCOMPLETE';
  if (!result.passed) return 'MISMATCH';
  if (/tolerance|warning/i.test(`${result.message} ${result.detail || ''}`)) return 'WITHIN_TOLERANCE';
  return 'MATCHED';
}

function canonicalize(results: ValidationResult[]): ValidationResult[] {
  return results.map(result => ({ ...result, state: canonicalValidationState(result) }));
}

/**
 * Splits new exceptions into hard-blocking and advisory-only groups.
 * A reason blocks only when a failed (non-advisory) result or a non-waivable
 * infrastructure failure carries it. Passed results with a reason — Finance
 * advisory-mode warnings AND pre-existing warning-only rules (e.g. vendor
 * threshold) — stay visible as exceptions but never hold the invoice.
 */
export function splitBlockingExceptions(
  newExceptions: Array<{ reason: ExceptionReason; detail?: string }>,
  results: ValidationResult[],
  nonWaivableReasons: Set<string>
): { blocking: Array<{ reason: ExceptionReason; detail?: string }>; advisoryOnly: Array<{ reason: ExceptionReason; detail?: string }> } {
  const blockingReasons = new Set(
    results
      .filter(result => !result.passed)
      .map(result => result.reason as string)
      .filter(Boolean)
  );
  const blocking = newExceptions.filter(
    exception => nonWaivableReasons.has(exception.reason as string)
      || blockingReasons.has(exception.reason as string)
  );
  const advisoryOnly = newExceptions.filter(exception => !blocking.includes(exception));
  return { blocking, advisoryOnly };
}

function overallValidationState(results: ValidationResult[]): ValidationState {
  const states = canonicalize(results).map(result => result.state!);
  if (states.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (states.includes('INCOMPLETE')) return 'INCOMPLETE';
  if (states.includes('MISMATCH')) return 'MISMATCH';
  if (states.includes('WITHIN_TOLERANCE')) return 'WITHIN_TOLERANCE';
  if (states.length && states.every(state => state === 'NOT_APPLICABLE')) return 'NOT_APPLICABLE';
  return 'MATCHED';
}

/**
 * RULE 18 — deterministic invoice arithmetic and receipt-balance checks.
 * In Finance advisory mode (default), only invoice-internal arithmetic errors block;
 * reference-data gaps (missing lines, unpopulated NextGen quantities, MPO-line control)
 * warn through a visible advisory result without blocking the workflow.
 */
function buildFinanceValidationResult(invoice: any): ValidationResult {
  const issues = validateFinanceArithmetic(invoice);
  if (issues.length === 0) {
    return { passed: true, message: 'Invoice line quantities and amounts reconcile' };
  }
  const policy = getFinancePolicy();
  const blocking = issues.filter(issue => financeIssueIsBlocking(issue, policy.enforcementMode));
  if (blocking.length === 0) {
    return {
      passed: true,
      advisory: true,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Finance reconciliation advisory — does not block',
      detail: issues.map(issue => issue.detail).join(' | '),
    };
  }
  return {
    passed: false,
    reason: ExceptionReason.AMOUNT_MISMATCH,
    message: 'Invoice quantity or amount reconciliation failed',
    detail: blocking.map(issue => issue.detail).join(' | '),
  };
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
    { fn: () => buildFinanceValidationResult(invoice), reason: ExceptionReason.AMOUNT_MISMATCH },
    { fn: async () => validateVendorThreshold(invoice), reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED },
  ];

  for (const rule of rules) {
    const result: ValidationResult = await Promise.resolve(rule.fn());
    results.push(result);
    if (!result.passed) {
      exceptions.push({ reason: result.reason || rule.reason, detail: result.detail || '' });
    } else if (result.reason) {
      // Warning-only result (e.g., vendor threshold): create exception for visibility but don't block
      exceptions.push({ reason: result.reason, detail: result.detail || '' });
    }
  }

  const passed = results.every(r => r.passed);
  return {
    invoice_id: invoice.id || 'mock',
    passed,
    state: overallValidationState(results),
    results: canonicalize(results),
    exceptions,
  };
}

export async function validateInvoice(
  invoiceId: string,
  options?: { skipAutoAdvance?: boolean }
): Promise<InvoiceValidationResult> {
  if (!isDbEnabled()) {
    throw new AppError('Database not available', 500);
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      signatures: true,
      invoice_lines: true,
    },
  });

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  // Prevent re-validation of invoices that are already in the approval chain or beyond
  const lockedStatuses = [
    InvoiceStatus.PENDING_COORDINATOR,
    InvoiceStatus.PENDING_MANAGER,
    InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
    InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
    InvoiceStatus.PENDING_SR_MANAGER,
    InvoiceStatus.PENDING_POLLY,
    InvoiceStatus.PENDING_ACCOUNTING,
    InvoiceStatus.APPROVED,
    InvoiceStatus.POSTED_TO_QB,
    InvoiceStatus.PAYMENT_SCHEDULED,
    InvoiceStatus.PAID,
    InvoiceStatus.PAYMENT_CONFIRMATION_SENT,
    InvoiceStatus.REJECTED,
  ];
  if (lockedStatuses.includes(invoice.status as InvoiceStatus)) {
    throw new AppError(`Cannot re-validate invoice in status ${invoice.status}. Invoice is already in the approval workflow or has been finalized.`, 400);
  }

  // Clear previous pending exceptions before re-running validation so edits can be validated cleanly
  await prisma.exception.deleteMany({
    where: {
      invoice_id: invoiceId,
      status: 'PENDING' as any,
    },
  });

  // Both waived and resolved reasons are explicitly accepted by a coordinator.
  // Re-creating them would cause an infinite resolve → revalidate → re-create loop.
  // The coordinator said "I accept this" (waive) or "I fixed it" (resolve) — trust them.
  const previouslyHandled = await prisma.exception.findMany({
    where: {
      invoice_id: invoiceId,
      status: { in: ['WAIVED', 'RESOLVED'] as any },
    },
    select: { reason: true },
  });
  const waivedReasons = new Set(previouslyHandled.map(e => e.reason as string));

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

  // RULE 17 — MPO cross-check via NextGen (amount, quantity, vendor)
  const poResult = await validatePOAgainstNextGen(invoice);
  results.push(poResult);
  if (!poResult.passed) {
    exceptions.push({ reason: poResult.reason || ExceptionReason.PO_NOT_FOUND, detail: poResult.detail || '' });
  }

  // RULE 18 — deterministic invoice arithmetic and receipt-balance checks.
  const financeResult = buildFinanceValidationResult(invoice);
  results.push(financeResult);
  if (!financeResult.passed) {
    exceptions.push({ reason: ExceptionReason.AMOUNT_MISMATCH, detail: financeResult.detail || '' });
  } else if (financeResult.reason) {
    exceptions.push({ reason: financeResult.reason, detail: financeResult.detail || '' });
  }

  // RULE 19 — Vendor threshold exceeded (WARNING ONLY — does not block)
  const vendorThresholdResult = await validateVendorThreshold(invoice);
  results.push(vendorThresholdResult);
  if (!vendorThresholdResult.passed) {
    exceptions.push({ reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED, detail: vendorThresholdResult.detail || '' });
  } else if (vendorThresholdResult.reason) {
    // Warning-only result: create exception for visibility but don't block
    exceptions.push({ reason: vendorThresholdResult.reason, detail: vendorThresholdResult.detail || '' });
  }

  const passed = results.every(r => r.passed);

  // Present every problem for a reason in one exception instead of revealing
  // same-category failures one at a time across repeated validation cycles.
  const consolidatedExceptions = Array.from(
    exceptions.reduce((byReason, exception) => {
      const reason = exception.reason as string;
      const existing = byReason.get(reason);
      if (existing) {
        if (exception.detail && !existing.details.includes(exception.detail)) {
          existing.details.push(exception.detail);
        }
      } else {
        byReason.set(reason, {
          reason: exception.reason,
          details: exception.detail ? [exception.detail] : [],
        });
      }
      return byReason;
    }, new Map<string, { reason: ExceptionReason; details: string[] }>()).values()
  ).map(exception => ({
    reason: exception.reason,
    detail: exception.details.join(' | '),
  }));
  // Infrastructure/source-of-truth failures are never waivable. A user may
  // resolve a business discrepancy, but cannot attest that a check ran when it
  // did not run.
  const nonWaivableReasons = new Set(
    results
      .filter(result => result.code === 'NEXTGEN_UNAVAILABLE' || result.code === 'VALIDATION_UNAVAILABLE')
      .map(result => result.reason as string)
      .filter(Boolean)
  );
  const newExceptions = consolidatedExceptions.filter(
    exception => nonWaivableReasons.has(exception.reason as string)
      || !waivedReasons.has(exception.reason as string)
  );
  const { blocking: blockingNewExceptions } = splitBlockingExceptions(newExceptions, results, nonWaivableReasons);

  if (newExceptions.length > 0) {
    for (const exc of newExceptions) {
      await prisma.exception.create({
        data: {
          invoice_id: invoiceId,
          reason: exc.reason as any,
          detail: exc.detail,
        },
      });
    }

    if (blockingNewExceptions.length > 0) {
      // Update invoice status to EXCEPTION_FLAGGED
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
      });
    } else {
      // Advisory-only (Finance advisory mode): exceptions are visible for reporting
      // but do not block — the invoice advances exactly like the all-handled branch.
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.VALIDATION_PENDING as any },
      });
      if (!options?.skipAutoAdvance) {
        try {
          await createApprovalRequest(invoiceId, 'system', { fromExceptionResolution: true });
        } catch (error) {
          logger.error('Failed to create approval request after advisory exceptions:', error);
        }
      }
    }
  } else if (consolidatedExceptions.length > 0 && newExceptions.length === 0) {
    // All currently failing reasons were explicitly waived.
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VALIDATION_PENDING as any },
    });

    // A waiver is an explicit acceptance of the failing rule, so continue the
    // same approval routing used by a clean validation result — unless the
    // caller asked us to hold for an explicit coordinator approval (resolve flow).
    if (!options?.skipAutoAdvance) {
      try {
        await createApprovalRequest(invoiceId, 'system', { fromExceptionResolution: true });
      } catch (error) {
        logger.error('Failed to create approval request after waived validation exceptions:', error);
      }
    }
  } else {
    // Purchasing never places invoices ON_HOLD. Threshold holds belong to the
    // Accounting/payment stage; clean validation proceeds to approval.
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VALIDATION_PENDING as any },
    });

    if (!options?.skipAutoAdvance) {
      try {
        await createApprovalRequest(invoiceId, 'system', { fromExceptionResolution: true });
      } catch (error) {
        logger.error('Failed to create approval request:', error);
      }
    }
  }

  const finalState = overallValidationState(results);
  try {
    const stored = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { po_validation: true } });
    const response = stored?.po_validation as any;
    await retainValidationSnapshot({
      invoiceId,
      invoiceRevision: invoice.revision,
      state: finalState,
      rules: canonicalize(results),
      request: {
        invoice_id: invoiceId,
        revision: invoice.revision,
        vendor_id: invoice.vendor_id,
        mpo_number: invoice.mpo_number,
        lines: invoice.invoice_lines.map((line: any) => ({
          line_number: line.line_number,
          mpo_base_number: line.mpo_base_number,
          mpo_order_sequence: line.mpo_order_sequence,
          material_code: line.material_code,
          quantity: line.quantity,
          unit_price: line.unit_price,
          line_amount: line.line_amount,
        })),
      },
      response,
      vendorIdInvoice: invoice.vendor_id,
      vendorIdSource: response?.nextgen_data?.vendor_id || response?.vendor_id || null,
    });
  } catch (snapshotError) {
    logger.error('Validation evidence snapshot could not be retained:', snapshotError);
    if (process.env.REQUIRE_VALIDATION_SNAPSHOT === 'true') {
      throw new AppError('Validation completed but evidence retention failed; invoice was not advanced.', 503);
    }
  }

  return {
    invoice_id: invoiceId,
    passed,
    state: finalState,
    results: canonicalize(results),
    exceptions,
    allExceptionsHandled: consolidatedExceptions.length > 0 && newExceptions.length === 0,
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
  const invoiceBank = {
    swift_code: invoice.swift_code || ocrBankInfo?.swift_code || '',
    account_number: invoice.account_number || ocrBankInfo?.account_number || '',
    bank_name: invoice.bank_name || ocrBankInfo?.bank_name || '',
  };

  // Use vendor bank details as primary source
  const vendorSwift = invoice.vendor.swift_code || '';
  const vendorAccount = invoice.vendor.account_number || '';

  // If vendor bank details are missing, fall back to invoice-level bank data extracted from OCR
  if (!vendorSwift || !vendorAccount) {
    if (invoiceBank.swift_code && invoiceBank.account_number) {
      return {
        passed: true,
        message: 'Invoice bank details extracted from OCR; vendor bank details not required',
      };
    }
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Bank details missing',
      detail: 'Vendor bank details are incomplete and no bank information was extracted from the invoice',
    };
  }

  // If OCR didn't extract bank info, allow workflow to proceed because vendor has bank details on file.
  if (!ocrBankInfo || !invoiceBank.swift_code || !invoiceBank.account_number) {
    return {
      passed: true,
      message: 'Vendor bank details on file; OCR bank extraction not required',
    };
  }

  // Compare with vendor records
  // Normalize SWIFT codes for comparison
  const normalizeSwift = (swift: string) => swift.toUpperCase().replace(/\s/g, '').replace(/X+$/, '');
  const ocrSwiftNormalized = normalizeSwift(invoiceBank.swift_code || '');
  const vendorSwiftNormalized = normalizeSwift(vendorSwift || '');

  // Compare SWIFT codes — allow 1-character OCR typo tolerance
  if (vendorSwift && ocrSwiftNormalized && vendorSwiftNormalized !== ocrSwiftNormalized) {
    // Check Levenshtein distance for 1-char OCR typo (e.g. CITIVVXHCM vs CITIVNVXHCM)
    const swiftDist = levenshtein(ocrSwiftNormalized, vendorSwiftNormalized);
    if (swiftDist > 1) {
      return {
        passed: false,
        reason: ExceptionReason.BANK_DETAIL_MISMATCH,
        message: 'SWIFT code does not match vendor records',
        detail: `OCR SWIFT: "${invoiceBank.swift_code}" vs Vendor SWIFT: "${vendorSwift}"`,
      };
    }
    // 1-char difference — likely OCR typo, accept as match
  }

  // Compare account numbers (normalize by removing spaces, dashes, and leading zeros)
  const normalizeAccount = (account: string) => account.replace(/[\s-]/g, '').replace(/^0+/, '');
  const ocrAccountNormalized = normalizeAccount(invoiceBank.account_number || '');
  const vendorAccountNormalized = normalizeAccount(vendorAccount || '');

  if (vendorAccount && ocrAccountNormalized && vendorAccountNormalized !== ocrAccountNormalized) {
    // Check if one account is a subset of the other (e.g. OCR extracted partial account number)
    const shorter = ocrAccountNormalized.length <= vendorAccountNormalized.length ? ocrAccountNormalized : vendorAccountNormalized;
    const longer = ocrAccountNormalized.length <= vendorAccountNormalized.length ? vendorAccountNormalized : ocrAccountNormalized;
    if (longer.includes(shorter)) {
      // Partial match — OCR likely extracted a subset of the full account number
      // This is acceptable, not a real mismatch
    } else {
      return {
        passed: false,
        reason: ExceptionReason.BANK_DETAIL_MISMATCH,
        message: 'Account number does not match vendor records',
        detail: `OCR Account: "${invoiceBank.account_number}" vs Vendor Account: "${vendorAccount}"`,
      };
    }
  }

  // Compare bank name (fuzzy match — OCR may abbreviate)
  const vendorBankName = invoice.vendor.bank_name || '';
  if (vendorBankName && invoiceBank.bank_name) {
    const normalizeBankName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const vendorBankNorm = normalizeBankName(vendorBankName);
    const ocrBankNorm = normalizeBankName(invoiceBank.bank_name);
    // Check if one contains the other (fuzzy match for abbreviations)
    if (vendorBankNorm && ocrBankNorm && vendorBankNorm.length > 3 && ocrBankNorm.length > 3) {
      const isMatch = vendorBankNorm.includes(ocrBankNorm) || ocrBankNorm.includes(vendorBankNorm)
        || (vendorBankNorm.substring(0, 10) === ocrBankNorm.substring(0, 10));
      if (!isMatch) {
        return {
          passed: false,
          reason: ExceptionReason.BANK_DETAIL_MISMATCH,
          message: 'Bank name does not match vendor records',
          detail: `OCR Bank: "${invoiceBank.bank_name}" vs Vendor Bank: "${vendorBankName}"`,
        };
      }
    }
  }

  // Compare beneficiary name if OCR extracted it
  const ocrBeneficiary = (invoice as any).ocr_raw_data?.bank_info?.beneficiary_name || (invoice as any).beneficiary_name || '';
  const vendorBeneficiary = invoice.vendor.beneficiary_name || '';
  if (vendorBeneficiary && ocrBeneficiary) {
    const normalizeName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const vendorBenNorm = normalizeName(vendorBeneficiary);
    const ocrBenNorm = normalizeName(ocrBeneficiary);
    if (vendorBenNorm && ocrBenNorm && vendorBenNorm.length > 3 && ocrBenNorm.length > 3) {
      const isMatch = vendorBenNorm.includes(ocrBenNorm) || ocrBenNorm.includes(vendorBenNorm)
        || (vendorBenNorm.substring(0, 15) === ocrBenNorm.substring(0, 15));
      if (!isMatch) {
        return {
          passed: false,
          reason: ExceptionReason.BANK_DETAIL_MISMATCH,
          message: 'Beneficiary name does not match vendor records',
          detail: `OCR Beneficiary: "${ocrBeneficiary}" vs Vendor Beneficiary: "${vendorBeneficiary}"`,
        };
      }
    }
  }

  return {
    passed: true,
    message: 'Bank details match vendor records',
  };
}

// RULE 10 — Signature validation (3-tier per new flow)
// Uses centralized SIGNATURE_REQUIREMENTS from validation-rules.ts as single source of truth.
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

  // Filter out OCR-detected PDF signatures — they don't count as workflow approvals
  const workflowSignatures = signatures?.filter((sig: any) => !sig.ocr_detected) || [];

  // Digital workflow: if no workflow signatures exist yet (all OCR or none),
  // skip validation so the invoice can proceed to approval request.
  if (workflowSignatures.length === 0) {
    return {
      passed: true,
      message: 'Digital workflow - signatures will be collected during approval',
    };
  }

  // Count signed workflow signatures
  const signedSignatures = workflowSignatures.filter((sig: any) => sig.signed_at) || [];
  const signedRoles = signedSignatures.map((sig: any) => sig.signatory_role as string);

  const tier = determineApprovalTier(amount);
  const requiredRoles = getRequiredSignatoryRoles(tier);

  // Check each required role from the centralized config
  for (const role of requiredRoles) {
    if (!signedRoles.includes(role)) {
      const roleLabels: Record<string, string> = {
        [SignatoryRole.COORDINATOR]: 'Coordinator',
        [SignatoryRole.PURCHASING_MANAGER]: 'Purchasing Manager',
        [SignatoryRole.MLO_ACCOUNT_HOLDER]: 'MLO Account Holder',
        [SignatoryRole.MLO_PLANNING_MANAGER]: 'MLO Planning Manager',
        [SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION]: 'Sr. Manager Global Production',
        [SignatoryRole.MS_POLLY]: 'Ms. Polly',
      };
      const tierLabels: Record<number, string> = {
        1: 'all invoices',
        2: 'invoices above $2,000',
        3: 'invoices above $100,000',
      };
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: `Missing ${roleLabels[role] || role} signature`,
        detail: `A ${roleLabels[role] || role} signature is required for ${tierLabels[tier] || 'this tier'}`,
      };
    }
  }

  return {
    passed: true,
    message: 'Signature requirements met',
  };
}

// RULE 11 — Duplicate detection (delegates to duplicateDetectionService)
async function checkDuplicateInvoice(invoice: any): Promise<ValidationResult> {
  if (!isDbEnabled()) {
    return {
      passed: false,
      reason: ExceptionReason.DUPLICATE_INVOICE,
      code: 'VALIDATION_UNAVAILABLE',
      message: 'Duplicate validation unavailable',
      detail: 'The duplicate check could not run because the database is unavailable. Retry validation before approval.',
    };
  }

  try {
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : new Date();
    const result = await checkDuplicateDetailed(
      invoice.invoice_number,
      invoice.vendor_id || '',
      Number(invoice.total_amount),
      invoiceDate,
      invoice.id,
      {
        invoice_type: invoice.invoice_type,
        mpo_base_number: invoice.mpo_base_number,
        mpo_order_sequence: invoice.mpo_order_sequence,
        material_code: invoice.material_code,
      }
    );

    if (result.is_duplicate) {
      const detail = result.fuzzy_match_details
        ? `${result.fuzzy_match_details.match_reason} (existing invoice: ${result.existing_invoice_number || 'unknown'})`
        : `Duplicate invoice detected (type: ${result.duplicate_type})`;

      return {
        passed: false,
        reason: ExceptionReason.DUPLICATE_INVOICE,
        message: `Duplicate invoice detected — ${result.duplicate_type || 'EXACT'}${result.risk_level ? ` (risk: ${result.risk_level})` : ''}`,
        detail,
      };
    }

    // Not a duplicate, but flag if same invoice number has different MPO (multiple MPO single invoice)
    if (result.is_multiple_mpo_single_invoice) {
      return {
        passed: true,
        message: 'Same invoice number exists with a different MPO — treated as separate invoice (multiple MPO single invoice)',
      };
    }

    return {
      passed: true,
      message: 'No duplicate invoice found',
    };
  } catch (error) {
    logger.error('Duplicate check failed:', error);
    return {
      passed: false,
      reason: ExceptionReason.DUPLICATE_INVOICE,
      code: 'VALIDATION_UNAVAILABLE',
      message: 'Duplicate validation unavailable',
      detail: 'The duplicate check failed. Retry validation before approval.',
    };
  }
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

  // Guard against invalid/parsed dates (e.g. null or epoch 0 = 1970-01-01)
  if (isNaN(invoiceDate.getTime()) || invoiceDate.getFullYear() < 2000) {
    return {
      passed: true,
      message: 'Invoice date invalid or missing — late submission check skipped',
    };
  }
  if (isNaN(receivedDate.getTime()) || receivedDate.getFullYear() < 2000) {
    return {
      passed: true,
      message: 'Received date invalid or missing — late submission check skipped',
    };
  }

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

  // Check if vendor has SWIFT code and account number
  const hasVendorBank = invoice.vendor.swift_code && invoice.vendor.account_number;
  const hasInvoiceBank = (invoice.swift_code || invoice.ocr_raw_data?.bank_info?.swift_code) &&
                         (invoice.account_number || invoice.ocr_raw_data?.bank_info?.account_number);

  if (!hasVendorBank && !hasInvoiceBank) {
    if (!invoice.vendor.swift_code) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_BANK_INFO,
        message: 'Vendor missing SWIFT code',
        detail: `Vendor "${invoice.vendor.name}" does not have SWIFT code on file and none was extracted from the invoice`,
      };
    }
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Vendor missing account number',
      detail: `Vendor "${invoice.vendor.name}" does not have account number on file and none was extracted from the invoice`,
    };
  }

  return {
    passed: true,
    message: hasInvoiceBank && !hasVendorBank
      ? 'Invoice bank information extracted from OCR is complete'
      : 'Vendor bank information is complete',
  };
}

// RULE 17 — MPO cross-check via NextGen (fetch-only)
// FIX 4: Only validate if MPO matches. If MPO mismatch → skip validation, do not compare vendor/brand.
async function validatePOAgainstNextGen(invoice: any): Promise<ValidationResult> {
  // STATEMENT type — skip PO amount matching entirely.
  // Monthly statements aggregate multiple periods and won't match a single PO.
  if (invoice.invoice_type === 'STATEMENT') {
    return {
      passed: true,
      code: 'NOT_APPLICABLE',
      message: 'Statement type — amount variance check skipped. Manual reconciliation required for monthly statement totals.',
    };
  }

  const poRef = invoice.mpo_number;

  // No MPO reference on invoice.
  if (!poRef) {
    // Non-PO categories (samples, freight, testing, professional fees, …) never
    // require an MPO — they take the separate non-PO Finance approval path.
    if (isNonPOCategory(invoice.category)) {
      return {
        passed: true,
        code: 'NOT_APPLICABLE',
        message: 'Non-PO category — MPO/NextGen validation not applicable',
        detail: `Category ${invoice.category} does not require an MPO. Manual Finance review applies before payment.`,
      };
    }
    // Advisory mode (default): pre-existing production invoices without an MPO
    // (legacy TRIMS/YARN records) proceed with a visible warning instead of a hard
    // block. Finance can flip FINANCE_ENFORCEMENT_MODE=strict to restore the gate.
    if (getFinancePolicy().enforcementMode === 'advisory') {
      return {
        passed: true,
        advisory: true,
        code: 'NOT_APPLICABLE',
        reason: ExceptionReason.MISSING_PO_REFERENCE,
        message: 'MPO reference missing — NextGen validation deferred (advisory)',
        detail: 'No MPO on file. Finance review is required before payment; validation does not block the workflow.',
      };
    }
    return {
      passed: false,
      reason: ExceptionReason.MISSING_PO_REFERENCE,
      message: 'MPO reference is required for NextGen validation',
      detail: 'Enter the invoice MPO before requesting approval.',
    };
  }

  const rawData = (invoice as any).ocr_raw_data || (invoice as any).raw_data || {};
  const parsedMpo = parseMPOReference(invoice.mpo_number);
  const baseMpo = invoice.mpo_base_number || parsedMpo.baseMpo || invoice.mpo_number;
  const orderSequence = invoice.mpo_order_sequence || parsedMpo.orderSequence || rawData.mpo_order_sequence;
  const materialCode = invoice.material_code || parsedMpo.materialCode || rawData.material_code;
  const materialName = invoice.material_name || rawData.material_name;

  try {
    // Fetch PO from NextGen with 10s timeout — skip if NextGen is slow/down
    let po: any = null;
    try {
      po = await Promise.race([
        nextGenService.fetchPOByMPO(baseMpo, {
          vendor_name: invoice.vendor?.name,
          amount: Number(invoice.total_amount),
          material_code: materialCode,
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('NEXTGEN_TIMEOUT_10s')), 10000)
        ),
      ]);
    } catch (timeoutErr: any) {
      logger.warn(`[Validation] NextGen timeout/error for MPO ${baseMpo}: ${timeoutErr.message} — blocking until retry`);
      return {
        passed: false,
        reason: ExceptionReason.PO_NOT_FOUND,
        code: 'NEXTGEN_UNAVAILABLE',
        message: `NextGen unavailable — MPO ${poRef} was not verified`,
        detail: 'Retry validation when NextGen is available. This invoice cannot proceed while the check is unavailable.',
      };
    }

    // Fallback: If PO not found by MPO/PO number, try searching by material name
    if (!po && materialName) {
      console.log(`[Validation] PO not found by MPO/PO number, trying material name search: "${materialName}"`);
      const materialMatches = await nextGenService.searchMPOByMaterialName(materialName, {
        vendor_name: invoice.vendor?.name,
        amount: Number(invoice.total_amount),
      });
      if (materialMatches.length > 0) {
        po = materialMatches[0]; // Best match (highest score)
        console.log(`[Validation] PO found via material name search: ${po.mpo_number} (amount: ${po.amount})`);
      }
    }

    // If MPO not found, keep the invoice in a pending PO state instead of silently skipping.
    // The user can re-validate once the MPO is added to NextGen.
    if (!po) {
      return {
        passed: false,
        reason: ExceptionReason.PO_NOT_FOUND,
        message: `MPO ${poRef} not found in NextGen`,
        detail: `Referenced MPO ${poRef} could not be found in NextGen. The system will keep checking; re-validate once the MPO is available.`,
      };
    }

    if (po.line_items_available === false) {
      return {
        passed: false,
        reason: ExceptionReason.PO_NOT_FOUND,
        code: 'NEXTGEN_UNAVAILABLE',
        message: 'NEXTGEN_UNAVAILABLE: MPO line data could not be retrieved',
        detail: `NextGen found ${baseMpo}, but both line-item endpoints were unavailable. Quantity, price, and amount validation was deferred for retry/manual review.`,
      };
    }

    // Auto-fill the invoice's material from the MPO line list when the invoice
    // has an MPO but no material (code or name). Never breaks the validation.
    if (!invoice.material_code && !invoice.material_name && Array.isArray(po.line_items)) {
      try {
        await autoFillMaterialFromNextGen(invoice, po.line_items);
      } catch (fillErr: any) {
        logger.warn(`[Validation] material auto-fill failed for ${poRef}: ${fillErr?.message || 'unknown error'}`);
      }
    }

    // Resolve and persist every DB invoice line independently. This is the
    // authoritative multi-MPO path: a header match can never satisfy another
    // MPO line, and cumulative balances are derived from prior AP invoices.
    const lineControlDifferences: string[] = [];
    const dbInvoiceLines = Array.isArray((invoice as any).invoice_lines) ? (invoice as any).invoice_lines : [];
    const poByBaseMpo = new Map<string, any>([[String(baseMpo).trim().toUpperCase(), po]]);
    for (const invLine of dbInvoiceLines) {
      const lineNumber = Number(invLine.line_number || 0);
      const lineBaseMpo = String(invLine.mpo_base_number || baseMpo || '').trim();
      const lineSequence = invLine.mpo_order_sequence || undefined;
      const lineMaterial = invLine.material_code || undefined;
      const lineMaterialName = invLine.material_name || undefined;
      // Require Base MPO (can fallback to header) and at least one material identifier.
      // order_sequence and material_code are often not on the invoice — try matching
      // by material_name alone before flagging as a difference.
      if (!lineBaseMpo || (!lineMaterial && !lineMaterialName)) {
        lineControlDifferences.push(`Line ${lineNumber}: Base MPO and material (code or name) are required.`);
        continue;
      }
      const cacheKey = lineBaseMpo.toUpperCase();
      let linePo = poByBaseMpo.get(cacheKey);
      if (!linePo) {
        linePo = await nextGenService.fetchPOByMPO(lineBaseMpo, {
          vendor_name: invoice.vendor?.name,
          material_code: lineMaterial,
        });
        if (linePo) poByBaseMpo.set(cacheKey, linePo);
      }
      if (!linePo || linePo.line_items_available === false) {
        lineControlDifferences.push(`Line ${lineNumber}: NextGen MPO ${lineBaseMpo} is unavailable.`);
        continue;
      }
      const lineResolution = matchMPOLines(linePo.line_items || [], {
        orderSequence: lineSequence,
        materialCode: lineMaterial,
        materialName: invLine.material_name || lineMaterialName,
      });
      if (lineResolution.error || lineResolution.lines.length === 0) {
        lineControlDifferences.push(`Line ${lineNumber}: NextGen match was not found for ${lineBaseMpo}/${lineSequence || '-'}/${lineMaterial || lineMaterialName || '-'}.`);
        continue;
      }
      if (lineResolution.lines.length > 1) {
        // Ambiguous match — don't block, just skip line-level reconciliation for this line
        continue;
      }
      const matched = lineResolution.lines[0];
      const prior = await prisma.invoiceLine.aggregate({
        where: {
          id: { not: invLine.id },
          mpo_base_number: lineBaseMpo,
          mpo_order_sequence: String(lineSequence),
          material_code: String(lineMaterial),
          invoice: { status: { notIn: [InvoiceStatus.REJECTED] as any } },
        },
        _sum: { quantity: true, line_amount: true },
      });
      const priorQuantity = Number(prior._sum.quantity || 0);
      const priorAmount = Number(prior._sum.line_amount || 0);
      // Only treat NextGen receipt data as known when it actually provided a value.
      // Writing 0 for a missing field would fabricate an over-received/over-remaining
      // mismatch on every unverified line (NextGen write-back is not yet wired).
      const receivedSource = matched.received_quantity ?? matched.quantity;
      const receivedKnown = receivedSource !== null && receivedSource !== undefined
        && Number.isFinite(Number(receivedSource));
      const acceptedQuantity = receivedKnown ? Number(receivedSource) : null;
      const poLineAmount = Number(matched.total_amount || 0);
      const remainingQuantity = receivedKnown ? Math.max(0, (acceptedQuantity as number) - priorQuantity) : null;
      const remainingAmount = receivedKnown ? Math.max(0, poLineAmount - priorAmount) : null;
      const quantity = Number(invLine.quantity || 0);
      const lineAmount = Number(invLine.line_amount || 0);
      const policy = getFinancePolicy();
      const priceMatches = Math.abs(Number(invLine.unit_price || 0) - Number(matched.unit_price || 0)) <= policy.lineRoundingTolerance;
      const balanceMatches = !receivedKnown
        || (quantity <= (remainingQuantity as number) && lineAmount <= (remainingAmount as number) + policy.lineRoundingTolerance);
      const matchStatus = priceMatches && balanceMatches ? 'MATCHED' : 'MISMATCH';
      await prisma.invoiceLine.update({
        where: { id: invLine.id },
        data: {
          matched_nextgen_line_id: String(matched.line_id || matched.line_reference || ''),
          match_level: lineResolution.matchLevel,
          match_status: matchStatus,
          match_confidence: 1,
          unit_of_measure: invLine.unit_of_measure || matched.purchase_uom || null,
          nextgen_unit_of_measure: matched.purchase_uom || null,
          nextgen_unit_price: Number(matched.unit_price || 0),
          received_quantity: receivedKnown ? Number(receivedSource) : null,
          accepted_quantity: acceptedQuantity,
          previously_invoiced_quantity: priorQuantity,
          remaining_receivable_quantity: remainingQuantity,
          previously_invoiced_amount: priorAmount,
          remaining_invoiceable_amount: remainingAmount,
        },
      });
      if (matchStatus !== 'MATCHED') {
        lineControlDifferences.push(`Line ${lineNumber}: quantity, price, or amount exceeds the exact NextGen remaining balance.`);
      }
    }

    // Compare the most specific target available. A material invoice must not
    // be compared against the total of every line under the MPO.
    const differences: string[] = [...lineControlDifferences];
    const requestedMaterialCode = String(materialCode || '').trim().toUpperCase();
    const requestedMaterialName = String(materialName || '').trim().toUpperCase();
    let targetLines = po.line_items || [];
    let matchLevel = 'MPO_HEADER';
    if (orderSequence || requestedMaterialCode || requestedMaterialName) {
      const resolution = matchMPOLines(targetLines, {
        orderSequence,
        materialCode: requestedMaterialCode,
        materialName: requestedMaterialName,
      });
      if (resolution.error) {
        const target = [orderSequence ? `line ${orderSequence}` : '', requestedMaterialCode || requestedMaterialName]
          .filter(Boolean).join(' / ');
        return {
          passed: false,
          reason: ExceptionReason.PO_NOT_FOUND,
          message: `${target || 'Requested line'} not found under ${baseMpo}`,
          detail: resolution.error === 'AMBIGUOUS_MATERIAL'
            ? 'More than one MPO line matches the material. Select the correct line reference manually.'
            : `The base MPO exists, but the requested ${resolution.error === 'LINE_NOT_FOUND' ? 'line reference' : 'material'} was not found. Manual purchasing validation is required.`,
        };
      }
      targetLines = resolution.lines;
      matchLevel = resolution.matchLevel;
    }

    // FALLBACK: If still at MPO_HEADER level, try matching using invoice line items from DB.
    // This handles cases where the invoice header doesn't have material_code/material_name
    // but the InvoiceLine records do (e.g., from OCR line item extraction).
    let matchedInvoiceLineAmount = 0; // sum of invoice line amounts that matched a PO line
    let matchedInvoiceLineQty = 0;   // sum of invoice line quantities that matched a PO line
    if (matchLevel === 'MPO_HEADER' && targetLines.length > 1) {
      // Gather line items from both DB InvoiceLine records and ocr_raw_data JSON
      const dbLines = (invoice as any).invoice_lines || (invoice as any).line_items || [];
      const rawLineItems = Array.isArray(rawData.line_items) ? rawData.line_items : [];
      const invoiceLines = [...dbLines, ...rawLineItems];
      if (invoiceLines.length > 0) {
        // Try matching each invoice line to a PO line by material code
        const matchedPoLines: any[] = [];
        for (const invLine of invoiceLines) {
          const lineMaterialCode = String(invLine.material_code || invLine.item_code || invLine.sku || '').trim().toUpperCase();
          const lineMaterialName = String(invLine.material_name || invLine.description || '').trim().toUpperCase();
          const lineQty = Number(invLine.quantity || 0);
          const lineAmount = Number(invLine.line_amount || invLine.total_amount || 0);
          if (lineMaterialCode || lineMaterialName) {
            const lineResolution = matchMPOLines(targetLines, {
              materialCode: lineMaterialCode,
              materialName: lineMaterialName,
            });

            if (lineResolution.error === 'AMBIGUOUS_MATERIAL' && lineResolution.lines.length > 1) {
              // Disambiguate by quantity or amount match
              const disambiguated = lineResolution.lines.find((poLine: any) => {
                const poQty = Number(poLine.quantity || 0);
                const poAmount = Number(poLine.total_amount || 0);
                if (lineQty > 0 && poQty > 0 && lineQty === poQty) return true;
                if (lineAmount > 0 && poAmount > 0 && Math.abs(lineAmount - poAmount) < 0.01) return true;
                return false;
              });
              if (disambiguated) {
                if (!matchedPoLines.find(l => l.line_id === disambiguated.line_id)) {
                  matchedPoLines.push(disambiguated);
                  matchedInvoiceLineAmount += lineAmount;
                  matchedInvoiceLineQty += lineQty;
                }
                continue;
              }
            }

            if (!lineResolution.error && lineResolution.lines.length > 0) {
              // Match found — add the PO line(s) to our target
              for (const matchedLine of lineResolution.lines) {
                if (!matchedPoLines.find(l => l.line_id === matchedLine.line_id)) {
                  matchedPoLines.push(matchedLine);
                  matchedInvoiceLineAmount += lineAmount;
                  matchedInvoiceLineQty += lineQty;
                }
              }
            }
          }
        }
        if (matchedPoLines.length > 0) {
          targetLines = matchedPoLines;
          matchLevel = 'MATERIAL_LINE';
          console.log(`[Validation] Line-level match found via invoice line items: ${matchedPoLines.length} PO line(s) matched, matched invoice line amount: $${matchedInvoiceLineAmount.toFixed(2)}`);
        }
      }
    }

    // Amount check using the Finance-owned tolerance policy.
    // Subtract all charges from invoice total to get the net goods amount for PO comparison
    const poAmount = matchLevel !== 'MPO_HEADER'
      ? targetLines.reduce((sum: number, li: any) => sum + Number(li.total_amount || 0), 0)
      : Number(po.amount);
    const invoiceTotal = Number(invoice.total_amount);
    const bankCharges = Number(invoice.bank_charges || 0);
    const ttCharge = Number((invoice as any).tt_charge || 0);
    const freightCharges = Number(invoice.freight_charges || 0);
    const courierCharges = Number((invoice as any).courier_charges || 0);
    const handlingFee = Number((invoice as any).handling_fee || 0);
    const financeSurcharge = Number((invoice as any).finance_surcharge || 0);
    const setupCharge = Number((invoice as any).setup_charge || 0);
    const sampleCharge = Number((invoice as any).sample_charge || 0);
    const minOrderCharge = Number((invoice as any).min_order_charge || 0);
    const additionalCharges = Number(invoice.additional_charges || 0);
    const discountAmount = Number(invoice.discount_amount || 0);

    const totalCharges = bankCharges + ttCharge + freightCharges + courierCharges + handlingFee
      + financeSurcharge + setupCharge + sampleCharge + minOrderCharge + additionalCharges;
    // When charge fields are not populated, totalCharges will be 0 and netInvoiceAmount
    // equals the gross total. Fall back to sum of invoice line amounts (goods subtotal)
    // which is the correct comparison against PO amount.
    const lineAmountSum = (Array.isArray((invoice as any).invoice_lines) ? (invoice as any).invoice_lines : [])
      .reduce((sum: number, line: any) => sum + Number(line.line_amount || 0), 0);
    const netInvoiceAmount = totalCharges > 0
      ? (invoiceTotal - totalCharges + discountAmount)
      : (lineAmountSum > 0 ? lineAmountSum : invoiceTotal);

    // When line-level matching found only SOME invoice lines matching PO lines,
    // compare the matched invoice line amounts against the matched PO line amounts
    // instead of the full invoice total against only the matched PO lines.
    const comparisonAmount = (matchLevel === 'MATERIAL_LINE' && matchedInvoiceLineAmount > 0)
      ? matchedInvoiceLineAmount
      : netInvoiceAmount;

    if (poAmount > 0) {
      // Compare net invoice amount (minus charges) against PO amount
      const variance = Math.abs(comparisonAmount - poAmount) / poAmount;
      const financePolicy = getFinancePolicy();
      const absoluteDifference = Math.abs(comparisonAmount - poAmount);
      // Also check gross (invoice total without subtracting charges) — if the
      // gross amount is within tolerance, the charge subtraction was creating a
      // false positive (e.g. invoice $416.89 vs PO $420 = 0.74% but net $356.89 = 15%)
      const grossVariance = Math.abs(invoiceTotal - poAmount) / poAmount;
      const grossAbsDiff = Math.abs(invoiceTotal - poAmount);
      const grossWithinTolerance = grossAbsDiff <= financePolicy.invoiceRoundingTolerance
        || grossVariance <= financePolicy.poAmountTolerancePercent;
      // NextGen PO may include allowance added by the client (extra qty + amount on
      // top of the actual order). When invoice amount ≤ PO amount, the variance is
      // expected and not an over-billing risk. Only flag when invoice exceeds PO.
      // Compare using net/subtotal amount (excluding charges) — not the gross total.
      const isOverbilling = comparisonAmount > poAmount + financePolicy.invoiceRoundingTolerance;
      if (isOverbilling && absoluteDifference > financePolicy.invoiceRoundingTolerance && variance > financePolicy.poAmountTolerancePercent) {
        const chargeDetail = totalCharges > 0 && comparisonAmount === netInvoiceAmount
          ? ` (invoice subtotal $${netInvoiceAmount.toFixed(2)} = total $${invoiceTotal.toFixed(2)} minus charges $${totalCharges.toFixed(2)})`
          : (comparisonAmount !== netInvoiceAmount
            ? ` (matched invoice lines $${comparisonAmount.toFixed(2)} vs matched PO lines $${poAmount.toFixed(2)})`
            : '');
        differences.push(
          `Amount: invoice subtotal $${comparisonAmount.toFixed(2)} vs PO $${poAmount.toFixed(2)} (${(variance * 100).toFixed(1)}% variance; allowed ${(financePolicy.poAmountTolerancePercent * 100).toFixed(2)}%)${chargeDetail}`
        );
      }
    }

    // Quantity check (if invoice has qty_shipped and PO has line items)
    // When line-level matching found only SOME invoice lines, compare matched invoice line qty
    // against matched PO line qty instead of full invoice qty vs only matched PO lines.
    const invoiceQty = Number(invoice.qty_shipped || 0);
    const poQty = targetLines.reduce((sum: number, li: any) => sum + Number(li.quantity || 0), 0);
    const comparisonQty = (matchLevel === 'MATERIAL_LINE' && matchedInvoiceLineQty > 0)
      ? matchedInvoiceLineQty
      : invoiceQty;
    // Allow invoice qty ≤ PO qty — NextGen PO may include allowance added by the
    // client on top of the actual order, so PO qty can be higher than invoice qty.
    // Only flag a mismatch when invoice qty exceeds PO qty (potential over-billing).
    if (comparisonQty > 0 && poQty > 0 && comparisonQty > poQty) {
      differences.push(`Quantity: invoice ${comparisonQty} exceeds PO ${poQty} (over-billing)`);
    }

    // Vendor identity check (only if MPO matches). Similar words are not proof
    // of identity; only an exact normalized name or an Accounting-managed alias
    // can establish equivalence.
    if (invoice.vendor?.name && po.vendor_name) {
      const vendorAliases = await getAliasMap('VENDOR');
      if (!namesEquivalent(invoice.vendor.name, po.vendor_name, vendorAliases)) {
        differences.push(`Vendor name: invoice "${invoice.vendor.name}" vs PO "${po.vendor_name}"`);
      }
    }

    if (differences.length > 0) {
      return {
        passed: false,
        reason: ExceptionReason.AMOUNT_MISMATCH,
        message: `Invoice does not match MPO ${poRef} in NextGen`,
        detail: differences.join('; '),
      };
    }

    return {
      passed: true,
      message: `${matchLevel === 'MATERIAL_LINE' ? `Material ${requestedMaterialCode || requestedMaterialName}` : `MPO ${poRef}`} verified in NextGen — amount, quantity, and vendor match`,
    };
  } catch (error) {
    // A PO-backed finance invoice must fail closed when its source of truth is unavailable.
    logger.warn(`NextGen MPO check failed for ${poRef}: ${error instanceof Error ? error.message : 'unknown error'}`);
    return {
      passed: false,
      reason: ExceptionReason.PO_NOT_FOUND,
      code: 'NEXTGEN_UNAVAILABLE',
      message: `NextGen unavailable — MPO ${poRef} was not verified`,
      detail: 'Retry validation when NextGen is available. This invoice cannot proceed while the check is unavailable.',
    };
  }
}

// RULE 18 — Vendor cumulative threshold (WARNING ONLY — does not block approval)
// Per business confirmation: threshold exception is created for visibility/reporting
// but the invoice proceeds through the normal workflow.
async function validateVendorThreshold(invoice: any): Promise<ValidationResult> {
  if (!invoice.vendor_id || !invoice.total_amount) {
    return {
      passed: true,
      message: 'Cannot validate threshold without vendor and amount',
    };
  }

  try {
    const THRESHOLD_AMOUNT = VENDOR_THRESHOLD_CONFIG.AMOUNT;
    const THRESHOLD_DAYS = VENDOR_THRESHOLD_CONFIG.LOOKBACK_DAYS;

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
      // WARNING ONLY — always passes. Exception is created for visibility but does not block.
      return {
        passed: true,
        reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED,
        message: `Vendor cumulative threshold exceeded (warning)`,
        detail: `Vendor cumulative total $${currentTotal.toFixed(2)} exceeds $${THRESHOLD_AMOUNT.toLocaleString()} threshold for the last ${THRESHOLD_DAYS} days. This is a warning only and does not block approval. Existing: $${existingTotal.toFixed(2)}, Current invoice: $${Number(invoice.total_amount).toFixed(2)}`,
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
  // ON_HOLD is Accounting-only. Purchasing validation always continues to
  // approval; the threshold is enforced later by the posting workflow.
  void invoiceId;
  return { held: false, cumulative: 0, released: 0 };

  /* Legacy pre-Accounting implementation retained temporarily for migration reference.
  const BATCH_THRESHOLD = BATCH_THRESHOLD_CONFIG.AMOUNT;

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
      exceptions: {
        some: { reason: ExceptionReason.BATCH_THRESHOLD_NOT_MET as any, status: 'PENDING' as any },
      },
    },
  });

  const heldTotal = heldInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const currentAmount = Number(invoice.total_amount);
  const cumulative = heldTotal + currentAmount;
  // Hold only if the cumulative (including current invoice) is below threshold
  // If the current invoice alone meets the threshold, release immediately
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
      await createApprovalRequest(heldInvoice.id, 'system', { fromExceptionResolution: true });
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
  */
}

/**
 * Check for NextGen changes on an invoice
 * Compares stored NextGen data with current NextGen data and flags if changed
 */
export interface AutoFillMaterialResult {
  filled: boolean;
  reason?: 'no_mpo' | 'already_has_material' | 'no_lines' | 'no_match' | 'ambiguous' | 'line_has_no_material' | 'nextgen_unavailable';
  line_reference?: string;
  material_code?: string | null;
  material_name?: string | null;
  material_id?: number;
  material_url?: string;
  quantity?: number;
  total_amount?: number;
}

/**
 * Auto-fill the invoice's material from the NextGen MPO line list.
 *
 * Fires only when the invoice has an MPO but NO material (code or name), so a
 * vendor/OCR miss is repaired from the source of truth. Resolution order:
 *   1. MPO line reference (MPO015995-8 → line 8) or material hint on the invoice
 *   2. Single-line MPO → that line
 *   3. Quantity match (invoice qty == line qty)
 *   4. Unit-price match (invoice total / qty == line unit price)
 *   5. Line-total match (invoice total == line total amount)
 * When more than one line still matches the invoice is NOT filled (ambiguous) so
 * a wrong material is never written. The matched line's material_id/url and the
 * line reference are persisted in po_validation.auto_filled_material, and the
 * resolved line reference becomes mpo_order_sequence so later validations
 * resolve the exact line.
 */
export async function autoFillMaterialFromNextGen(
  invoice: any,
  poLines?: any[]
): Promise<AutoFillMaterialResult> {
  if (!invoice?.mpo_number) return { filled: false, reason: 'no_mpo' };
  if (invoice.material_code || invoice.material_name) return { filled: false, reason: 'already_has_material' };

  let lines = poLines;
  if (!lines || !lines.length) {
    try {
      const po: any = await Promise.race([
        nextGenService.getFullPOByMPO(invoice.mpo_number, {
          vendor_name: invoice.vendor?.name,
          amount: Number(invoice.total_amount || 0),
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('NEXTGEN_TIMEOUT_10s')), 10000)
        ),
      ]);
      lines = po?.line_items;
    } catch {
      return { filled: false, reason: 'nextgen_unavailable' };
    }
  }
  if (!lines || !lines.length) return { filled: false, reason: 'no_lines' };

  const parsed = parseMPOReference(invoice.mpo_number);
  const orderSequence = String(invoice.mpo_order_sequence || parsed.orderSequence || '').trim() || undefined;
  const materialCode = String(invoice.material_code || parsed.materialCode || '').trim() || undefined;
  const materialName = String(invoice.material_name || '').trim() || undefined;

  const qty = Number(invoice.qty_shipped || 0);
  const amount = Number(invoice.total_amount || 0);

  // 1) Exact line reference / material-hint resolution
  let candidates: any[] = lines;
  if (orderSequence || materialCode || materialName) {
    const resolution = matchMPOLines(lines, { orderSequence, materialCode, materialName });
    if (resolution.lines.length > 0) {
      candidates = resolution.lines;
      if (!resolution.error && candidates.length === 1) {
        return await persistMaterialFill(invoice, candidates[0], parsed.baseMpo);
      }
      // AMBIGUOUS_MATERIAL — narrow with qty/price/amount below.
    }
  }

  // 2) Single-line MPO → that line
  if (lines.length === 1) {
    return await persistMaterialFill(invoice, lines[0], parsed.baseMpo);
  }

  // 3) Quantity match
  if (qty > 0) {
    const byQty = candidates.filter(l => Number(l.quantity || 0) === qty);
    if (byQty.length === 1) return await persistMaterialFill(invoice, byQty[0], parsed.baseMpo);
    if (byQty.length > 1) candidates = byQty;
  }

  // 4) Unit-price match (invoice total / qty ≈ line unit price)
  if (qty > 0 && amount > 0) {
    const impliedPrice = amount / qty;
    const byPrice = candidates.filter(l => {
      const p = Number(l.unit_price || 0);
      return p > 0 && Math.abs(p - impliedPrice) < 0.001;
    });
    if (byPrice.length === 1) return await persistMaterialFill(invoice, byPrice[0], parsed.baseMpo);
    if (byPrice.length > 1) candidates = byPrice;
  }

  // 5) Line-total match
  if (amount > 0) {
    const byAmount = candidates.filter(l => Math.abs(Number(l.total_amount || 0) - amount) < 0.01);
    if (byAmount.length === 1) return await persistMaterialFill(invoice, byAmount[0], parsed.baseMpo);
    if (byAmount.length > 1) candidates = byAmount;
  }

  if (candidates.length === 0) return { filled: false, reason: 'no_match' };
  return { filled: false, reason: 'ambiguous' };
}

async function persistMaterialFill(invoice: any, line: any, baseMpo?: string): Promise<AutoFillMaterialResult> {
  const itemCode = String(line.item_code || line.material_code || '').trim();
  const lineMaterialName = String(line.material_name || line.description || '').trim();
  if (!itemCode && !lineMaterialName) return { filled: false, reason: 'line_has_no_material' };

  const data: Record<string, any> = {};
  if (itemCode) data.material_code = itemCode;
  if (lineMaterialName) data.material_name = lineMaterialName;
  const lineRef = String(line.line_reference || line.line_number || '').trim();
  if (lineRef && !invoice.mpo_order_sequence) data.mpo_order_sequence = lineRef;
  if (baseMpo && !invoice.mpo_base_number) data.mpo_base_number = baseMpo;

  const current = typeof invoice.po_validation === 'string'
    ? JSON.parse(invoice.po_validation)
    : (invoice.po_validation || {});
  current.auto_filled_material = {
    line_reference: lineRef || null,
    material_id: line.material_id ?? null,
    material_url: line.material_url || null,
    quantity: line.quantity ?? null,
    unit_price: line.unit_price ?? null,
    total_amount: line.total_amount ?? null,
    filled_at: new Date().toISOString(),
  };
  data.po_validation = JSON.stringify(current);

  await prisma.invoice.update({ where: { id: invoice.id }, data });

  return {
    filled: true,
    line_reference: lineRef || undefined,
    material_code: itemCode || null,
    material_name: lineMaterialName || null,
    material_id: line.material_id,
    material_url: line.material_url,
    quantity: line.quantity,
    total_amount: line.total_amount,
  };
}

export async function checkNextGenChanges(invoiceId: string): Promise<{
  hasChanges: boolean;
  hasCriticalChanges: boolean;
  changes: Array<{ field: string; old: any; new: any }>;
  criticalChanges: Array<{ field: string; old: any; new: any }>;
  currentData: any;
  nextGenUnavailable: boolean;
  poNotFound?: boolean;
  /** True when there was no stored baseline yet — the check only saved the
   *  snapshot and did NOT compare invoice fields, so "matches" must not be shown. */
  firstCheck: boolean;
}> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice || !invoice.mpo_number) {
    return { hasChanges: false, hasCriticalChanges: false, changes: [], criticalChanges: [], currentData: null, nextGenUnavailable: false, firstCheck: false };
  }

  // Real-time check runs inside a hard 10s budget (same as Rule 17's NEXTGEN_TIMEOUT_10s)
  // so a slow/hanging NextGen can never stall the invoice view past the frontend timeout.
  let currentNextGen: any = null;
  try {
    currentNextGen = await Promise.race([
      nextGenService.getFullPOByMPO(invoice.mpo_number, {
        vendor_name: invoice.vendor?.name,
        amount: Number(invoice.total_amount),
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('NEXTGEN_UNAVAILABLE_TIMEOUT')), 10000)
      ),
    ]);
  } catch (timeoutErr: any) {
    logger.warn(`[checkNextGenChanges] NextGen timed out after 10s for MPO ${invoice.mpo_number} — marking unavailable`);
    return {
      hasChanges: false,
      hasCriticalChanges: false,
      changes: [],
      criticalChanges: [],
      currentData: null,
      nextGenUnavailable: true,
      firstCheck: false,
    };
  }

  if (!currentNextGen) {
    // A quick null can mean "PO not found" OR "NextGen down". Distinguish via metrics:
    // cooldown active or recent consecutive failures ⇒ system is unavailable, not a data miss.
    const metrics = getNextGenMetrics();
    const systemDown = metrics.cooldown_active || metrics.consecutive_failures >= 2;
    return {
      hasChanges: false,
      hasCriticalChanges: false,
      changes: [],
      criticalChanges: [],
      currentData: null,
      nextGenUnavailable: systemDown,
      poNotFound: !systemDown,
      firstCheck: false,
    };
  }

  // Auto-fill the invoice's material from the MPO when it has none. The line
  // data is already in hand, so no extra NextGen call. Never breaks the check.
  if (!invoice.material_code && !invoice.material_name && Array.isArray(currentNextGen.line_items)) {
    try {
      await autoFillMaterialFromNextGen(invoice, currentNextGen.line_items);
    } catch (fillErr: any) {
      logger.warn(`[checkNextGenChanges] material auto-fill failed for ${invoice.mpo_number}: ${fillErr?.message || 'unknown error'}`);
    }
  }

  const storedNextGen = invoice.po_validation ? (typeof invoice.po_validation === 'string' ? JSON.parse(invoice.po_validation) : invoice.po_validation)?.nextgen_data : null;
  const changes: Array<{ field: string; old: any; new: any }> = [];

  if (storedNextGen) {
    // Compare key fields (drift detection — needs a baseline)
    if (storedNextGen.amount !== currentNextGen.amount) {
      changes.push({ field: 'amount', old: storedNextGen.amount, new: currentNextGen.amount });
    }
    if (storedNextGen.vendor_name !== currentNextGen.vendor_name) {
      changes.push({ field: 'vendor_name', old: storedNextGen.vendor_name, new: currentNextGen.vendor_name });
    }
    if (storedNextGen.po_number !== currentNextGen.po_number) {
      changes.push({ field: 'po_number', old: storedNextGen.po_number, new: currentNextGen.po_number });
    }

    // Compare line items quantity
    if (storedNextGen.line_items && currentNextGen.line_items) {
      const storedQty = storedNextGen.line_items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0);
      const currentQty = currentNextGen.line_items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0);
      if (storedQty !== currentQty) {
        changes.push({ field: 'total_quantity', old: storedQty, new: currentQty });
      }
    }
  }

  // ── Invoice vs NextGen — ALWAYS compared, including the first check ──────
  // Mirrors Rule 17: resolve the invoice's specific PO lines (material/sequence),
  // compare the net invoice amount (minus charges) with 5% tolerance so partial
  // deliveries of multi-line MPOs don't produce false mismatches.
  const ngLines = Array.isArray(currentNextGen.line_items) ? currentNextGen.line_items : [];
  const parsedMpo = invoice.mpo_number ? parseMPOReference(invoice.mpo_number) : null;
  const rawData = (invoice as any).ocr_raw_data || {};
  const orderSequence = invoice.mpo_order_sequence || parsedMpo?.orderSequence || rawData.mpo_order_sequence;
  const materialCode = invoice.material_code || parsedMpo?.materialCode || rawData.material_code;
  const materialName = invoice.material_name || rawData.material_name;

  let targetLines = ngLines;
  let matchLevel = 'MPO_HEADER';
  if (orderSequence || materialCode || materialName) {
    const resolution = matchMPOLines(ngLines, { orderSequence, materialCode, materialName });
    if (!resolution.error && resolution.lines.length > 0) {
      targetLines = resolution.lines;
      matchLevel = resolution.matchLevel;
    }
  }

  // Amount — net of charges, using the Finance-owned tolerance policy.
  const poAmount = matchLevel !== 'MPO_HEADER'
    ? targetLines.reduce((sum: number, li: any) => sum + Number(li.total_amount || 0), 0)
    : Number(currentNextGen.amount || 0);
  const invoiceTotal = Number(invoice.total_amount || 0);
  const totalCharges = Number(invoice.bank_charges || 0) + Number((invoice as any).tt_charge || 0)
    + Number(invoice.freight_charges || 0) + Number((invoice as any).courier_charges || 0)
    + Number((invoice as any).handling_fee || 0) + Number((invoice as any).finance_surcharge || 0)
    + Number((invoice as any).setup_charge || 0) + Number((invoice as any).sample_charge || 0)
    + Number((invoice as any).min_order_charge || 0) + Number(invoice.additional_charges || 0);
  // When charge fields are not populated, fall back to sum of invoice line amounts
  // (goods subtotal) as the correct comparison against PO amount.
  const invoiceLines = await prisma.invoiceLine.findMany({ where: { invoice_id: invoiceId }, select: { line_amount: true } });
  const lineAmountSum = invoiceLines.reduce((sum: number, l: any) => sum + Number(l.line_amount || 0), 0);
  const netInvoiceAmount = totalCharges > 0
    ? (invoiceTotal - totalCharges + Number(invoice.discount_amount || 0))
    : (lineAmountSum > 0 ? lineAmountSum : invoiceTotal);

  if (poAmount > 0 && netInvoiceAmount > 0) {
    const variance = Math.abs(netInvoiceAmount - poAmount) / poAmount;
    const policy = getFinancePolicy();
    // Only flag when net invoice amount (excluding charges) exceeds PO amount.
    // NextGen PO may include allowance added by the client, making PO amount higher.
    const isOverbilling = netInvoiceAmount > poAmount + policy.invoiceRoundingTolerance;
    if (isOverbilling
      && Math.abs(netInvoiceAmount - poAmount) > policy.invoiceRoundingTolerance
      && variance > policy.poAmountTolerancePercent) {
      changes.push({ field: 'invoice_amount_vs_nextgen', old: netInvoiceAmount, new: poAmount });
    }
  }

  // Vendor — normalized exact match (informational, not critical). Known
  // formatting variants are resolved through the coordinator-editable alias
  // table (e.g. "J-LONG LTD." = "J-Long Ltd") before flagging a difference.
  const vendorAliasMap = await getAliasMap('VENDOR');
  if (invoice.vendor?.name && currentNextGen.vendor_name) {
    const invVendor = invoice.vendor.name.toLowerCase().trim();
    const ngVendor = currentNextGen.vendor_name.toLowerCase().trim();
    if (!namesEquivalent(invVendor, ngVendor, vendorAliasMap)) {
      changes.push({ field: 'invoice_vendor_vs_nextgen', old: invoice.vendor.name, new: currentNextGen.vendor_name });
    }
  }

  // Quantity — line-aware (informational, not critical)
  const invoiceQty = Number(invoice.qty_shipped || 0);
  const poQty = targetLines.reduce((sum: number, li: any) => sum + Number(li.quantity || 0), 0);
  // Allow invoice qty ≤ PO qty — NextGen PO may include allowance added by the
  // client on top of the actual order. Only flag when invoice qty > PO qty.
  if (invoiceQty > 0 && poQty > 0 && invoiceQty > poQty) {
    changes.push({ field: 'invoice_quantity_vs_nextgen', old: invoiceQty, new: poQty });
  }

  // Brand / season / order type — informational (never critical). Skipped when
  // either side is blank or a placeholder so missing data never false-positives.
  const norm = (v: any): string => {
    const s = String(v ?? '').trim().toLowerCase();
    return (s === '—' || s === '-') ? '' : s;
  };

  const invBrand = norm(invoice.brand);
  const ngBrand = norm(currentNextGen.brand);
  const brandAliasMap = await getAliasMap('BRAND');
  if (invBrand && ngBrand && invBrand !== ngBrand && !namesEquivalent(invBrand, ngBrand, brandAliasMap)) {
    changes.push({ field: 'brand', old: invoice.brand, new: currentNextGen.brand });
  }

  const invSeason = norm(invoice.season);
  const ngSeason = norm(currentNextGen.season);
  if (invSeason && ngSeason && invSeason !== ngSeason) {
    changes.push({ field: 'season', old: invoice.season, new: currentNextGen.season });
  }

  const invOrderType = norm(invoice.order_type);
  const ngOrderType = norm(currentNextGen.order_type);
  if (invOrderType && ngOrderType && invOrderType !== ngOrderType) {
    changes.push({ field: 'order_type', old: invoice.order_type, new: currentNextGen.order_type });
  }

  const hasChanges = changes.length > 0;

  // Separate critical changes from informational changes
  const criticalChanges = changes.filter(c => 
    ['amount', 'vendor_name', 'po_number', 'invoice_amount_vs_nextgen'].includes(c.field)
  );
  const hasCriticalChanges = criticalChanges.length > 0;

  // Only create exceptions for critical changes
  if (hasCriticalChanges) {
    await prisma.exception.create({
      data: {
        invoice_id: invoiceId,
        reason: ExceptionReason.PO_NOT_FOUND as any,
        detail: `NextGen critical data changed: ${criticalChanges.map(c => `${c.field} from ${c.old} to ${c.new}`).join(', ')}`,
        status: 'PENDING' as any,
      },
    });
  }

  // Always update po_validation with current NextGen data and changes flag.
  // The full changes array (field/old/new) is persisted too so informational
  // differences (brand/season/order-type/vendor/qty) survive the session and
  // render in the invoice's Validation tab, not just the live banner.
  const currentPoValidation = typeof invoice.po_validation === 'string' ? JSON.parse(invoice.po_validation) : (invoice.po_validation || {});
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      po_validation: JSON.stringify({
        ...currentPoValidation,
        nextgen_data: currentNextGen,
        last_checked: new Date().toISOString(),
        has_changes: hasChanges,
        critical_changes: hasCriticalChanges,
        changes,
      }),
    },
  });

  return { hasChanges, hasCriticalChanges, changes, criticalChanges, currentData: currentNextGen, nextGenUnavailable: false, firstCheck: !storedNextGen };
}
