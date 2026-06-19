import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest, authorize } from '../middleware/auth';
import * as invoiceController from '../controllers/invoices';
import * as uploadController from '../controllers/upload';
import * as validationController from '../controllers/validation';
import * as approvalController from '../controllers/approval';
import * as postingController from '../controllers/posting';
import upload from '../middleware/upload';
import { UserRole } from '@ap-invoice/shared';
import { validateInvoiceWithData } from '../services/validationService';

const router = Router() as Router;

const devBypassAdmin = (req: any, res: any, next: any) => {
  if (process.env.NODE_ENV === 'development') return next();
  return authorize(UserRole.IT_ADMIN)(req, res, next);
};

/**
 * POST /api/invoices/mock-validate
 * Run all 17 validation rules on a posted invoice payload — no DB required.
 * Accepts a full or partial invoice object in the request body.
 * Uses a built-in realistic sample if body is empty.
 */
router.post('/mock-validate', devBypassAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const SAMPLE_INVOICE = {
      id: 'mock-001',
      invoice_number: 'INV-2026-001',
      invoice_date: new Date('2026-06-01'),
      due_date: new Date('2026-07-01'),
      invoice_received_date: new Date('2026-06-03'),
      total_amount: 23.75,
      currency: 'USD',
      payment_terms: 'NET30',
      incoterm: 'FOB',
      is_handwritten: false,
      is_urgent: false,
      priority_flag: false,
      invoice_type: 'COMMERCIAL',
      mpo_number: 'MPO015713',
      vendor: {
        id: 'vendor-001',
        name: 'Combine Products International Limited',
        swift_code: 'HSBCHKHHXXX',
        account_number: '123456789',
      },
      signatures: [
        { signatory_name: 'Computer-generated, no signature required', signatory_role: 'COORDINATOR', signed_at: new Date() },
      ],
      ocr_raw_data: {
        bank_info: {
          swift_code: 'HSBCHKHHXXX',
          account_number: '123456789',
        },
      },
    };

    const invoiceData = Object.keys(req.body).length > 0
      ? { ...SAMPLE_INVOICE, ...req.body }
      : SAMPLE_INVOICE;

    const result = await validateInvoiceWithData(invoiceData);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

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
