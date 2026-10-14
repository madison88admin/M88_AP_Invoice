import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as approvalController from '../controllers/approval';

const router: Router = Router();

router.use(authenticate);

router.get('/pending', approvalController.getPendingApprovalsController);
router.post('/batch-approve', approvalController.batchApproveController);

export default router;
