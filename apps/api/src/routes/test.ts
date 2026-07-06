import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { validateInvoiceWithData } from '../services/validationService';
import { poAuditService } from '../services/poAuditService';
import { geminiOCRService } from '../services/geminiOCRService';
import { consensusExtractor } from '../services/consensusExtractor';
import { extractMadisonInvoiceFields } from '../services/madisonInvoiceExtractor';
import { NextGenService } from '../services/nextGenService';
import { AppError } from '../middleware/errorHandler';

const router = Router() as Router;

const devBypassAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'development') return next();
  return authorize(UserRole.IT_ADMIN)(req, res, next);
};

const testRoutesEnabled = () => {
  return process.env.NODE_ENV === 'development' || process.env.ENABLE_TEST_ROUTES === 'true';
};

const guardTestRoutes = (req: Request, res: Response, next: NextFunction) => {
  if (!testRoutesEnabled()) {
    return next(new AppError('Test routes are disabled', 404));
  }
  next();
};

router.use(guardTestRoutes);
router.use(authenticate);

/**
 * POST /api/test/mock-validate
 * Run all 17 validation rules on a posted invoice payload — no DB required.
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

/**
 * POST /api/test/gemini-ocr
 * Test Gemini extraction without full upload.
 */
router.post('/gemini-ocr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text required' });
    }

    if (!geminiOCRService.isAvailable()) {
      return res.json({ available: false, message: 'GEMINI_API_KEY not configured' });
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

/**
 * POST /api/test/consensus
 * Test dual-engine consensus extraction without full upload.
 */
router.post('/consensus', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text required' });
    }

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

    const engine2 = async (t: string) => {
      if (!geminiOCRService.isAvailable()) return null;
      return geminiOCRService.extractFromText(t);
    };

    const consensus = await consensusExtractor.extract(text, Buffer.from(''), engine1, engine2);

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
      },
    });
  } catch (error: any) {
    console.error('[test-consensus] Error:', error);
    res.status(500).json({
      error: error?.message || 'Consensus test failed',
      stack: error?.stack,
    });
  }
});

/**
 * POST /api/test/madison-extract
 * Test Madison invoice field extraction from raw text.
 */
router.post('/madison-extract', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text required' });
    }

    const result = await extractMadisonInvoiceFields(text);
    res.json(result);
  } catch (error: any) {
    console.error('[test-madison-extract] Error:', error);
    res.status(500).json({
      error: error?.message || 'Madison extraction test failed',
      stack: error?.stack,
    });
  }
});

/**
 * GET /api/test/po-audit/all
 * View all async PO audit results.
 */
router.get('/po-audit/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = poAuditService.getAllResults();
    res.json(results);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/test/nextgen-mpo
 * Live cross-check of an MPO against NextGen. Returns raw PO data and comparison.
 */
router.post('/nextgen-mpo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mpo_number, amount, vendor_name } = req.body;
    if (!mpo_number) {
      return res.status(400).json({ error: 'mpo_number is required' });
    }

    const nextGenService = NextGenService.getInstance();
    const poData = await nextGenService.fetchPOByMPO(mpo_number, {
      vendor_name,
      amount: amount ? Number(amount) : undefined,
    });

    const comparison = await nextGenService.compareInvoiceWithPO({
      mpo_number,
      amount: amount ? Number(amount) : 0,
      vendor_name: vendor_name || '',
    });

    res.json({
      mpo_number,
      credentials_configured: !(nextGenService as any).useMock,
      po_data: poData,
      comparison,
      note: poData
        ? 'MPO found in NextGen'
        : 'MPO not found in NextGen (credentials missing, PO does not exist, or NextGen lookup failed)',
    });
  } catch (error: any) {
    console.error('[test-nextgen-mpo] Error:', error);
    res.status(500).json({
      error: error?.message || 'NextGen MPO lookup failed',
      stack: error?.stack,
    });
  }
});

export default router;
