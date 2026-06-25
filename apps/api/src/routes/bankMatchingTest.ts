import { Router, Request, Response } from 'express';

const router = Router() as Router;

interface Vendor {
  name: string;
  swift_code: string;
  account_usd: string;
  has_multiple_accounts: boolean;
  alternate_accounts?: { swift_code: string; account_usd: string }[];
}

interface BankMatchResult {
  is_matched: boolean;
  match_status: 'MATCHED' | 'MISMATCH' | 'MULTIPLE_ACCOUNTS' | 'NOT_CHECKED';
  match_details: {
    bank_name_match: boolean;
    account_number_match: boolean;
    swift_code_match: boolean;
    differences: string[];
  };
  requires_cfo_approval?: boolean;
}

// Mock vendor data from requirements
const mockVendors: Vendor[] = [
  {
    name: "Avery Dennison Hong Kong B.V.",
    swift_code: "SCBLHKHHXXX",
    account_usd: "447-0-092572-7",
    has_multiple_accounts: false
  },
  {
    name: "Jointak Labels Company Limited",
    swift_code: "HSBCHKHHHKH",
    account_usd: "004-741-406268-838",
    has_multiple_accounts: true,
    alternate_accounts: [
      { swift_code: "HSBCHKHHHKH", account_usd: "004-741-XXXXXX-XXX" }
    ]
  }
];

/**
 * DB-free bank matching logic for testing
 */
function compareBankDetailsMock(
  vendorName: string,
  invoiceSwift: string,
  invoiceAccount: string
): BankMatchResult {
  const vendor = mockVendors.find(v => v.name === vendorName);
  
  if (!vendor) {
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

  const differences: string[] = [];
  const swiftCodeMatch = invoiceSwift.trim().toUpperCase() === vendor.swift_code.trim().toUpperCase();
  const accountNumberMatch = invoiceAccount.trim() === vendor.account_usd.trim();

  if (!swiftCodeMatch) {
    differences.push(`SWIFT code mismatch: Invoice "${invoiceSwift}" vs Vendor "${vendor.swift_code}"`);
  }
  if (!accountNumberMatch) {
    differences.push(`Account number mismatch`);
  }

  let matchStatus: 'MATCHED' | 'MISMATCH' | 'MULTIPLE_ACCOUNTS' | 'NOT_CHECKED';
  let requiresCfoApproval = false;

  // Check if vendor has multiple bank accounts
  if (vendor.has_multiple_accounts) {
    // Check if matches alternate account
    const matchesAlternate = vendor.alternate_accounts?.some(
      alt => alt.swift_code.trim().toUpperCase() === invoiceSwift.trim().toUpperCase() &&
             alt.account_usd.trim() === invoiceAccount.trim()
    );
    
    if (matchesAlternate) {
      matchStatus = 'MULTIPLE_ACCOUNTS';
      requiresCfoApproval = true;
    } else if (swiftCodeMatch && accountNumberMatch) {
      matchStatus = 'MATCHED';
    } else {
      matchStatus = 'MISMATCH';
    }
  } else if (swiftCodeMatch && accountNumberMatch) {
    matchStatus = 'MATCHED';
  } else {
    matchStatus = 'MISMATCH';
  }

  return {
    is_matched: matchStatus === 'MATCHED',
    match_status: matchStatus,
    match_details: {
      bank_name_match: true, // Assume bank name matches for these tests
      account_number_match: accountNumberMatch,
      swift_code_match: swiftCodeMatch,
      differences,
    },
    requires_cfo_approval: requiresCfoApproval,
  };
}

/**
 * GET /api/bank-matching/test
 * Run 3 test cases against the Bank Matching Service
 */
router.get('/test', (req: Request, res: Response) => {
  const results = [];

  // Case A — exact match: Avery Dennison with correct SWIFT and account
  const caseA = compareBankDetailsMock(
    "Avery Dennison Hong Kong B.V.",
    "SCBLHKHHXXX",
    "447-0-092572-7"
  );
  results.push({
    case: 'A',
    description: 'Exact match: Avery Dennison with correct SWIFT and account',
    expected: { is_matched: true, match_status: 'MATCHED', requires_cfo_approval: false },
    actual: caseA,
    passed: caseA.is_matched === true && caseA.match_status === 'MATCHED' && !caseA.requires_cfo_approval
  });

  // Case B — mismatch: Avery Dennison with correct SWIFT but wrong account
  const caseB = compareBankDetailsMock(
    "Avery Dennison Hong Kong B.V.",
    "SCBLHKHHXXX",
    "999-9-999999-9"
  );
  results.push({
    case: 'B',
    description: 'Mismatch: Avery Dennison with correct SWIFT but wrong account',
    expected: { is_matched: false, match_status: 'MISMATCH', requires_cfo_approval: false },
    actual: caseB,
    passed: caseB.is_matched === false && caseB.match_status === 'MISMATCH' && !caseB.requires_cfo_approval
  });

  // Case C — multiple accounts: Jointak with alternate account
  const caseC = compareBankDetailsMock(
    "Jointak Labels Company Limited",
    "HSBCHKHHHKH",
    "004-741-XXXXXX-XXX"
  );
  results.push({
    case: 'C',
    description: 'Multiple accounts: Jointak with alternate account (not primary)',
    expected: { is_matched: false, match_status: 'MULTIPLE_ACCOUNTS', requires_cfo_approval: true },
    actual: caseC,
    passed: caseC.is_matched === false && caseC.match_status === 'MULTIPLE_ACCOUNTS' && caseC.requires_cfo_approval === true
  });

  const summary = {
    total: 3,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };

  res.json(summary);
});

export default router;
