import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router() as Router;

interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  invoice_date: string;
  invoice_number: string;
}

// In-memory invoice database for testing
const invoiceDB: Invoice[] = [
  {
    id: "existing-1",
    vendor: "UPW Limited",
    amount: 174.87,
    invoice_date: "2026-01-19",
    invoice_number: "DC13675"
  }
];

/**
 * DB-free duplicate detection logic for testing
 */
function checkDuplicateFuzzyMock(invoice: Invoice): { passed: boolean; message: string; detail?: string } {
  // Primary check: exact match on invoice_number + vendor
  const exactDuplicate = invoiceDB.find(
    inv => inv.invoice_number === invoice.invoice_number && inv.vendor === invoice.vendor && inv.id !== invoice.id
  );
  
  if (exactDuplicate) {
    return {
      passed: false,
      message: 'Duplicate invoice detected',
      detail: `Invoice ${invoice.invoice_number} already exists for this vendor (ID: ${exactDuplicate.id})`,
    };
  }

  // Secondary fuzzy check: same vendor + same amount + date within ±3 days, different invoice number
  const invoiceDate = new Date(invoice.invoice_date);
  const threeDaysBefore = new Date(invoiceDate.getTime() - 3 * 24 * 60 * 60 * 1000);
  const threeDaysAfter = new Date(invoiceDate.getTime() + 3 * 24 * 60 * 60 * 1000);

  const fuzzyDuplicate = invoiceDB.find(
    inv => inv.vendor === invoice.vendor &&
           inv.amount === invoice.amount &&
           inv.invoice_number !== invoice.invoice_number &&
           inv.id !== invoice.id
  );

  if (fuzzyDuplicate) {
    const existingDate = new Date(fuzzyDuplicate.invoice_date);
    if (existingDate >= threeDaysBefore && existingDate <= threeDaysAfter) {
      return {
        passed: false,
        message: 'Suspected duplicate invoice detected (fuzzy match)',
        detail: `Invoice with different number (${fuzzyDuplicate.invoice_number}) but same vendor, amount, and date within ±3 days (ID: ${fuzzyDuplicate.id})`,
      };
    }
  }

  return {
    passed: true,
    message: 'No duplicate invoice found',
  };
}

/**
 * GET /api/duplicate-detection-test/test
 * Test duplicate detection secondary fuzzy check
 */
router.get('/test', (req: Request, res: Response) => {
  const results = [];

  // Test Case 1: Invoice 1 - should match existing (exact duplicate)
  const invoice1: Invoice = {
    id: "test-1",
    vendor: "UPW Limited",
    amount: 174.87,
    invoice_date: "2026-01-19",
    invoice_number: "DC13675"
  };
  const result1 = checkDuplicateFuzzyMock(invoice1);
  results.push({
    case: 'Invoice 1',
    description: 'Exact duplicate: same vendor, amount, date, and invoice number',
    expected: { passed: false, message: 'Duplicate invoice detected' },
    actual: { passed: result1.passed, message: result1.message },
    passed: !result1.passed && result1.message === 'Duplicate invoice detected'
  });

  // Test Case 2: Invoice 2 - should flag as suspected duplicate (fuzzy match)
  const invoice2: Invoice = {
    id: "test-2",
    vendor: "UPW Limited",
    amount: 174.87,
    invoice_date: "2026-01-20",
    invoice_number: "DC13675-REV"
  };
  const result2 = checkDuplicateFuzzyMock(invoice2);
  results.push({
    case: 'Invoice 2',
    description: 'Fuzzy duplicate: same vendor, amount, date within ±3 days, different invoice number',
    expected: { passed: false, message: 'Suspected duplicate invoice detected (fuzzy match)' },
    actual: { passed: result2.passed, message: result2.message },
    passed: !result2.passed && result2.message === 'Suspected duplicate invoice detected (fuzzy match)'
  });

  // Test Case 3: Clean invoice - should pass (different vendor)
  const invoice3: Invoice = {
    id: "test-3",
    vendor: "Avery Dennison",
    amount: 174.87,
    invoice_date: "2026-01-20",
    invoice_number: "DC13675-REV"
  };
  const result3 = checkDuplicateFuzzyMock(invoice3);
  results.push({
    case: 'Invoice 3',
    description: 'Clean invoice: different vendor, same amount and date',
    expected: { passed: true, message: 'No duplicate invoice found' },
    actual: { passed: result3.passed, message: result3.message },
    passed: result3.passed && result3.message === 'No duplicate invoice found'
  });

  // Test Case 4: Clean invoice - should pass (date outside ±3 days)
  const invoice4: Invoice = {
    id: "test-4",
    vendor: "UPW Limited",
    amount: 174.87,
    invoice_date: "2026-01-25",
    invoice_number: "DC13675-REV"
  };
  const result4 = checkDuplicateFuzzyMock(invoice4);
  results.push({
    case: 'Invoice 4',
    description: 'Clean invoice: same vendor and amount, but date outside ±3 days',
    expected: { passed: true, message: 'No duplicate invoice found' },
    actual: { passed: result4.passed, message: result4.message },
    passed: result4.passed && result4.message === 'No duplicate invoice found'
  });

  const summary = {
    total: 4,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };

  res.json(summary);
});

export default router;
