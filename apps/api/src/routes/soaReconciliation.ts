import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import {
  getSOAReconciliationQueue,
  getSOAReconciliationStatistics,
  markAsReviewed,
  getVendorsWithPendingSOA,
  recordSOASubmission,
} from '../services/soaReconciliationService';

const router = Router() as Router;

router.use(authenticate);

// Get SOA reconciliation queue for a specific month
router.get('/queue', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const items = await getSOAReconciliationQueue(year, month);
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

// Get SOA reconciliation statistics
router.get('/statistics', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const stats = await getSOAReconciliationStatistics(year, month);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// Mark a reconciliation item as reviewed
router.post('/:invoiceId/review', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res, next) => {
  try {
    const result = await markAsReviewed(req.params.invoiceId, (req as any).user.id, req.body.notes);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// Get vendors with pending SOA submissions
router.get('/pending-vendors', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const vendors = await getVendorsWithPendingSOA(year, month);
    res.json({ success: true, data: vendors });
  } catch (error) {
    next(error);
  }
});

// Record SOA submission from vendor
router.post('/vendors/:vendorId/submit', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res, next) => {
  try {
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const result = await recordSOASubmission(req.params.vendorId, year, month, req.body.fileUrl || '', (req as any).user.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

export default router;
