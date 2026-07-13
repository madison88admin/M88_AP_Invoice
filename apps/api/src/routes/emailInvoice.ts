import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { emailInvoiceUpload, manualInvoiceUpload } from '../controllers/emailInvoice';
import upload from '../middleware/upload';

const router: Router = Router();

// All email intake endpoints use API key auth (no JWT required)
router.use(apiKeyAuth);

// Power Automate Flow 1: Supplier Invoice Intake
// Accepts multipart form data: file + email metadata fields
router.post('/invoice', upload.single('file'), emailInvoiceUpload);

// Manual invoice upload (same processing, different source)
router.post('/manual-invoice', upload.single('file'), manualInvoiceUpload);

export default router;
