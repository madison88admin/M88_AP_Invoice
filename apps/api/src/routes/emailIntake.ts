import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { startEmailPoller, processPowerAutomateAttachment, processSharePointFile } from '../services/emailIntakeService';
import { createJob, completeJob, failJob, getJob, cleanupOldJobs } from '../services/jobStore';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

// Simple API key middleware for webhook endpoints (Power Automate can't send JWT)
const webhookApiKey = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'] || req.body.apiKey;
  if (!apiKey || apiKey !== process.env.WEBHOOK_API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
};

// Authenticated routes (for admin UI)
router.post('/start-poller', authenticate, authorize(UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req, res, next) => {
  try {
    const { interval } = req.body;
    const intervalMinutes = interval || 5;
    
    startEmailPoller(intervalMinutes);
    
    res.json({ 
      success: true, 
      message: `Email poller started with ${intervalMinutes} minute interval` 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Power Automate Webhook Endpoint (API key auth, not JWT)
 * Called by Power Automate flow when new invoice email arrives
 * Expects: { attachmentBase64, fileName, contentType, emailSubject, fromAddress, receivedDateTime }
 * Headers: x-api-key: <WEBHOOK_API_KEY>
 * Returns: { jobId } — process runs async, poll /api/invoices/jobs/:jobId for status
 */
router.post('/powerautomate-webhook', webhookApiKey, async (req, res, next) => {
  try {
    const { 
      attachmentBase64, 
      fileName, 
      contentType, 
      emailSubject, 
      fromAddress, 
      receivedDateTime 
    } = req.body;

    if (!attachmentBase64 || !fileName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: attachmentBase64, fileName' 
      });
    }

    const jobId = createJob('powerautomate-intake');

    setImmediate(async () => {
      try {
        const result = await processPowerAutomateAttachment({
          attachmentBase64,
          fileName,
          contentType: contentType || 'application/pdf',
          emailSubject: emailSubject || '',
          fromAddress: fromAddress || '',
          receivedDateTime: receivedDateTime || new Date().toISOString(),
        });
        completeJob(jobId, result);
      } catch (error: any) {
        failJob(jobId, error.message || String(error));
      }
      cleanupOldJobs();
    });

    res.status(202).json({ 
      success: true, 
      jobId, 
      status: 'processing',
      message: `Attachment ${fileName} received, processing started` 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * SharePoint-triggered Webhook Endpoint (API key auth)
 * Called by Power Automate when file is saved to SharePoint
 * Expects: { sharepointUrl, fileName, emailSubject, fromAddress, receivedDateTime }
 * Headers: x-api-key: <WEBHOOK_API_KEY>
 * Returns: { jobId } — process runs async, poll /api/invoices/jobs/:jobId for status
 */
router.post('/sharepoint-webhook', webhookApiKey, async (req, res, next) => {
  try {
    const { 
      sharepointUrl, 
      fileName, 
      emailSubject, 
      fromAddress, 
      receivedDateTime 
    } = req.body;

    if (!sharepointUrl || !fileName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: sharepointUrl, fileName' 
      });
    }

    const jobId = createJob('sharepoint-intake');

    setImmediate(async () => {
      try {
        const result = await processSharePointFile({
          sharepointUrl,
          fileName,
          emailSubject: emailSubject || '',
          fromAddress: fromAddress || '',
          receivedDateTime: receivedDateTime || new Date().toISOString(),
        });
        completeJob(jobId, result);
      } catch (error: any) {
        failJob(jobId, error.message || String(error));
      }
      cleanupOldJobs();
    });

    res.status(202).json({ 
      success: true, 
      jobId, 
      status: 'processing',
      message: `SharePoint file ${fileName} received, processing started` 
    });
  } catch (error) {
    next(error);
  }
});

export default router;
