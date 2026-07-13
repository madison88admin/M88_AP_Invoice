import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as paymentBatchController from '../controllers/paymentBatch';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.get('/scheduled-payments', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getScheduledPaymentsForBatchController);
router.get('/', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getPaymentBatchesController);
router.get('/:batchId', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN), paymentBatchController.getPaymentBatchByIdController);
router.post('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.createPaymentBatchController);
router.post('/select', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.selectPaymentsForBatchController);
router.post('/deselect', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.deselectPaymentsForBatchController);
router.post('/:batchId/process', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.processPaymentBatchController);
router.post('/:batchId/approve', authorize(UserRole.CFO), paymentBatchController.approvePaymentBatchByCFOController);
router.post('/:batchId/cancel', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), paymentBatchController.cancelPaymentBatchController);

export default router;
