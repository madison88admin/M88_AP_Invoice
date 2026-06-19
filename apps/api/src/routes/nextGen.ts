import express, { Router } from 'express';
import { nextGenService } from '../services/nextGenService';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';

const router: Router = express.Router();

// Skip auth in development for easy Postman testing
const devBypass = (req: any, res: any, next: any) => {
  if (process.env.NODE_ENV === 'development') return next();
  return authenticate(req, res, next);
};

router.use(devBypass);

/**
 * GET /api/nextgen/po/:poNumber
 * Fetch full PO data (header + lines) from NextGen by PO number
 */
router.get('/po/:poNumber', async (req, res) => {
  try {
    const { poNumber } = req.params;
    const poData = await nextGenService.getFullPO(poNumber);
    if (!poData) {
      return res.status(404).json({ error: 'PO not found in NextGen' });
    }
    res.json(poData);
  } catch (error) {
    console.error('Error fetching PO from NextGen:', error);
    res.status(500).json({ error: 'Failed to fetch PO from NextGen' });
  }
});

/**
 * GET /api/nextgen/po/:poId/lines
 * Fetch PO line items from NextGen by PO numeric ID
 */
router.get('/po/:poId/lines', async (req, res) => {
  try {
    const { poId } = req.params;
    const lines = await nextGenService.fetchPOLines(poId);
    res.json({ po_id: poId, line_count: lines.length, lines });
  } catch (error) {
    console.error('Error fetching PO lines from NextGen:', error);
    res.status(500).json({ error: 'Failed to fetch PO lines from NextGen' });
  }
});

/**
 * GET /api/nextgen/mpo/:mpoNumber
 * Fetch PO data from NextGen by MPO number
 */
router.get('/mpo/:mpoNumber', async (req, res) => {
  try {
    const { mpoNumber } = req.params;
    const hint: { vendor_name?: string; amount?: number } = {};
    if (req.query.vendor_name) hint.vendor_name = String(req.query.vendor_name);
    if (req.query.amount) hint.amount = Number(req.query.amount);
    const poData = await nextGenService.fetchPOByMPO(mpoNumber, Object.keys(hint).length ? hint : undefined);
    if (!poData) {
      return res.status(404).json({ error: 'PO not found in NextGen' });
    }
    res.json(poData);
  } catch (error) {
    console.error('Error fetching PO by MPO from NextGen:', error);
    res.status(500).json({ error: 'Failed to fetch PO by MPO from NextGen' });
  }
});

/**
 * POST /api/nextgen/compare
 * Compare invoice data against NextGen PO data
 */
router.post('/compare', async (req, res) => {
  try {
    const invoiceData = req.body;
    const result = await nextGenService.compareInvoiceWithPO(invoiceData);
    res.json(result);
  } catch (error) {
    console.error('Error comparing invoice with NextGen PO:', error);
    res.status(500).json({ error: 'Failed to compare invoice with NextGen PO' });
  }
});

/**
 * GET /api/nextgen/search
 * Search for POs by vendor and date range
 */
router.get('/search', async (req, res) => {
  try {
    const { vendorName, startDate, endDate } = req.query;
    const poData = await nextGenService.searchPOs(
      vendorName as string,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    res.json(poData);
  } catch (error) {
    console.error('Error searching POs in NextGen:', error);
    res.status(500).json({ error: 'Failed to search POs in NextGen' });
  }
});

/**
 * GET /api/nextgen/pos
 * List recent POs (for discovery/testing)
 */
router.get('/pos', async (req, res) => {
  try {
    const { limit } = req.query;
    const poData = await nextGenService.listPOs(limit ? parseInt(limit as string) : 20);
    res.json(poData);
  } catch (error) {
    console.error('Error listing POs from NextGen:', error);
    res.status(500).json({ error: 'Failed to list POs from NextGen' });
  }
});

/**
 * GET /api/nextgen/status
 * Check if NextGen API is configured and session cookie is obtainable
 */
// Skip role-check in development
const devBypassAdmin = (req: any, res: any, next: any) => {
  if (process.env.NODE_ENV === 'development') return next();
  return authorize(UserRole.ADMIN, UserRole.IT_ADMIN, UserRole.ACCOUNTING_SUPERVISOR)(req, res, next);
};

router.get('/status', devBypassAdmin, async (req, res) => {
  try {
    const isConfigured = nextGenService.isConfigured();

    // If configured, try a connection to verify connectivity
    let connectionCheck: { success: boolean; message: string } = { success: false, message: 'Not configured' };
    if (isConfigured) {
      try {
        await nextGenService.fetchPOByNumber('__connectivity_test__');
        // Even if PO not found (null), the login + HTTP call succeeded
        connectionCheck = { success: true, message: 'Session cookie obtained, NextGen reachable' };
      } catch (error) {
        connectionCheck = {
          success: false,
          message: `Connection failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        };
      }
    }

    res.json({
      configured: isConfigured,
      base_url: isConfigured ? 'https://nextgen.madison88.com' : null,
      auth: 'Cookie-based session (username/password)',
      connection: connectionCheck,
      read_only: true,
    });
  } catch (error) {
    console.error('Error checking NextGen status:', error);
    res.status(500).json({ error: 'Failed to check NextGen status' });
  }
});

/**
 * GET /api/nextgen/test/:poNumber
 * Live test — fetch a real PO to verify the full pipeline (login → NextGen → response mapping)
 */
router.get('/test/:poNumber', devBypassAdmin, async (req, res) => {
  try {
    const { poNumber } = req.params;
    const startTime = Date.now();
    const poData = await nextGenService.fetchPOByNumber(poNumber);
    const elapsed = Date.now() - startTime;

    res.json({
      success: !!poData,
      elapsed_ms: elapsed,
      data: poData,
      message: poData
        ? `PO ${poNumber} fetched successfully in ${elapsed}ms`
        : `PO ${poNumber} not found (NextGen returned empty or error)`,
    });
  } catch (error) {
    console.error('NextGen test fetch error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
});

/**
 * DEBUG: Raw MPO EntityBrowserList response
 */
router.get('/debug/mpo-list', devBypassAdmin, async (req, res) => {
  try {
    console.log('Attempting to fetch MPO list...');
    const result = await nextGenService.debugGetMPOList();
    console.log('MPO list result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error fetching MPO list:', error);
    res.status(500).json({ error: 'Failed to fetch MPO list', details: error instanceof Error ? error.message : 'unknown error' });
  }
});

/**
 * DEBUG: Raw MPO totals
 */
router.post('/debug/mpo-totals', devBypassAdmin, async (req, res) => {
  try {
    const { order_id } = req.body;
    const result = await nextGenService.debugGetMPOTotals(order_id);
    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to fetch MPO totals', detail: msg });
  }
});

/**
 * DEBUG: Raw MPO lines
 */
router.post('/debug/mpo-lines', devBypassAdmin, async (req, res) => {
  try {
    const { order_id } = req.body;
    const result = await nextGenService.debugGetMPOLines(order_id);
    res.json(result);
  } catch (error) {
    console.error('Error fetching MPO lines:', error);
    res.status(500).json({ error: 'Failed to fetch MPO lines' });
  }
});

/**
 * DEBUG: Raw MPO Grid Read
 */
router.post('/debug/mpo-grid', devBypassAdmin, async (req, res) => {
  try {
    const { mpo_number } = req.body;
    const result = await (nextGenService as any).post('/MaterialPurchaseOrder/MPOGridRead', {
      page: 1,
      pageSize: 10,
      sort: [{ field: 'KeyDate', dir: 'desc' }],
      group: [],
      filter: { logic: 'and', filters: [{ field: 'Name', operator: 'eq', value: mpo_number }] },
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching MPO grid:', error);
    res.status(500).json({ error: 'Failed to fetch MPO grid' });
  }
});

/**
 * DEBUG: MPO detail by OrderId — comprehensive probe for vendor reference fields
 */
router.get('/debug/mpo-detail/:orderId', devBypassAdmin, async (req, res) => {
  const { orderId } = req.params;
  const id = Number(orderId);
  const results: Record<string, any> = {};

  const getEndpoints = [
    `/MaterialPurchaseOrder/GetById?id=${id}`,
    `/MaterialPurchaseOrder/GetEntity?id=${id}`,
    `/MaterialPurchaseOrder/GetEditorValues?id=${id}`,
    `/MaterialPurchaseOrder/GetFormValues?id=${id}`,
    `/MaterialPurchaseOrder/FormPage?orderId=${id}`,
  ];
  for (const path of getEndpoints) {
    try {
      results[`GET ${path}`] = await (nextGenService as any).get(path);
    } catch (e) {
      results[`GET ${path}`] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const postJsonCandidates: [string, any][] = [
    ['/MaterialPurchaseOrder/FormHeaderRead', { OrderId: id }],
    ['/MaterialPurchaseOrder/GetFormData', { orderId: id }],
    ['/MaterialPurchaseOrder/HeaderGridRead', { OrderId: id }],
    ['/MaterialPurchaseOrder/GetById', { id }],
    ['/MaterialPurchaseOrder/GetEntity', { id }],
  ];
  for (const [path, body] of postJsonCandidates) {
    try {
      results[`POST ${path}`] = await (nextGenService as any).post(path, body);
    } catch (e) {
      results[`POST ${path}`] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const postFormCandidates: [string, Record<string, string>][] = [
    ['/MaterialPurchaseOrder/FormPage', { orderId: String(id) }],
    ['/MaterialPurchaseOrder/FormHeaderRead', { OrderId: String(id), sort: '', page: '1', pageSize: '1', group: '', filter: '' }],
    ['/MaterialPurchaseOrder/GetEditorValues', { id: String(id) }],
  ];
  for (const [path, fields] of postFormCandidates) {
    try {
      const body = new URLSearchParams(fields);
      results[`FORM ${path}`] = await (nextGenService as any).postForm(path, body);
    } catch (e) {
      results[`FORM ${path}`] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  res.json(results);
});

export default router;
