import prisma from '../config/database';
import { ExceptionReason, InvoiceStatus } from '@ap-invoice/shared';
import { createApprovalRequest } from './approvalService';

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
    detail: string;
  }>;
}

// Valid bill-to company names
const VALID_BILL_TO_NAMES = [
  'MADISON 88 BUSINESS SOLUTIONS ASIA INC',
  'MADISON 88 BUSINESS SOLUTIONS ASIA INC.',
  'MADISON 88',
  'MADISON 88 ASIA',
  'MADISON 88 BUSINESS SOLUTIONS',
];

// Valid invoice template patterns
const VALID_INVOICE_PATTERNS = [
  /^INV-\d{4}-\d{6}$/, // INV-YYYY-XXXXXX
  /^PI-\d{4}-\d{6}$/,  // PI-YYYY-XXXXXX
  /^CI-\d{4}-\d{6}$/,  // CI-YYYY-XXXXXX
  /^SI-\d{4}-\d{6}$/,  // SI-YYYY-XXXXXX
  /^[A-Z]{2,4}-\d{6,8}$/, // Generic pattern
];

// Late submission threshold: 30 days after invoice date
const LATE_SUBMISSION_DAYS = 30;

// Urgent payment threshold: 7 days before due date
const URGENT_PAYMENT_DAYS = 7;

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

  // Run all validation rules
  const billToResult = validateBillTo(invoice.bill_to_name);
  results.push(billToResult);
  if (!billToResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_BILL_TO, detail: billToResult.detail });
  }

  const templateResult = validateInvoiceTemplate(invoice.invoice_number);
  results.push(templateResult);
  if (!templateResult.passed) {
    exceptions.push({ reason: ExceptionReason.INVALID_TEMPLATE, detail: templateResult.detail });
  }

  const bankResult = await validateBankDetails(invoice);
  results.push(bankResult);
  if (!bankResult.passed) {
    exceptions.push({ reason: ExceptionReason.BANK_MISMATCH, detail: bankResult.detail });
  }

  const signatureResult = validateSignatures(invoice.signatures);
  results.push(signatureResult);
  if (!signatureResult.passed) {
    exceptions.push({ reason: ExceptionReason.MISSING_SIGNATURE, detail: signatureResult.detail });
  }

  const duplicateResult = await checkDuplicateInvoice(invoice);
  results.push(duplicateResult);
  if (!duplicateResult.passed) {
    exceptions.push({ reason: ExceptionReason.DUPLICATE_INVOICE, detail: duplicateResult.detail });
  }

  const lateResult = checkLateSubmission(invoice);
  results.push(lateResult);
  if (!lateResult.passed) {
    exceptions.push({ reason: ExceptionReason.LATE_SUBMISSION, detail: lateResult.detail });
  }

  const urgentResult = checkUrgentPayment(invoice);
  results.push(urgentResult);
  if (!urgentResult.passed) {
    exceptions.push({ reason: ExceptionReason.URGENT_PAYMENT, detail: urgentResult.detail });
  }

  const amountResult = validateCurrencyAndAmount(invoice);
  results.push(amountResult);
  if (!amountResult.passed) {
    exceptions.push({ reason: ExceptionReason.AMOUNT_MISMATCH, detail: amountResult.detail });
  }

  const passed = results.every(r => r.passed);

  // Create exception records for failed validations
  if (exceptions.length > 0) {
    for (const exc of exceptions) {
      await prisma.exception.create({
        data: {
          invoice_id: invoiceId,
          reason: exc.reason,
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

function validateBillTo(billToName: string): ValidationResult {
  const normalizedBillTo = billToName.toUpperCase().trim();
  
  const isValid = VALID_BILL_TO_NAMES.some(validName => 
    normalizedBillTo.includes(validName) || validName.includes(normalizedBillTo)
  );

  if (isValid) {
    return {
      passed: true,
      message: 'Bill-to company name is valid',
    };
  }

  return {
    passed: false,
    reason: ExceptionReason.INVALID_BILL_TO,
    message: 'Bill-to company name does not match valid entities',
    detail: `Invalid bill-to: "${billToName}". Expected one of: ${VALID_BILL_TO_NAMES.join(', ')}`,
  };
}

function validateInvoiceTemplate(invoiceNumber: string): ValidationResult {
  const isValid = VALID_INVOICE_PATTERNS.some(pattern => pattern.test(invoiceNumber));

  if (isValid) {
    return {
      passed: true,
      message: 'Invoice number follows valid template',
    };
  }

  return {
    passed: false,
    reason: ExceptionReason.INVALID_TEMPLATE,
    message: 'Invoice number does not follow valid template',
    detail: `Invoice number "${invoiceNumber}" does not match expected patterns (e.g., INV-2024-123456)`,
  };
}

async function validateBankDetails(invoice: any): Promise<ValidationResult> {
  if (!invoice.vendor) {
    return {
      passed: false,
      reason: ExceptionReason.BANK_MISMATCH,
      message: 'Vendor not assigned',
      detail: 'Cannot validate bank details without vendor assignment',
    };
  }

  const ocrBankInfo = invoice.ocr_raw_data?.bank_info;
  const vendorBankInfo = invoice.vendor.bank_details;

  // If OCR didn't extract bank info, we can't validate
  if (!ocrBankInfo) {
    return {
      passed: true,
      message: 'Bank details not extracted from OCR - manual review required',
    };
  }

  // Compare bank name
  if (vendorBankInfo.bank_name && ocrBankInfo.bank_name) {
    const vendorBankNormalized = vendorBankInfo.bank_name.toUpperCase().trim();
    const ocrBankNormalized = ocrBankInfo.bank_name.toUpperCase().trim();
    
    if (!vendorBankNormalized.includes(ocrBankNormalized) && !ocrBankNormalized.includes(vendorBankNormalized)) {
      return {
        passed: false,
        reason: ExceptionReason.BANK_MISMATCH,
        message: 'Bank name does not match vendor records',
        detail: `OCR bank: "${ocrBankInfo.bank_name}" vs Vendor bank: "${vendorBankInfo.bank_name}"`,
      };
    }
  }

  // Compare SWIFT code
  if (vendorBankInfo.swift_code && ocrBankInfo.swift_code) {
    if (vendorBankInfo.swift_code !== ocrBankInfo.swift_code) {
      return {
        passed: false,
        reason: ExceptionReason.BANK_MISMATCH,
        message: 'SWIFT code does not match vendor records',
        detail: `OCR SWIFT: "${ocrBankInfo.swift_code}" vs Vendor SWIFT: "${vendorBankInfo.swift_code}"`,
      };
    }
  }

  return {
    passed: true,
    message: 'Bank details match vendor records',
  };
}

function validateSignatures(signatures: any[]): ValidationResult {
  // For now, signature validation is optional
  // In production, this would check for required signatures based on invoice type and amount
  
  if (!signatures || signatures.length === 0) {
    return {
      passed: true,
      message: 'No signatures detected - manual review recommended',
    };
  }

  // Check if at least one signature is present
  const hasValidSignature = signatures.some(sig => sig.signer_name && sig.signer_name.length > 0);

  if (hasValidSignature) {
    return {
      passed: true,
      message: 'Signature detected',
    };
  }

  return {
    passed: false,
    reason: ExceptionReason.MISSING_SIGNATURE,
    message: 'No valid signatures found',
    detail: 'Invoice requires at least one valid signature',
  };
}

async function checkDuplicateInvoice(invoice: any): Promise<ValidationResult> {
  // Check for duplicate invoice number from the same vendor
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

function checkLateSubmission(invoice: any): ValidationResult {
  const invoiceDate = new Date(invoice.invoice_date);
  const receivedDate = new Date(invoice.invoice_received_date);
  
  const daysDiff = Math.floor((receivedDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > LATE_SUBMISSION_DAYS) {
    return {
      passed: false,
      reason: ExceptionReason.LATE_SUBMISSION,
      message: 'Invoice submitted late',
      detail: `Invoice submitted ${daysDiff} days after invoice date (threshold: ${LATE_SUBMISSION_DAYS} days)`,
    };
  }

  return {
    passed: true,
    message: 'Invoice submitted within acceptable timeframe',
  };
}

function checkUrgentPayment(invoice: any): ValidationResult {
  if (!invoice.invoice_due_date) {
    return {
      passed: true,
      message: 'No due date specified - cannot determine urgency',
    };
  }

  const dueDate = new Date(invoice.invoice_due_date);
  const today = new Date();
  
  const daysUntilDue = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilDue <= URGENT_PAYMENT_DAYS && daysUntilDue > 0) {
    return {
      passed: false,
      reason: ExceptionReason.URGENT_PAYMENT,
      message: 'Urgent payment required',
      detail: `Invoice due in ${daysUntilDue} days (threshold: ${URGENT_PAYMENT_DAYS} days)`,
    };
  }

  return {
    passed: true,
    message: 'Payment is not urgent',
  };
}

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

  // Validate currency code (3-letter ISO code)
  const validCurrency = /^[A-Z]{3}$/.test(invoice.currency);
  if (!validCurrency) {
    return {
      passed: false,
      reason: ExceptionReason.AMOUNT_MISMATCH,
      message: 'Invalid currency code',
      detail: `Currency "${invoice.currency}" is not a valid ISO 4217 code`,
    };
  }

  return {
    passed: true,
    message: 'Currency and amount are valid',
  };
}
