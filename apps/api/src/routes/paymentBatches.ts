import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as paymentBatchController from '../controllers/paymentBatch';
import { UserRole } from '@ap-invoice/shared';

const router = Router();

router.use(authenticate);

router.get('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.getPaymentBatchesController);
router.get('/:batchId', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.getPaymentBatchByIdController);
router.post('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.createPaymentBatchController);
router.post('/:batchId/process', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.processPaymentBatchController);
router.post('/:batchId/cancel', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.cancelPaymentBatchController);

export default router;
