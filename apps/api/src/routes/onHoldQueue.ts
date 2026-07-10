import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole, InvoiceStatus, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const router: Router = Router();

router.use(authenticate);

/**
 * GET /api/on-hold-queue
 * Dedicated queue view for Accounting Supervisor — shows all ON_HOLD and EXCEPTION_FLAGGED invoices
 * with hold duration, reason, and amount.
 */
router.get('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res) => {
  try {
    const statusFilter = (req.query.status as string) || 'ALL';
    const vendorFilter = req.query.vendorId as string | undefined;

    const statuses: string[] = [];
    if (statusFilter === 'ALL' || statusFilter === 'ON_HOLD') {
      statuses.push(InvoiceStatus.ON_HOLD);
    }
    if (statusFilter === 'ALL' || statusFilter === 'EXCEPTION_FLAGGED') {
      statuses.push(InvoiceStatus.EXCEPTION_FLAGGED);
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: statuses as any[] },
        ...(vendorFilter && { vendor_id: vendorFilter }),
      },
      include: {
        vendor: true,
        exceptions: {
          where: { status: 'PENDING' as any },
          orderBy: { created_at: 'desc' },
        },
        stage_timestamps: {
          where: { exited_at: null },
          orderBy: { entered_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    const now = new Date();
    const queueItems = invoices.map((inv) => {
      const currentStage = inv.stage_timestamps[0];
      const holdDurationHours = currentStage
        ? Math.round(calcWorkingHoursElapsed(new Date(currentStage.entered_at), now) * 10) / 10
        : 0;

      const holdReasons = inv.exceptions.map((e) => ({
        reason: e.reason,
        detail: e.detail,
        created_at: e.created_at,
      }));

      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        vendor_name: inv.vendor?.name || 'Unknown',
        vendor_id: inv.vendor_id,
        amount: Number(inv.total_amount),
        currency: inv.currency,
        status: inv.status,
        hold_duration_hours: holdDurationHours,
        hold_reasons: holdReasons,
        invoice_date: inv.invoice_date,
        invoice_received_date: inv.invoice_received_date,
        is_urgent: inv.is_urgent,
        priority_pay_date: inv.priority_pay_date,
      };
    });

    const summary = {
      total: queueItems.length,
      on_hold: queueItems.filter((q) => q.status === InvoiceStatus.ON_HOLD).length,
      exception_flagged: queueItems.filter((q) => q.status === InvoiceStatus.EXCEPTION_FLAGGED).length,
      urgent: queueItems.filter((q) => q.is_urgent).length,
      total_amount: queueItems.reduce((sum, q) => sum + q.amount, 0),
      avg_hold_hours: queueItems.length > 0
        ? Math.round((queueItems.reduce((sum, q) => sum + q.hold_duration_hours, 0) / queueItems.length) * 10) / 10
        : 0,
      oldest_hold_hours: queueItems.length > 0
        ? Math.max(...queueItems.map((q) => q.hold_duration_hours))
        : 0,
    };

    res.json({ items: queueItems, summary });
  } catch (error) {
    logger.error('On-hold queue error:', error);
    res.status(500).json({ error: 'Failed to fetch on-hold queue' });
  }
});

/**
 * GET /api/on-hold-queue/stats
 * Quick stats for dashboard widget
 */
router.get('/stats', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req, res) => {
  try {
    const [onHoldCount, exceptionCount, onHoldAmount, exceptionAmount] = await Promise.all([
      prisma.invoice.count({ where: { status: InvoiceStatus.ON_HOLD as any } }),
      prisma.invoice.count({ where: { status: InvoiceStatus.EXCEPTION_FLAGGED as any } }),
      prisma.invoice.aggregate({
        where: { status: InvoiceStatus.ON_HOLD as any },
        _sum: { total_amount: true },
      }),
      prisma.invoice.aggregate({
        where: { status: InvoiceStatus.EXCEPTION_FLAGGED as any },
        _sum: { total_amount: true },
      }),
    ]);

    res.json({
      on_hold: onHoldCount,
      exception_flagged: exceptionCount,
      on_hold_amount: Number(onHoldAmount._sum.total_amount || 0),
      exception_amount: Number(exceptionAmount._sum.total_amount || 0),
      total: onHoldCount + exceptionCount,
    });
  } catch (error) {
    logger.error('On-hold stats error:', error);
    res.status(500).json({ error: 'Failed to fetch on-hold stats' });
  }
});

export default router;
