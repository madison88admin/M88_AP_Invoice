import prisma from '../config/database';
import { ExceptionReason, InvoiceStatus, InvoiceType, MadisonEntity, SignatureRole } from '@ap-invoice/shared';
import { createApprovalRequest } from './approvalService';
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

export async function validateInvoice(invoiceId: string): Promise<InvoiceValidationResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: true,
      signatures: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

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
    exceptions.push({ reason: ExceptionReason.INVALID_INVOICE_NUMBER, detail: invoiceNumberResult.detail || '' });
  }

  // RULE 3 — Invoice date validity
  const invoiceDateResult = validateInvoiceDate(invoice.invoice_date);
  results.push(invoiceDateResult);
  if (!invoiceDateResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_INVOICE_DATE, detail: invoiceDateResult.detail || '' });
  }

  // RULE 4 — Due date validity
  const dueDateResult = validateDueDate(invoice.invoice_due_date, invoice.invoice_date);
  results.push(dueDateResult);
  if (!dueDateResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_DUE_DATE, detail: dueDateResult.detail || '' });
  }

  // RULE 5 — Amount validity
  const amountResult = validateAmount(Number(invoice.amount));
  results.push(amountResult);
  if (!amountResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_AMOUNT, detail: amountResult.detail || '' });
  }

  // RULE 6 — Currency validity
  const currencyResult = validateCurrency(invoice.currency, invoice.currency_original || undefined, invoice.exchange_rate_to_usd ? Number(invoice.exchange_rate_to_usd) : undefined);
  results.push(currencyResult);
  if (!currencyResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_CURRENCY, detail: currencyResult.detail || '' });
  }

  // RULE 7 — Payment terms validity
  const paymentTermsResult = validatePaymentTerms(invoice.payment_terms || '');
  results.push(paymentTermsResult);
  if (!paymentTermsResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_PAYMENT_TERMS, detail: paymentTermsResult.detail || '' });
  }

  // RULE 8 — Incoterm validity
  const incotermResult = validateIncoterm(invoice.incoterm);
  results.push(incotermResult);
  if (!incotermResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_INCOTERM, detail: incotermResult.detail || '' });
  }

  // RULE 9 — Bank info completeness
  const bankResult = await validateBankDetails(invoice);
  results.push(bankResult);
  if (!bankResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_BANK_INFO, detail: bankResult.detail || '' });
  }

  // RULE 10 — Signature presence
  const signatureResult = validateSignatures(Number(invoice.amount), invoice.signatures);
  results.push(signatureResult);
  if (!signatureResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_SIGNATURE, detail: signatureResult.detail || '' });
  }

  // RULE 11 — Bill-to entity match
  const billToResult = validateBillToEntity(invoice.bill_to_name, invoice.bill_to_address, (invoice as any).bill_to_entity);
  results.push(billToResult);
  if (!billToResult.passed) {
    exceptions.push({ reason: ExceptionReason.ENTITY_MISMATCH, detail: billToResult.detail || '' });
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

    // Update invoice status to EXCEPTION
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.EXCEPTION },
    });
  } else {
    // Update invoice status to VALIDATED
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VALIDATED },
    });

    // Auto-create approval request when validation passes
    try {
      await createApprovalRequest(invoiceId, 'system');
    } catch (error) {
      // Log error but don't fail validation if approval request fails
      console.error('Failed to create approval request:', error);
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
      reason: ExceptionReason.INVALID_INVOICE_NUMBER,
      message: 'Invoice number is missing',
      detail: 'Invoice number is required',
    };
  }

  // Check for valid invoice number format (alphanumeric with optional hyphens/underscores)
  const validFormat = /^[A-Z0-9\-_]+$/i.test(invoiceNumber);
  if (!validFormat) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_INVOICE_NUMBER,
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
function validateInvoiceDate(invoiceDate: Date): ValidationResult {
  if (!invoiceDate) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_INVOICE_DATE,
      message: 'Invoice date is missing',
      detail: 'Invoice date is required',
    };
  }

  const date = new Date(invoiceDate);
  if (isNaN(date.getTime())) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_INVOICE_DATE,
      message: 'Invalid invoice date',
      detail: `Invoice date "${invoiceDate}" is not a valid date`,
    };
  }

  // Check if invoice date is in the future
  const now = new Date();
  if (date > now) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_INVOICE_DATE,
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
function validateDueDate(dueDate: Date | null, invoiceDate: Date): ValidationResult {
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
      reason: ExceptionReason.INVALID_DUE_DATE,
      message: 'Invalid due date',
      detail: `Due date "${dueDate}" is not a valid date`,
    };
  }

  // Due date should be after invoice date
  const invDate = new Date(invoiceDate);
  if (date < invDate) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_DUE_DATE,
      message: 'Due date is before invoice date',
      detail: `Due date (${date.toISOString()}) cannot be before invoice date (${invDate.toISOString()})`,
    };
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
      reason: ExceptionReason.INVALID_AMOUNT,
      message: 'Invoice amount must be positive',
      detail: `Invalid amount: ${amount}`,
    };
  }

  // Check for unreasonably large amounts (e.g., > 10 million)
  if (amount > 10000000) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_AMOUNT,
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
      reason: ExceptionReason.INVALID_CURRENCY,
      message: 'Currency is missing',
      detail: 'Currency is required',
    };
  }

  // Primary currency must be USD
  if (currency !== 'USD') {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_CURRENCY,
      message: 'Primary currency must be USD',
      detail: `Currency "${currency}" is not USD. Original amount should be stored and converted to USD.`,
    };
  }

  // Validate exchange rate is present for non-USD original currency
  if (currencyOriginal && currencyOriginal !== 'USD' && !exchangeRate) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_CURRENCY,
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
      reason: ExceptionReason.INVALID_PAYMENT_TERMS,
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
      reason: ExceptionReason.INVALID_INCOTERM,
      message: 'Invalid incoterm',
      detail: `Incoterm "${incoterm}" is not a valid incoterm`,
    };
  }

  return {
    passed: true,
    message: 'Incoterm is valid',
  };
}

// RULE 11 — Bill-to entity match
function validateBillToEntity(billToName: string, billToAddress: string, billToEntity?: MadisonEntity): ValidationResult {
  const upperName = billToName.toUpperCase();
  const upperAddress = billToAddress.toUpperCase();

  // Valid Madison 88 entity names
  const validEntities = [
    'MADISON 88 LTD',
    'MADISON 88 LIMITED',
    'MADISON 88, LTD',
    'MADISON LIMITED',
    'MADISON88, LTD',
    'MADISON 88, LTD',
    '15 WEST 36TH STREET',
    'NEW YORK',
    'NY 10018',
    '15W 36TH STREET',
    'MADISON 88 HONG KONG',
    'MADISON 88 HONG KONG LIMITED',
    'MADISON88',
    'APH1009 MADISON',
  ];

  // Check if bill-to matches valid entities
  const isValidEntity = validEntities.some(entity => upperName.includes(entity) || upperAddress.includes(entity));

  if (!isValidEntity) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_BILL_TO,
      message: 'Bill-to entity does not match valid Madison 88 entities',
      detail: `Invalid bill-to: "${billToName}" at "${billToAddress}". Expected Madison 88 entity.`,
    };
  }

  // Check for missing address
  if (!billToAddress || billToAddress.trim().length === 0) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_ADDRESS,
      message: 'Bill-to address is missing',
      detail: 'Bill-to address is required for validation',
    };
  }

  // Validate specific addresses
  const validDenver = ['2433 CURTIS STREET', '2423 CURTIS STREET'];
  const validNewYork = ['15 WEST 36TH STREET', '15W 36TH STREET', '14TH FLOOR'];
  const validHongKong = ['香港灣仔告士打道160號'];

  if (upperAddress.includes('DENVER') && !validDenver.some(addr => upperAddress.includes(addr))) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_BILL_TO,
      message: 'Invalid Denver address',
      detail: `Address "${billToAddress}" does not match valid Denver addresses`,
    };
  }

  if (upperAddress.includes('NEW YORK') && !validNewYork.some(addr => upperAddress.includes(addr))) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_BILL_TO,
      message: 'Invalid New York address',
      detail: `Address "${billToAddress}" does not match valid New York addresses`,
    };
  }

  return {
    passed: true,
    message: 'Bill-to entity and address are valid',
  };
}

// RULE 2 — Invoice template validation
function validateInvoiceTemplate(invoiceType: InvoiceType, expectedTemplate?: InvoiceType): ValidationResult {
  // STATEMENT type: flag for manual review — do not auto-post
  if (invoiceType === InvoiceType.STATEMENT) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_TEMPLATE,
      message: 'Statement type requires manual review',
      detail: 'STATEMENT type invoices should not be auto-posted to QuickBooks',
    };
  }

  // PI type must NOT be posted to QuickBooks directly
  if (invoiceType === InvoiceType.PI) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_TEMPLATE,
      message: 'PI type requires Purchasing Coordinator confirmation',
      detail: 'Proforma invoices require confirmation from Purchasing Coordinator before processing',
    };
  }

  // Check if invoice type matches vendor's expected template
  if (expectedTemplate && invoiceType !== expectedTemplate) {
    return {
      passed: false,
      reason: ExceptionReason.INVALID_TEMPLATE,
      message: 'Invoice type does not match vendor expected template',
      detail: `Invoice type ${invoiceType} does not match expected template ${expectedTemplate}`,
    };
  }

  return {
    passed: true,
    message: 'Invoice template is valid',
  };
}

// RULE 3 — Bank details validation
async function validateBankDetails(invoice: any): Promise<ValidationResult> {
  if (!invoice.vendor) {
    return {
      passed: false,
      reason: ExceptionReason.VENDOR_NOT_FOUND,
      message: 'Vendor not assigned',
      detail: 'Cannot validate bank details without vendor assignment',
    };
  }

  const ocrBankInfo = invoice.ocr_raw_data?.bank_info;

  // If OCR didn't extract bank info, flag as missing
  if (!ocrBankInfo || !ocrBankInfo.swift_code || !ocrBankInfo.account_usd) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Bank details not extracted from OCR',
      detail: 'OCR did not extract complete bank information - manual review required',
    };
  }

  // Compare with vendor records
  const vendorSwift = invoice.vendor.swift_code;
  const vendorAccountUsd = invoice.vendor.account_usd;

  // Normalize SWIFT codes for comparison
  const normalizeSwift = (swift: string) => swift.toUpperCase().replace(/\s/g, '').replace(/X+$/, '');
  const ocrSwiftNormalized = normalizeSwift(ocrBankInfo.swift_code || '');
  const vendorSwiftNormalized = normalizeSwift(vendorSwift || '');

  // Compare SWIFT codes
  if (vendorSwift && ocrSwiftNormalized && vendorSwiftNormalized !== ocrSwiftNormalized) {
    return {
      passed: false,
      reason: ExceptionReason.BANK_MISMATCH,
      message: 'SWIFT code does not match vendor records',
      detail: `OCR SWIFT: "${ocrBankInfo.swift_code}" vs Vendor SWIFT: "${vendorSwift}"`,
    };
  }

  // Compare account numbers (normalize by removing spaces and dashes)
  const normalizeAccount = (account: string) => account.replace(/[\s-]/g, '');
  const ocrAccountNormalized = normalizeAccount(ocrBankInfo.account_usd || '');
  const vendorAccountNormalized = normalizeAccount(vendorAccountUsd || '');

  if (vendorAccountUsd && ocrAccountNormalized && vendorAccountNormalized !== ocrAccountNormalized) {
    return {
      passed: false,
      reason: ExceptionReason.BANK_MISMATCH,
      message: 'Account number does not match vendor records',
      detail: `OCR Account: "${ocrBankInfo.account_usd}" vs Vendor Account: "${vendorAccountUsd}"`,
    };
  }

  return {
    passed: true,
    message: 'Bank details match vendor records',
  };
}

// RULE 4 — Signature validation
function validateSignatures(amount: number, signatures: any[]): ValidationResult {
  // Check for "Computer-generated, no signature required" exemption
  if (signatures && signatures.some(sig => 
    sig.signer_name && sig.signer_name.toLowerCase().includes('computer-generated')
  )) {
    return {
      passed: true,
      message: 'Computer-generated invoice - signature not required',
    };
  }

  // Count digital signatures (they count)
  const digitalSignatures = signatures?.filter(sig => sig.is_digital) || [];
  const physicalSignatures = signatures?.filter(sig => !sig.is_digital && sig.signer_name) || [];
  const totalSignatures = digitalSignatures.length + physicalSignatures.length;

  // Determine required signature count based on amount
  const requiredSignatures = amount < 5000 ? 2 : 4;

  if (totalSignatures < requiredSignatures) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_SIGNATURE,
      message: 'Insufficient signatures',
      detail: `Invoice requires ${requiredSignatures} signatures (${amount < 5000 ? 'COORDINATOR + MANAGER' : 'COORDINATOR + MANAGER + PLANNING_MANAGER + LINDSEY'}), found ${totalSignatures}`,
    };
  }

  // Check for required signature roles
  const roles = signatures?.map(sig => sig.role) || [];
  const uniqueRoles = [...new Set(roles)];

  if (amount < 5000) {
    // Require COORDINATOR + MANAGER
    const hasCoordinator = uniqueRoles.includes('COORDINATOR');
    const hasManager = uniqueRoles.includes('MANAGER');
    
    if (!hasCoordinator || !hasManager) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing required signature roles',
        detail: 'Invoices under $5,000 require COORDINATOR and MANAGER signatures',
      };
    }
  } else {
    // Require COORDINATOR + MANAGER + PLANNING_MANAGER + LINDSEY
    const hasCoordinator = uniqueRoles.includes('COORDINATOR');
    const hasManager = uniqueRoles.includes('MANAGER');
    const hasPlanningManager = uniqueRoles.includes('PLANNING_MANAGER');
    const hasLindsey = uniqueRoles.includes('LINDSEY');
    
    if (!hasCoordinator || !hasManager || !hasPlanningManager || !hasLindsey) {
      return {
        passed: false,
        reason: ExceptionReason.MISSING_SIGNATURE,
        message: 'Missing required signature roles',
        detail: 'Invoices $5,000+ require COORDINATOR, MANAGER, PLANNING_MANAGER, and LINDSEY signatures',
      };
    }
  }

  return {
    passed: true,
    message: 'Signature requirements met',
  };
}

// RULE 5 — Duplicate detection
async function checkDuplicateInvoice(invoice: any): Promise<ValidationResult> {
  // Hash: SHA-256(invoice_number + vendor_id + amount + invoice_date)
  const hashInput = `${invoice.invoice_number}${invoice.vendor_id}${invoice.amount}${invoice.invoice_date}`;
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  // Check for existing invoice with same hash
  const duplicate = await prisma.invoice.findFirst({
    where: {
      invoice_number: invoice.invoice_number,
      vendor_id: invoice.vendor_id,
      id: { not: invoice.id },
    },
  });

  if (duplicate) {
    return {
      passed: false,
      reason: ExceptionReason.DUPLICATE_INVOICE,
      message: 'Duplicate invoice detected',
      detail: `Invoice ${invoice.invoice_number} already exists for this vendor (ID: ${duplicate.id})`,
    };
  }

  return {
    passed: true,
    message: 'No duplicate invoice found',
  };
}

// RULE 6 — Late submission
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

// RULE 7 — Urgent payment
function checkUrgentPayment(invoice: any): ValidationResult {
  // Check is_priority flag from OCR
  if (invoice.is_priority) {
    return {
      passed: false,
      reason: ExceptionReason.URGENT_PAYMENT,
      message: 'Urgent payment flag detected',
      detail: invoice.priority_pay_date 
        ? `Priority payment requested by ${invoice.priority_pay_date.toLocaleDateString()}`
        : 'Priority payment requested - immediate attention required',
    };
  }

  return {
    passed: true,
    message: 'No urgent payment flag',
  };
}

// RULE 8 — Currency handling
function validateCurrencyAndAmount(invoice: any): ValidationResult {
  // Validate amount is positive
  if (invoice.amount <= 0) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Invoice amount must be positive',
      detail: `Invalid amount: ${invoice.amount}`,
    };
  }

  // Primary currency must be USD
  if (invoice.currency !== 'USD') {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Primary currency must be USD',
      detail: `Currency "${invoice.currency}" is not USD. Original amount should be stored and converted to USD.`,
    };
  }

  // Validate exchange rate is present for non-USD original currency
  if (invoice.currency_original && invoice.currency_original !== 'USD' && !invoice.exchange_rate_to_usd) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Exchange rate missing for non-USD currency',
      detail: `Original currency ${invoice.currency_original} requires exchange_rate_to_usd`,
    };
  }

  return {
    passed: true,
    message: 'Currency and amount are valid',
  };
}

// RULE 9 — Handwritten document
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

// RULE 10 — Missing bank info
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

  // Check if vendor has USD account
  if (!invoice.vendor.account_usd) {
    return {
      passed: false,
      reason: ExceptionReason.MISSING_BANK_INFO,
      message: 'Vendor missing USD account',
      detail: `Vendor "${invoice.vendor.name}" does not have USD account on file - route to Purchasing Coordinator to obtain from vendor`,
    };
  }

  return {
    passed: true,
    message: 'Vendor bank information is complete',
  };
}
