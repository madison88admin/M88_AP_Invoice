import express, { Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { compareBankDetails, autoCheckBankDetails, recheckBankDetailsAgainstQuickBooks } from '../services/bankMatchingService';

const router: Router = express.Router();
router.use(authenticate);

const bankReaders = authorize(
  UserRole.PURCHASING_COORDINATOR,
  UserRole.PURCHASING_MANAGER,
  UserRole.ACCOUNTING_ASSOCIATE,
  UserRole.ACCOUNTING_SUPERVISOR,
  UserRole.IT_ADMIN,
  UserRole.SUPERADMIN,
);

function visibleResult(result: any, role?: UserRole) {
  const purchasing = role === UserRole.PURCHASING_COORDINATOR || role === UserRole.PURCHASING_MANAGER;
  if (!purchasing) return result;
  const differences = Array.isArray(result?.match_details?.differences)
    ? result.match_details.differences.map((value: string) => {
      const text = String(value).toLowerCase();
      if (text.includes('account')) return 'Account Number Mismatch';
      if (text.includes('swift') || text.includes('iban') || text.includes('routing')) return 'SWIFT/IBAN/Routing Mismatch';
      if (text.includes('beneficiary')) return 'Beneficiary Name Mismatch';
      if (text.includes('bank name')) return 'Bank Name Mismatch';
      if (text.includes('missing')) return 'Missing Bank Information';
      return 'Bank Information Mismatch';
    })
    : [];
  return {
    ...result,
    vendor_bank_details: undefined,
    match_details: { ...result.match_details, differences: [...new Set(differences)] },
  };
}

/**
 * POST /api/bank-matching/compare
 * Compare invoice bank details against vendor records
 */
router.post('/compare', bankReaders, async (req: AuthRequest, res) => {
  try {
    const { invoiceId, bankDetails } = req.body;
    const result = await compareBankDetails(invoiceId, bankDetails);
    res.json(visibleResult(result, req.user?.role));
  } catch (error) {
    console.error('Error comparing bank details:', error);
    res.status(500).json({ error: 'Failed to compare bank details' });
  }
});

/**
 * POST /api/bank-matching/auto-check
 * Auto-check bank details from OCR result
 */
router.post('/auto-check', bankReaders, async (req: AuthRequest, res) => {
  try {
    const { invoiceId, ocrBankDetails } = req.body;
    const result = await autoCheckBankDetails(invoiceId, ocrBankDetails);
    res.json(visibleResult(result, req.user?.role));
  } catch (error) {
    console.error('Error auto-checking bank details:', error);
    res.status(500).json({ error: 'Failed to auto-check bank details' });
  }
});

/**
 * POST /api/bank-matching/recheck-qb
 * Re-check bank details against QuickBooks records (Accounting stage)
 */
router.post('/recheck-qb', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req, res) => {
  try {
    const { invoiceId, qbBankDetails } = req.body;
    const result = await recheckBankDetailsAgainstQuickBooks(invoiceId, qbBankDetails);
    res.json(result);
  } catch (error) {
    console.error('Error rechecking bank details against QuickBooks:', error);
    res.status(500).json({ error: 'Failed to recheck bank details against QuickBooks' });
  }
});

export default router;
