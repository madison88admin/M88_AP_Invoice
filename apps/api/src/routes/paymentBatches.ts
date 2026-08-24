import { Router } from 'express';
import path from 'path';
import { authenticate, authorize } from '../middleware/auth';
import * as paymentBatchController from '../controllers/paymentBatch';
import upload from '../middleware/upload';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.get('/scheduled-payments', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.PURCHASING_COORDINATOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getScheduledPaymentsForBatchController);
router.get('/reconciliation', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.exportReconciliationController);
router.get('/stuck', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.PURCHASING_COORDINATOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getStuckBatchesController);
router.get('/', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getPaymentBatchesController);
router.get('/proofs/:fileName', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN), (req, res) => {
  const uploadRoot = process.env.PAYMENT_PROOF_DIR || path.join(process.cwd(), 'data', 'payment-proofs');
  res.sendFile(path.join(uploadRoot, path.basename(req.params.fileName)));
});
router.get('/:batchId', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getPaymentBatchByIdController);
router.post('/', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), paymentBatchController.createPaymentBatchController);
router.post('/select', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), paymentBatchController.selectPaymentsForBatchController);
router.post('/deselect', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), paymentBatchController.deselectPaymentsForBatchController);
router.post('/payments/bulk-approve-for-payment', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.bulkApprovePaymentsForPaymentController);
router.post('/payments/:paymentId/remarks', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.setPaymentRemarksController);
router.post('/payments/:paymentId/for-payment', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.markPaymentForPaymentController);
router.post('/payments/:paymentId/approve-for-payment', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.approvePaymentForPaymentController);
router.post('/payments/:paymentId/reject-for-payment', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.rejectPaymentForPaymentController);
router.post('/payments/:paymentId/approve-held', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.approveHeldPaymentController);
router.post('/:batchId/bank-charge', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.applyBankChargeController);
router.delete('/:batchId/bank-charge/:paymentId', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.removeBankChargeController);
router.post('/:batchId/payments/:paymentId/endorse', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR), upload.single('stubFile'), paymentBatchController.endorseBillStubController);
router.post('/:batchId/match-confirmation', authorize(UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.matchPaymentConfirmationController);
router.post('/:batchId/submit', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.submitPaymentBatchController);
router.post('/:batchId/review', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.reviewPaymentBatchController);
router.post('/:batchId/return', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.returnPaymentBatchController);
router.post('/:batchId/return-invoices', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.returnInvoicesFromBatchController);
router.post('/:batchId/export', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.exportPaymentBatchController);
router.post('/:batchId/submit-cfo', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.submitPaymentBatchForCfoController);
router.get('/:batchId/export-per-vendor', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.exportBatchPerVendorController);
router.post('/:batchId/process', authorize(UserRole.CFO, UserRole.IT_ADMIN), upload.single('proof'), paymentBatchController.processPaymentBatchController);
router.post('/:batchId/cancel', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.cancelPaymentBatchController);

export default router;
