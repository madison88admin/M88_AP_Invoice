import express, { Router } from 'express';
import { checkAndSendSLAReminders, getSLACountdown } from '../services/slaReminderService';

const router: Router = express.Router();

/**
 * POST /api/sla-reminder/check
 * Check for invoices approaching SLA breach and send reminders
 * This should be called periodically (e.g., every hour via cron)
 */
router.post('/check', async (req, res) => {
  try {
    const result = await checkAndSendSLAReminders();
    res.json(result);
  } catch (error) {
    console.error('Error checking SLA reminders:', error);
    res.status(500).json({ error: 'Failed to check SLA reminders' });
  }
});

/**
 * GET /api/sla-reminder/countdown/:invoiceId
 * Get SLA countdown for a specific invoice
 */
router.get('/countdown/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const countdown = await getSLACountdown(invoiceId);
    res.json(countdown);
  } catch (error) {
    console.error('Error fetching SLA countdown:', error);
    res.status(500).json({ error: 'Failed to fetch SLA countdown' });
  }
});

export default router;
