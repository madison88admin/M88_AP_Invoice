import { Router } from 'express';
import path from 'path';
import { authenticate, authorize } from '../middleware/auth';
import * as paymentBatchController from '../controllers/paymentBatch';
import upload from '../middleware/upload';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.get('/scheduled-payments', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.getScheduledPaymentsForBatchController);
router.get('/', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.getPaymentBatchesController);
router.get('/proofs/:fileName', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), (req, res) => {
  const uploadRoot = process.env.PAYMENT_PROOF_DIR || path.join(process.cwd(), 'data', 'payment-proofs');
  res.sendFile(path.join(uploadRoot, path.basename(req.params.fileName)));
});
router.get('/:batchId', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.getPaymentBatchByIdController);
router.post('/', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), paymentBatchController.createPaymentBatchController);
router.post('/select', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), paymentBatchController.selectPaymentsForBatchController);
router.post('/deselect', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), paymentBatchController.deselectPaymentsForBatchController);
router.post('/:batchId/submit', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.submitPaymentBatchController);
router.post('/:batchId/review', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.reviewPaymentBatchController);
router.post('/:batchId/return', authorize(UserRole.ACCOUNTING_SUPERVISOR), paymentBatchController.returnPaymentBatchController);
router.post('/:batchId/export', authorize(UserRole.ACCOUNTING_ASSOCIATE), paymentBatchController.exportPaymentBatchController);
router.post('/:batchId/process', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), upload.single('proof'), paymentBatchController.processPaymentBatchController);
router.post('/:batchId/cancel', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), paymentBatchController.cancelPaymentBatchController);

export default router;
