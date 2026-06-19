import express, { Router } from 'express';
import { getPaidPIMissingCI, autoCreateCIFollowUpTask, sendCIFollowUp } from '../services/piFollowUpService';

const router: Router = express.Router();

/**
 * GET /api/pi-follow-up/paid-missing-ci
 * Get all Proforma Invoices that have been paid but are missing CI/SI
 */
router.get('/paid-missing-ci', async (req, res) => {
  try {
    const invoices = await getPaidPIMissingCI();
    res.json(invoices);
  } catch (error) {
    console.error('Error fetching paid PIs missing CI:', error);
    res.status(500).json({ error: 'Failed to fetch paid PIs missing CI' });
  }
});

/**
 * POST /api/pi-follow-up/auto-create-task
 * Auto-create follow-up task when Proforma Invoice is paid
 */
router.post('/auto-create-task', async (req, res) => {
  try {
    const { invoiceId, paidAt } = req.body;
    await autoCreateCIFollowUpTask(invoiceId, new Date(paidAt));
    res.json({ success: true });
  } catch (error) {
    console.error('Error auto-creating CI follow-up task:', error);
    res.status(500).json({ error: 'Failed to auto-create CI follow-up task' });
  }
});

/**
 * POST /api/pi-follow-up/send-follow-up
 * Send follow-up notification to vendor for CI
 */
router.post('/send-follow-up', async (req, res) => {
  try {
    const { invoiceId, userId } = req.body;
    const result = await sendCIFollowUp(invoiceId, userId);
    res.json(result);
  } catch (error) {
    console.error('Error sending CI follow-up:', error);
    res.status(500).json({ error: 'Failed to send CI follow-up' });
  }
});

export default router;
