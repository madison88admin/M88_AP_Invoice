import { Router } from 'express';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import * as invoiceController from '../controllers/invoices';
import * as uploadController from '../controllers/upload';
import * as validationController from '../controllers/validation';
import * as approvalController from '../controllers/approval';
import * as postingController from '../controllers/posting';
import upload from '../middleware/upload';
import { UserRole } from '@ap-invoice/shared';

const router = Router();

router.use(authenticate);

router.post('/upload', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), upload.single('file'), uploadController.uploadInvoice);
router.post('/:id/confirm-ocr', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), uploadController.confirmOCR);
router.post('/:id/validate', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), validationController.validateInvoiceController);
router.post('/:id/request-approval', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), approvalController.requestApproval);
router.post('/:id/approve', authorize(UserRole.PURCHASING_MANAGER, UserRole.PLANNING_MANAGER, UserRole.PRESIDENT, UserRole.CFO, UserRole.ACCOUNTING_SUPERVISOR), approvalController.approveInvoiceController);
router.post('/:id/reject', authorize(UserRole.PURCHASING_MANAGER, UserRole.PLANNING_MANAGER, UserRole.PRESIDENT, UserRole.CFO, UserRole.ACCOUNTING_SUPERVISOR), approvalController.rejectInvoiceController);
router.post('/:id/post', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.postInvoiceController);
router.post('/:id/schedule-payment', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.schedulePaymentController);
router.post('/', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), invoiceController.createInvoice);
router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.patch('/:id/status', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), invoiceController.updateInvoiceStatus);

export default router;
