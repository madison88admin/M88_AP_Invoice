import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { uploadPaymentConfirmation, getConfirmationJobStatus } from '../controllers/paymentConfirmation';
import upload from '../middleware/upload';

const router: Router = Router();

// All payment confirmation endpoints use API key auth
router.use(apiKeyAuth);

// Power Automate Flow 2: Citibank Payment Confirmation
// Accepts multipart form data: file + email metadata
router.post('/upload', upload.single('file'), uploadPaymentConfirmation);

// Check async job status
router.get('/jobs/:jobId', getConfirmationJobStatus);

export default router;
