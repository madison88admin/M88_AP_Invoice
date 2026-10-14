import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { getAuditLogs } from '../services/auditLogService';
import { AppError } from '../middleware/errorHandler';
import { isDbEnabled } from '../config/database';

const router = Router() as Router;

router.use(authenticate);

/**
 * GET /api/audit-logs
 * Query params: invoiceId, action, performedBy, startDate, endDate, limit, offset
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isDbEnabled()) return res.json({ logs: [], total: 0 });
    const { invoiceId, action, performedBy, startDate, endDate, limit, offset } = req.query;

    if (String(action || '').toUpperCase() === 'INVOICE_DELETED' && (req as any).user?.role !== UserRole.SUPERADMIN) {
      throw new AppError('Only SUPERADMIN users may view invoice deletion audit logs', 403);
    }

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
