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
import { poAuditService } from '../services/poAuditService';
import { geminiOCRService } from '../services/geminiOCRService';
import { consensusExtractor } from '../services/consensusExtractor';
import { extractMadisonInvoiceFields } from '../services/madisonInvoiceExtractor';

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

// Temporarily bypass auth for upload endpoint (move before authenticate)
router.post('/upload', upload.single('file'), uploadController.uploadInvoice);
router.post('/upload-madison', upload.single('file'), uploadController.uploadMadisonInvoice);

// DSRS v7.3 async PO audit polling endpoints — informational only, non-blocking
router.get('/:id/po-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = poAuditService.getAuditResult(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/po-audit/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = poAuditService.getAllResults();
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Test Gemini extraction without full upload
router.post('/test-gemini-ocr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text required' });
    }

    if (!geminiOCRService.isAvailable()) {
      return res.json({
        available: false,
        message: 'GEMINI_API_KEY not configured',
      });
    }

    const result = await geminiOCRService.extractFromText(text);
    res.json({ available: true, result });
  } catch (error: any) {
    console.error('[test-gemini-ocr] Error:', error);
    res.status(500).json({
      available: true,
      result: null,
      error: error?.message || 'Gemini test failed',
      stack: error?.stack,
    });
  }
});

// Test dual-engine consensus extraction without full upload
router.post('/test-consensus', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text required' });
    }

    // Engine 1: simple regex parser from text (test harness)
    const engine1 = async (t: string) => {
      const invMatch = t.match(/INVOICE\s*NO[:\s]+(\S+)/i);
      const dateMatch = t.match(/INVOICE\s*DATE[:\s]+(\S+)/i);
      const totalMatch = t.match(/TOTAL\s*\(USD\)[:\s]+([\d,.]+)/i);
      const vendorMatch = t.match(/^(Avery Dennison[^\n]+)/im);
      const customerPOMatch = t.match(/CUSTOMER\s*PO[:\s]+([^\n]+)/i);
      const mpoMatch = customerPOMatch?.[1]?.match(/MPO(\d+)/i);
      const brandMatch = customerPOMatch?.[1]?.match(/\b(TNF|UA|VNS|CSC|HH|BUR)\b/i);
      const seasonMatch = customerPOMatch?.[1]?.match(/\b(F\d{2}|S\d{2})\b/i);

      return {
        vendor_name: vendorMatch?.[1]?.trim(),
        invoice_number: invMatch?.[1],
        invoice_date: dateMatch?.[1],
        total_amount: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : undefined,
        currency: 'USD',
        po_number: undefined,
        mpo_number: mpoMatch ? `MPO${mpoMatch[1]}` : undefined,
        brand: brandMatch ? undefined : undefined,
        brand_code: brandMatch?.[1],
        season: seasonMatch?.[1],
        line_items: undefined,
      };
    };

    // Engine 2: Gemini
    const engine2 = async (t: string) => {
      if (!geminiOCRService.isAvailable()) return null;
      return geminiOCRService.extractFromText(t);
    };

    const consensus = await consensusExtractor.extract(
      text,
      Buffer.from(''),
      engine1,
      engine2
    );

    res.json({
      final: consensus.final,
      overall_confidence: consensus.overall_confidence,
      overall_status: consensus.overall_status,
      requires_review: consensus.requires_review,
      conflicts: consensus.conflicts,
      engines_used: consensus.engines_used,
      field_details: {
        vendor_name: consensus.vendor_name,
        total_amount: consensus.total_amount,
        mpo_number: consensus.mpo_number,
        invoice_number: consensus.invoice_number,
      }
    });
  } catch (error: any) {
    console.error('[test-consensus] Error:', error);
    res.status(500).json({
      error: error?.message || 'Consensus test failed',
      stack: error?.stack,
    });
  }
});

router.use(authenticate);
router.post('/:id/confirm-ocr', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), uploadController.confirmOCR);
router.post('/:id/validate', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), validationController.validateInvoiceController);
router.post('/:id/request-approval', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), approvalController.requestApproval);
router.post('/:id/approve', authorize(UserRole.PURCHASING_MANAGER, UserRole.MLO_ACCOUNT_HOLDER, UserRole.PLANNING_MANAGER, UserRole.PRESIDENT, UserRole.CFO, UserRole.ACCOUNTING_SUPERVISOR), approvalController.approveInvoiceController);
router.post('/:id/reject', authorize(UserRole.PURCHASING_MANAGER, UserRole.MLO_ACCOUNT_HOLDER, UserRole.PLANNING_MANAGER, UserRole.PRESIDENT, UserRole.CFO, UserRole.ACCOUNTING_SUPERVISOR), approvalController.rejectInvoiceController);
router.post('/:id/post', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.postInvoiceController);
router.post('/:id/schedule-payment', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), postingController.schedulePaymentController);
router.post('/', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.IT_ADMIN), invoiceController.createInvoice);
router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.patch('/:id/status', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), invoiceController.updateInvoiceStatus);

export default router;
