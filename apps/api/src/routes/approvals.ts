import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as approvalController from '../controllers/approval';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.get('/pending', approvalController.getPendingApprovalsController);
router.post('/batch-approve', approvalController.batchApproveController);

export default router;
