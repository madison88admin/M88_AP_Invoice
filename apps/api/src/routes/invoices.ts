import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as invoiceController from '../controllers/invoices';
import * as uploadController from '../controllers/upload';
import * as validationController from '../controllers/validation';
import * as approvalController from '../controllers/approval';
import * as postingController from '../controllers/posting';
import * as correctionController from '../controllers/correction';
import upload from '../middleware/upload';
import { UserRole } from '@ap-invoice/shared';
import { poAuditService } from '../services/poAuditService';

const router = Router() as Router;

// Authentication is required for all invoice routes, including uploads.
router.use(authenticate);

// Invoice upload endpoints (auth + role required)
const invoiceUploadRoles = [
  UserRole.PURCHASING_COORDINATOR,
  UserRole.ACCOUNTING_ASSOCIATE,
  UserRole.IT_ADMIN,
  UserRole.INVOICE_UPLOADER,
] as const;

router.post('/upload', authorize(...invoiceUploadRoles), upload.single('file'), uploadController.uploadInvoice);
router.post('/upload-madison', authorize(...invoiceUploadRoles), upload.single('file'), uploadController.uploadMadisonInvoice);
router.post('/upload-madison-async', authorize(...invoiceUploadRoles), upload.single('file'), uploadController.uploadMadisonInvoiceAsync);
router.get('/upload-jobs/:jobId', uploadController.getUploadJobStatus);

// DSRS v7.3 async PO audit polling endpoint — informational only, non-blocking
router.get('/:id/po-status', async (req, res, next) => {
  try {
    const result = poAuditService.getAuditResult(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
router.post('/:id/confirm-ocr', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), uploadController.confirmOCR);
router.post('/:id/correct-extraction', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), correctionController.saveCorrection);
router.post('/corrections', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), correctionController.saveStandaloneCorrection);
router.post('/corrections/similar', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), correctionController.getSimilarCorrections);
router.get('/:id/timeline', invoiceController.getInvoiceTimeline);
router.get('/:id/document', invoiceController.viewInvoiceDocument);
router.post('/:id/validate', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), validationController.validateInvoiceAsyncController);
router.post('/:id/validate-sync', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), validationController.validateInvoiceController);
router.post('/:id/request-approval', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN), approvalController.requestApproval);
router.post('/:id/approve', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.PURCHASING_MANAGER, UserRole.MLO_ACCOUNT_HOLDER, UserRole.PLANNING_MANAGER, UserRole.SR_MANAGER_GLOBAL_PRODUCTION, UserRole.MS_POLLY, UserRole.PRESIDENT, UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE), approvalController.approveInvoiceController);
router.post('/:id/reject', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.PURCHASING_MANAGER, UserRole.MLO_ACCOUNT_HOLDER, UserRole.PLANNING_MANAGER, UserRole.SR_MANAGER_GLOBAL_PRODUCTION, UserRole.MS_POLLY, UserRole.PRESIDENT, UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE), approvalController.rejectInvoiceController);
router.post('/:id/return', authorize(UserRole.PURCHASING_MANAGER, UserRole.MLO_ACCOUNT_HOLDER, UserRole.PLANNING_MANAGER, UserRole.SR_MANAGER_GLOBAL_PRODUCTION, UserRole.MS_POLLY, UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR), approvalController.returnInvoiceController);
router.post('/:id/post', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.postInvoiceController);
router.post('/:id/release-hold', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.releaseFromHoldController);
router.post('/:id/hold', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN), postingController.holdInvoiceController);
router.post('/:id/schedule-payment', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR), postingController.schedulePaymentController);
router.post('/:id/send-payment-confirmation', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR), postingController.sendPaymentConfirmationController);
router.post('/:id/check-nextgen', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), validationController.checkNextGenAsyncController);
router.post('/:id/check-nextgen-sync', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN, UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR), validationController.checkNextGenChangesController);
router.get('/jobs/:jobId', validationController.getJobStatusController);
router.get('/bank-change-requests', authenticate, invoiceController.getBankChangeRequests);
// Duplicate-invoice report — MUST stay above the bare '/:id' route or it will be shadowed.
router.get('/duplicates', authenticate, invoiceController.getDuplicateInvoices);
router.post('/', authorize(...invoiceUploadRoles), invoiceController.createInvoice);
router.get('/', invoiceController.getInvoices);
router.get('/metadata/payment-terms', authenticate, invoiceController.getDistinctPaymentTerms);
router.get('/metadata/brands', authenticate, invoiceController.getDistinctBrands);
router.get('/:id', invoiceController.getInvoiceById);
router.patch('/:id/status', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), invoiceController.updateInvoiceStatus);
router.patch('/:id', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.PURCHASING_MANAGER, UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), invoiceController.updateInvoice);
router.post('/:id/request-bank-change', authenticate, upload.single('attachment'), invoiceController.requestBankDetailsChange);
// Replace / re-link the actual invoice PDF (uploaded to Supabase Storage)
router.post('/:id/upload-pdf', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), upload.single('file'), uploadController.uploadInvoicePdf);
router.get('/:id/bank-change-requests', authenticate, invoiceController.getBankChangeRequestsForInvoice);
router.get('/bank-change-requests/:requestId/attachment', authenticate, invoiceController.downloadBankChangeAttachment);
router.post('/bank-change-requests/:requestId/approve', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), invoiceController.approveBankChangeRequest);
router.post('/bank-change-requests/:requestId/reject', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), invoiceController.rejectBankChangeRequest);
router.delete('/:id', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.PURCHASING_MANAGER, UserRole.IT_ADMIN), invoiceController.deleteInvoice);

export default router;
