import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import * as citibusinessController from '../controllers/citibusinessExport';

const router: Router = Router();

router.use(authenticate);

// Export a single batch to CitiBusiness CSV
router.get('/batch/:batchId', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), citibusinessController.exportBatchCitiBusiness);

// Export all approved/processed batches to CitiBusiness CSV
router.get('/export-all', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), citibusinessController.exportAllCitiBusiness);

export default router;
