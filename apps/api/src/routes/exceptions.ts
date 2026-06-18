import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as exceptionController from '../controllers/exception';
import { UserRole } from '@ap-invoice/shared';

const router: Router = Router();

router.use(authenticate);

router.get('/pending', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), exceptionController.getPendingExceptionsController);
router.get('/invoice/:invoiceId', exceptionController.getExceptionsByInvoiceController);
router.post('/:exceptionId/resolve', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), exceptionController.resolveExceptionController);
router.post('/:exceptionId/waive', authorize(UserRole.IT_ADMIN), exceptionController.waiveExceptionController);
router.post('/invoice/:invoiceId/auto-resolve', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), exceptionController.autoResolveExceptionsController);

export default router;
