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
 * SharePoint/OneDrive Webhook Endpoint (API key auth)
 * Called by Power Automate when file is saved to SharePoint/OneDrive
 * Expects: { fileName, emailSubject, fromAddress, receivedDateTime, fileContentBase64?, sharepointUrl? }
 * Headers: x-api-key: <WEBHOOK_API_KEY>
 * If fileContentBase64 is provided, API processes directly (no download needed).
 * If only sharepointUrl is provided, API downloads from SharePoint.
 * Returns: { jobId } — process runs async, poll /api/invoices/jobs/:jobId for status
 */
router.post('/sharepoint-webhook', webhookApiKey, async (req, res, next) => {
  try {
    const { 
      sharepointUrl, 
      fileName, 
      emailSubject, 
      fromAddress, 
      receivedDateTime,
      fileContentBase64,
      contentType,
    } = req.body;

    if (!fileName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: fileName' 
      });
    }

    if (!fileContentBase64 && !sharepointUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Either fileContentBase64 or sharepointUrl is required' 
      });
    }

    const jobId = createJob('sharepoint-intake');

    setImmediate(async () => {
      try {
        let result;
        if (fileContentBase64) {
          // Power Automate sent the file content directly — no need to download
          result = await processPowerAutomateAttachment({
            attachmentBase64: fileContentBase64,
            fileName,
            contentType: contentType || 'application/pdf',
            emailSubject: emailSubject || '',
            fromAddress: fromAddress || '',
            receivedDateTime: receivedDateTime || new Date().toISOString(),
          });
        } else {
          // Fall back to downloading from SharePoint URL
          result = await processSharePointFile({
            sharepointUrl,
            fileName,
            emailSubject: emailSubject || '',
            fromAddress: fromAddress || '',
            receivedDateTime: receivedDateTime || new Date().toISOString(),
          });
        }
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
      message: `File ${fileName} received, processing started` 
    });
  } catch (error) {
    next(error);
  }
});

export default router;
