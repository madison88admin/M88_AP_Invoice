import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { startEmailPoller, processPowerAutomateAttachment, processSharePointFile } from '../services/emailIntakeService';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.post('/start-poller', authorize(UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req, res, next) => {
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
 * Power Automate Webhook Endpoint (No authentication for Power Automate)
 * Called by Power Automate flow when new invoice email arrives
 * Expects: { attachmentBase64, fileName, contentType, emailSubject, fromAddress, receivedDateTime }
 */
router.post('/powerautomate-webhook', async (req, res, next) => {
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

    const result = await processPowerAutomateAttachment({
      attachmentBase64,
      fileName,
      contentType: contentType || 'application/pdf',
      emailSubject: emailSubject || '',
      fromAddress: fromAddress || '',
      receivedDateTime: receivedDateTime || new Date().toISOString(),
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * SharePoint-triggered Webhook Endpoint
 * Called by Power Automate when file is saved to SharePoint
 * Expects: { sharepointUrl, fileName, emailSubject, fromAddress, receivedDateTime }
 * API will download file from SharePoint and process it
 */
router.post('/sharepoint-webhook', async (req, res, next) => {
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

    const result = await processSharePointFile({
      sharepointUrl,
      fileName,
      emailSubject: emailSubject || '',
      fromAddress: fromAddress || '',
      receivedDateTime: receivedDateTime || new Date().toISOString(),
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
