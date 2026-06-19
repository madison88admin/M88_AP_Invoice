import express, { Router } from 'express';
import { compareBankDetails, autoCheckBankDetails, recheckBankDetailsAgainstQuickBooks } from '../services/bankMatchingService';

const router: Router = express.Router();

/**
 * POST /api/bank-matching/compare
 * Compare invoice bank details against vendor records
 */
router.post('/compare', async (req, res) => {
  try {
    const { invoiceId, bankDetails } = req.body;
    const result = await compareBankDetails(invoiceId, bankDetails);
    res.json(result);
  } catch (error) {
    console.error('Error comparing bank details:', error);
    res.status(500).json({ error: 'Failed to compare bank details' });
  }
});

/**
 * POST /api/bank-matching/auto-check
 * Auto-check bank details from OCR result
 */
router.post('/auto-check', async (req, res) => {
  try {
    const { invoiceId, ocrBankDetails } = req.body;
    const result = await autoCheckBankDetails(invoiceId, ocrBankDetails);
    res.json(result);
  } catch (error) {
    console.error('Error auto-checking bank details:', error);
    res.status(500).json({ error: 'Failed to auto-check bank details' });
  }
});

/**
 * POST /api/bank-matching/recheck-qb
 * Re-check bank details against QuickBooks records (Accounting stage)
 */
router.post('/recheck-qb', async (req, res) => {
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
