import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import * as reprocessController from '../controllers/reprocess';

const router: Router = Router();

router.use(authenticate);

// Reprocess a single invoice (cancel payment, reset, re-validate, regenerate approval)
router.post('/:id/reprocess', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), reprocessController.reprocessInvoiceController);

// Bulk reprocess multiple invoices
router.post('/bulk-reprocess', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), reprocessController.reprocessInvoicesController);

// Re-extract a single invoice (re-run OCR + AI extraction pipeline on original PDF)
router.post('/:id/re-extract', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.PURCHASING_COORDINATOR), reprocessController.reExtractInvoiceController);

// Bulk re-extract multiple invoices
router.post('/bulk-re-extract', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), reprocessController.reExtractInvoicesController);

export default router;
