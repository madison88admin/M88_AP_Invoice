import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as aliasController from '../controllers/alias';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

// Any authenticated user can view aliases (they drive NextGen comparison output)
router.get('/', aliasController.listAliasesController);

// Coordinators and above manage the alias table
router.post(
  '/',
  authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN),
  aliasController.createAliasController
);
router.delete(
  '/:id',
  authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN),
  aliasController.deleteAliasController
);

export default router;
