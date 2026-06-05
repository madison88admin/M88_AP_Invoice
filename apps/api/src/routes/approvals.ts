import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as approvalController from '../controllers/approval';
import { UserRole } from '@ap-invoice/shared';

const router = Router();

router.use(authenticate);

router.get('/pending', approvalController.getPendingApprovalsController);

export default router;
