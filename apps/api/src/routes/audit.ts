import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { getAuditLogs } from '../services/auditLogService';

const router = Router() as Router;

router.use(authenticate);

/**
 * GET /api/audit-logs
 * Query params: invoiceId, action, performedBy, startDate, endDate, limit, offset
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { invoiceId, action, performedBy, startDate, endDate, limit, offset } = req.query;

    const result = await getAuditLogs({
      invoiceId: invoiceId as string | undefined,
      action: action as string | undefined,
      performedBy: performedBy as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
