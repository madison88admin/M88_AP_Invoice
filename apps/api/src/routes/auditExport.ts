import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { getAuditLogs } from '../services/auditLogService';
import { logger } from '../utils/logger';

const router = Router() as Router;

router.use(authenticate);

/**
 * GET /api/audit-logs/export
 * Export audit logs as CSV for compliance/finance audit purposes.
 * Query params: invoiceId, action, performedBy, startDate, endDate, limit, offset
 */
router.get('/export', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { invoiceId, action, performedBy, startDate, endDate } = req.query;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10000;

    const result = await getAuditLogs({
      invoiceId: invoiceId as string | undefined,
      action: action as string | undefined,
      performedBy: performedBy as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      limit,
      offset: 0,
    });

    const logs = result.logs || result;

    const csvHeaders = [
      'Audit Log ID',
      'Invoice ID',
      'Action',
      'Performed By',
      'Note',
      'Timestamp',
    ];

    const escapeCsv = (val: any) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = (Array.isArray(logs) ? logs : []).map((log: any) => [
      escapeCsv(log.id),
      escapeCsv(log.invoice_id),
      escapeCsv(log.action),
      escapeCsv(log.performed_by),
      escapeCsv(log.note),
      escapeCsv(log.created_at ? new Date(log.created_at).toISOString() : ''),
    ].join(','));

    const csv = [csvHeaders.join(','), ...csvRows].join('\n');

    const filename = `audit-log-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('Audit log export error:', error);
    next(error);
  }
});

export default router;
