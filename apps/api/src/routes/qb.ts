import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as qbController from '../controllers/qb';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.get(
  '/export',
  authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN),
  qbController.exportQBBillsController
);

export default router;
