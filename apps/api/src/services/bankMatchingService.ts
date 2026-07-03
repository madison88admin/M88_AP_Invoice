import prisma from '../config/database';
import { logger } from '../utils/logger';

export interface BankMatchResult {
  is_matched: boolean;
  match_status: 'MATCHED' | 'MISMATCH' | 'MULTIPLE_ACCOUNTS' | 'NOT_CHECKED';
  match_details: {
    bank_name_match: boolean;
    account_number_match: boolean;
    swift_code_match: boolean;
    iban_match?: boolean;
    differences: string[];
  };
  vendor_bank_details?: {
    bank_name?: string;
    account_number?: string;
    swift_code?: string;
    iban?: string;
  };
  invoice_bank_details?: {
    bank_name?: string;
    account_number?: string;
    swift_code?: string;
    iban?: string;
  };
  requires_cfo_approval?: boolean;
}

/**
 * Compare invoice bank details against vendor records
 * Returns match status and detailed comparison
 */
export async function compareBankDetails(
  invoiceId: string,
  invoiceBankDetails: {
    bank_name?: string;
    account_number?: string;
    swift_code?: string;
    iban?: string;
  }
): Promise<BankMatchResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice || !invoice.vendor) {
    return {
      is_matched: false,
      match_status: 'NOT_CHECKED',
      match_details: {
        bank_name_match: false,
        account_number_match: false,
        swift_code_match: false,
        differences: ['Vendor not found'],
      },
    };
  }

  const vendor = invoice.vendor as any;
  const differences: string[] = [];
  let bankNameMatch = false;
  let accountNumberMatch = false;
  let swiftCodeMatch = false;
  let ibanMatch = false;

  // Compare bank name (case-insensitive, partial match allowed) including bank_name_alt aliases
  if (invoiceBankDetails.bank_name) {
    const invBankName = invoiceBankDetails.bank_name.toLowerCase().trim();
    const vendorBankNames = [vendor.bank_name, ...(vendor.bank_name_alt || [])].filter(Boolean);

    for (const vendBankNameRaw of vendorBankNames) {
      const vendBankName = vendBankNameRaw!.toLowerCase().trim();
      if (
        invBankName === vendBankName ||
        invBankName.includes(vendBankName) ||
        vendBankName.includes(invBankName)
      ) {
        bankNameMatch = true;
        break;
      }
    }

    if (!bankNameMatch) {
      const primaryBankName = vendor.bank_name || 'N/A';
      const altBankNames = vendor.bank_name_alt?.join(', ') || 'none';
      differences.push(`Bank name mismatch: Invoice "${invoiceBankDetails.bank_name}" vs Vendor "${primaryBankName}" (alt: ${altBankNames})`);
    }
  } else if (!invoiceBankDetails.bank_name && !vendor.bank_name) {
    // Both missing - can't verify
    differences.push('Bank name missing from both invoice and vendor record');
  } else {
    differences.push(`Bank name missing from ${invoiceBankDetails.bank_name ? 'vendor' : 'invoice'}`);
  }

  // Compare account number (exact match required) including account_number_alt aliases
  if (invoiceBankDetails.account_number) {
    const invAccount = invoiceBankDetails.account_number.trim();
    const vendorAccounts = [vendor.account_number, ...(vendor.account_number_alt || [])].filter(Boolean);

    for (const vendAccountRaw of vendorAccounts) {
      if (invAccount === vendAccountRaw!.trim()) {
        accountNumberMatch = true;
        break;
      }
    }

    if (!accountNumberMatch) {
      const primaryAccount = vendor.account_number || 'N/A';
      const altAccounts = vendor.account_number_alt?.join(', ') || 'none';
      differences.push(`Account number mismatch: Invoice "${invoiceBankDetails.account_number}" vs Vendor "${primaryAccount}" (alt: ${altAccounts})`);
    }
  } else if (!invoiceBankDetails.account_number && !vendor.account_number) {
    differences.push('Account number missing from both invoice and vendor record');
  } else {
    differences.push(`Account number missing from ${invoiceBankDetails.account_number ? 'vendor' : 'invoice'}`);
  }

  // Compare SWIFT code (exact match required) including swift_code_alt aliases
  if (invoiceBankDetails.swift_code) {
    const invSwift = invoiceBankDetails.swift_code.trim().toUpperCase();
    const vendorSwifts = [vendor.swift_code, ...(vendor.swift_code_alt || [])].filter(Boolean);

    for (const vendSwiftRaw of vendorSwifts) {
      if (invSwift === vendSwiftRaw!.trim().toUpperCase()) {
        swiftCodeMatch = true;
        break;
      }
    }

    if (!swiftCodeMatch) {
      const primarySwift = vendor.swift_code || 'N/A';
      const altSwifts = vendor.swift_code_alt?.join(', ') || 'none';
      differences.push(`SWIFT code mismatch: Invoice "${invoiceBankDetails.swift_code}" vs Vendor "${primarySwift}" (alt: ${altSwifts})`);
    }
  } else if (!invoiceBankDetails.swift_code && !vendor.swift_code) {
    differences.push('SWIFT code missing from both invoice and vendor record');
  } else {
    differences.push(`SWIFT code missing from ${invoiceBankDetails.swift_code ? 'vendor' : 'invoice'}`);
  }

  // Compare IBAN if present (exact match required)
  if (invoiceBankDetails.iban && vendor.iban) {
    ibanMatch = invoiceBankDetails.iban.trim().toUpperCase() === vendor.iban.trim().toUpperCase();
    if (!ibanMatch) {
      differences.push(`IBAN mismatch`);
    }
  }

  // Determine overall match status
  const allMatched = bankNameMatch && accountNumberMatch && swiftCodeMatch;
  const hasCriticalMismatch = !accountNumberMatch || !swiftCodeMatch;

  let matchStatus: 'MATCHED' | 'MISMATCH' | 'MULTIPLE_ACCOUNTS' | 'NOT_CHECKED';
  let requiresCfoApproval = false;

  // Check if vendor has multiple bank accounts (e.g., Jointak)
  if ((vendor as any).has_multiple_accounts) {
    matchStatus = 'MULTIPLE_ACCOUNTS';
    requiresCfoApproval = true;
  } else if (!allMatched && hasCriticalMismatch) {
    matchStatus = 'MISMATCH';
  } else if (allMatched) {
    matchStatus = 'MATCHED';
  } else {
    matchStatus = 'NOT_CHECKED';
  }

  // Update invoice with bank match results
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      bank_match_status: matchStatus as any,
      bank_match_details: {
        bank_name_match: bankNameMatch,
        account_number_match: accountNumberMatch,
        swift_code_match: swiftCodeMatch,
        iban_match: ibanMatch,
        differences,
        requires_cfo_approval: requiresCfoApproval,
        invoice_bank_details: invoiceBankDetails,
        vendor_bank_details: {
          bank_name: vendor.bank_name || undefined,
          account_number: vendor.account_number || undefined,
          swift_code: vendor.swift_code || undefined,
          iban: vendor.iban || undefined,
        },
      } as any,
    } as any,
  });

  const result: BankMatchResult = {
    is_matched: matchStatus === 'MATCHED',
    match_status: matchStatus,
    match_details: {
      bank_name_match: bankNameMatch,
      account_number_match: accountNumberMatch,
      swift_code_match: swiftCodeMatch,
      iban_match: ibanMatch,
      differences,
    },
    vendor_bank_details: {
      bank_name: vendor.bank_name || undefined,
      account_number: vendor.account_number || undefined,
      swift_code: vendor.swift_code || undefined,
      iban: vendor.iban || undefined,
    },
    invoice_bank_details: invoiceBankDetails,
    requires_cfo_approval: requiresCfoApproval,
  };

  logger.info(`Bank match completed for invoice ${invoice.invoice_number}: ${matchStatus}`);

  return result;
}

/**
 * Auto-check bank details from OCR result
 * Called during invoice processing
 */
export async function autoCheckBankDetails(
  invoiceId: string,
  ocrBankDetails: {
    bank_name?: string;
    account_number?: string;
    swift_code?: string;
    iban?: string;
  }
): Promise<BankMatchResult> {
  return compareBankDetails(invoiceId, ocrBankDetails);
}

/**
 * Re-check bank details against QuickBooks records (Accounting stage)
 * This is the 2-stage control: Purchasing checks vs VML, Accounting checks vs QB
 */
export async function recheckBankDetailsAgainstQuickBooks(
  invoiceId: string,
  qbBankDetails: {
    bank_name?: string;
    account_number?: string;
    swift_code?: string;
    iban?: string;
  }
): Promise<BankMatchResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: true },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Compare OCR bank details with QuickBooks bank details
  const differences: string[] = [];
  let bankNameMatch = false;
  let accountNumberMatch = false;
  let swiftCodeMatch = false;

  const bankMatchDetails = (invoice as any).bank_match_details;
  const invoiceBankDetails = bankMatchDetails?.invoice_bank_details;

  if (qbBankDetails.bank_name && invoiceBankDetails?.bank_name) {
    const qbBankName = qbBankDetails.bank_name.toLowerCase().trim();
    const ocrBankName = invoiceBankDetails.bank_name.toLowerCase().trim();
    bankNameMatch = qbBankName === ocrBankName;
    if (!bankNameMatch) {
      differences.push(`QuickBooks bank name mismatch: QB "${qbBankDetails.bank_name}" vs OCR "${invoiceBankDetails.bank_name}"`);
    }
  }

  if (qbBankDetails.account_number && invoiceBankDetails?.account_number) {
    accountNumberMatch = qbBankDetails.account_number.trim() === invoiceBankDetails.account_number.trim();
    if (!accountNumberMatch) {
      differences.push(`QuickBooks account number mismatch`);
    }
  }

  if (qbBankDetails.swift_code && invoiceBankDetails?.swift_code) {
    swiftCodeMatch = qbBankDetails.swift_code.trim().toUpperCase() === invoiceBankDetails.swift_code.trim().toUpperCase();
    if (!swiftCodeMatch) {
      differences.push(`QuickBooks SWIFT code mismatch`);
    }
  }

  const allMatched = bankNameMatch && accountNumberMatch && swiftCodeMatch;
  const matchStatus = allMatched ? 'MATCHED' : 'MISMATCH';

  // Update invoice with QB recheck results
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      bank_match_details: {
        ...(bankMatchDetails || {}),
        qb_recheck_status: matchStatus,
        qb_recheck_details: {
          bank_name_match: bankNameMatch,
          account_number_match: accountNumberMatch,
          swift_code_match: swiftCodeMatch,
          differences,
          qb_bank_details: qbBankDetails,
        },
      } as any,
    } as any,
  });

  logger.info(`QuickBooks bank recheck completed for invoice ${invoice.invoice_number}: ${matchStatus}`);

  return {
    is_matched: matchStatus === 'MATCHED',
    match_status: matchStatus,
    match_details: {
      bank_name_match: bankNameMatch,
      account_number_match: accountNumberMatch,
      swift_code_match: swiftCodeMatch,
      differences,
    },
    invoice_bank_details: invoiceBankDetails,
  };
}
