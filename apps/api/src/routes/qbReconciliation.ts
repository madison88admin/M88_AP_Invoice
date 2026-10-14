import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import * as controller from '../controllers/quickBooksReconciliation';

const router: Router = Router();
router.use(authenticate);
const accounting = authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN);
router.get('/', accounting, controller.list);
router.post('/', accounting, controller.create);
router.post('/import', accounting, controller.importRows);
router.patch('/:id/resolve', accounting, controller.resolve);
export default router;
