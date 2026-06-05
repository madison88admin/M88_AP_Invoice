import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as postingController from '../controllers/posting';
import { UserRole } from '@ap-invoice/shared';

const router = Router();

router.use(authenticate);

router.get('/scheduled', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.getScheduledPaymentsController);
router.post('/:paymentId/process', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.processPaymentController);

export default router;
