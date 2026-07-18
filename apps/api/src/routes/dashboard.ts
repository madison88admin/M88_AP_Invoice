import express, { Router } from 'express';
import prisma from '../config/database';
import { InvoiceStatus, InvoiceType, UserRole, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { authenticate } from '../middleware/auth';
import { getPaidPIMissingCI } from '../services/piFollowUpService';
import { getSLACountdown } from '../services/slaReminderService';

const router: Router = express.Router();

router.use(authenticate);

router.get('/role', async (req: any, res) => {
  try {
    const userRole = req.user?.role as UserRole | undefined;
    const now = new Date();
    const dueSoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const roleConfig: Record<string, { title: string; primaryHref: string; statuses: InvoiceStatus[]; paymentStatuses?: string[]; batchStatuses?: string[] }> = {
      [UserRole.ACCOUNTING_ASSOCIATE]: {
        title: 'Accounting work queue',
        primaryHref: '/payment-batches',
        statuses: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED],
        paymentStatuses: ['SCHEDULED'],
        batchStatuses: ['DRAFT', 'RETURNED_FOR_CORRECTION', 'REVIEWED', 'EXPORTED_TO_BANK'],
      },
      [UserRole.ACCOUNTING_SUPERVISOR]: {
        title: 'Supervisor review queue',
        primaryHref: '/payment-batches',
        statuses: [InvoiceStatus.PENDING_ACCOUNTING, InvoiceStatus.APPROVED, InvoiceStatus.PAYMENT_SCHEDULED],
        batchStatuses: ['PENDING_SUPERVISOR_REVIEW'],
      },
      [UserRole.PURCHASING_COORDINATOR]: {
        title: 'Purchasing validation queue',
        primaryHref: '/purchasing-workbench',
        statuses: [InvoiceStatus.RECEIVED, InvoiceStatus.VALIDATION_PENDING, InvoiceStatus.EXCEPTION_FLAGGED, InvoiceStatus.REJECTED, InvoiceStatus.ON_HOLD],
      },
      [UserRole.PURCHASING_MANAGER]: {
        title: 'Purchasing manager queue',
        primaryHref: '/approvals',
        statuses: [InvoiceStatus.PENDING_MANAGER, InvoiceStatus.EXCEPTION_FLAGGED, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID],
      },
      [UserRole.MLO_ACCOUNT_HOLDER]: {
        title: 'Approvals waiting on you',
        primaryHref: '/approvals',
        statuses: [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER],
      },
      [UserRole.PLANNING_MANAGER]: {
        title: 'Planning manager queue',
        primaryHref: '/approvals',
        statuses: [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER],
      },
      [UserRole.SR_MANAGER_GLOBAL_PRODUCTION]: {
        title: 'Senior manager queue',
        primaryHref: '/approvals',
        statuses: [InvoiceStatus.PENDING_SR_MANAGER],
      },
      [UserRole.MS_POLLY]: {
        title: 'Executive approval queue',
        primaryHref: '/approvals',
        statuses: [InvoiceStatus.PENDING_POLLY],
      },
    };

    const config = roleConfig[userRole || ''] || {
      title: 'Invoice operations queue',
      primaryHref: '/repository',
      statuses: [
        InvoiceStatus.RECEIVED,
        InvoiceStatus.VALIDATION_PENDING,
        InvoiceStatus.EXCEPTION_FLAGGED,
        InvoiceStatus.PENDING_COORDINATOR,
        InvoiceStatus.PENDING_MANAGER,
        InvoiceStatus.PENDING_ACCOUNTING,
        InvoiceStatus.APPROVED,
        InvoiceStatus.POSTED_TO_QB,
        InvoiceStatus.PAYMENT_SCHEDULED,
      ],
    };

    const [workItems, scheduledPayments, reviewBatches, rejected, dueSoonInvoices, unreadNotifications] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { in: config.statuses as any[] } },
        include: { vendor: true, payments: true, exceptions: { where: { status: 'PENDING' as any } } },
        orderBy: [{ priority_flag: 'desc' }, { updated_at: 'desc' }],
        take: 12,
      }),
      config.paymentStatuses?.length
        ? prisma.payment.findMany({
            where: { status: { in: config.paymentStatuses }, batch_id: null },
            include: { invoice: { include: { vendor: true } } },
            orderBy: { payment_date: 'asc' },
            take: 12,
          })
        : Promise.resolve([]),
      config.batchStatuses?.length
        ? prisma.paymentBatch.findMany({
            where: { status: { in: config.batchStatuses as any[] } },
            include: { payments: true },
            orderBy: { created_at: 'desc' },
            take: 12,
          })
        : Promise.resolve([]),
      prisma.invoice.count({ where: { status: InvoiceStatus.REJECTED as any } }),
      prisma.invoice.count({
        where: {
          status: { in: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED] as any[] },
          due_date: { lte: dueSoon },
        },
      }),
      prisma.notification.count({
        where: {
          is_read: false,
          OR: [{ target_role: null }, { target_role: userRole || '' }],
        },
      }),
    ]);

    const statusCounts = await prisma.invoice.groupBy({
      by: ['status'],
      where: { status: { in: config.statuses as any[] } },
      _count: { id: true },
    });

    res.json({
      title: config.title,
      role: userRole,
      primary_href: config.primaryHref,
      summary: {
        work_items: workItems.length,
        scheduled_payments: scheduledPayments.length,
        batches_for_action: reviewBatches.length,
        rejected_invoices: rejected,
        due_soon: dueSoonInvoices,
        unread_notifications: unreadNotifications,
      },
      status_counts: statusCounts.map((row: any) => ({ status: row.status, count: row._count.id })),
      invoices: workItems.map((invoice: any) => ({
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        vendor_name: invoice.vendor?.name || invoice.vendor_name_raw || 'Unknown',
        total_amount: Number(invoice.total_amount),
        currency: invoice.currency,
        status: invoice.status,
        due_date: invoice.due_date,
        priority_flag: invoice.priority_flag,
        exception_count: invoice.exceptions?.length || 0,
        payment_status: invoice.payments?.[0]?.status,
        updated_at: invoice.updated_at,
      })),
      payments: (scheduledPayments as any[]).map((payment) => ({
        id: payment.id,
        invoice_id: payment.invoice_id,
        invoice_number: payment.invoice?.invoice_number,
        vendor_name: payment.invoice?.vendor?.name || 'Unknown',
        amount: Number(payment.amount),
        currency: payment.currency,
        payment_date: payment.payment_date,
        status: payment.status,
      })),
      batches: (reviewBatches as any[]).map((batch) => ({
        id: batch.id,
        batch_number: batch.batch_number,
        total_amount: Number(batch.total_amount),
        payment_count: batch.payment_count,
        status: batch.status,
        updated_at: batch.created_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching role dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch role dashboard' });
  }
});

/**
 * GET /api/dashboard/bottleneck
 * Get bottleneck view data: "Waiting on me", "At risk", and "Awaiting CI/SI"
 */
router.get('/bottleneck', async (req, res) => {
  try {
    const userRole = req.query.userRole as string;
    const userId = req.query.userId as string;

    // Get invoices waiting on the current user
    let waitingOnMe: any[] = [];
    try {
      waitingOnMe = await getWaitingOnMeInvoices(userRole);
    } catch (error) {
      console.error('Error fetching waiting on me invoices:', error);
    }

    // Get invoices at risk of SLA breach
    let atRisk: any[] = [];
    try {
      atRisk = await getAtRiskInvoices();
    } catch (error) {
      console.error('Error fetching at risk invoices:', error);
    }

    // Get Proforma Invoices awaiting CI/SI
    let awaitingCISI: any[] = [];
    try {
      awaitingCISI = await getPaidPIMissingCI();
    } catch (error) {
      console.error('Error fetching awaiting CI/SI invoices:', error);
    }

    res.json({
      waiting_on_me: waitingOnMe,
      at_risk: atRisk,
      awaiting_cisi: awaitingCISI,
    });
  } catch (error) {
    console.error('Error fetching bottleneck view:', error);
    res.status(500).json({ error: 'Failed to fetch bottleneck view' });
  }
});

/**
 * Get invoices waiting on a specific user role
 */
async function getWaitingOnMeInvoices(userRole?: string) {
  const roleToStatusMap: Record<string, InvoiceStatus[]> = {
    COORDINATOR: [InvoiceStatus.PENDING_COORDINATOR],
    PURCHASING_MANAGER: [InvoiceStatus.PENDING_MANAGER],
    MLO_ACCOUNT_HOLDER: [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER],
    PLANNING_MANAGER: [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER],
    SR_MANAGER: [InvoiceStatus.PENDING_SR_MANAGER],
    MS_POLLY: [InvoiceStatus.PENDING_POLLY],
    ACCOUNTING: [InvoiceStatus.PENDING_ACCOUNTING],
  };

  const statuses = userRole ? roleToStatusMap[userRole] : [];
  
  if (statuses.length === 0) {
    return [];
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: statuses as any[] },
    },
    include: {
      vendor: true,
      stage_timestamps: {
        where: {
          exited_at: null,
        },
        orderBy: {
          entered_at: 'desc',
        },
      },
    },
    orderBy: {
      invoice_received_date: 'desc',
    },
    take: 20,
  });

  return invoices.map((invoice: any) => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_name: invoice.vendor?.name || 'Unknown',
    amount: Number(invoice.total_amount),
    currency: invoice.currency,
    status: invoice.status,
    current_stage: invoice.stage_timestamps[0]?.stage,
    stage_entered_at: invoice.stage_timestamps[0]?.entered_at,
    sla_hours: invoice.stage_timestamps[0]?.sla_hours,
  }));
}

/**
 * Get invoices at risk of SLA breach
 */
async function getAtRiskInvoices() {
  const activeStages = await prisma.stageTimestamp.findMany({
    where: {
      exited_at: null,
      is_breached: false,
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
  });

  const atRiskInvoices: any[] = [];
  const now = new Date();

  for (const stage of activeStages) {
    const slaHours = stage.sla_hours;
    const enteredAt = new Date(stage.entered_at);
    const elapsedHours = calcWorkingHoursElapsed(enteredAt, now);
    const remainingHours = slaHours - elapsedHours;

    // At risk if less than 48 hours remaining
    if (remainingHours <= 48 && remainingHours > 0) {
      atRiskInvoices.push({
        id: stage.invoice.id,
        invoice_number: stage.invoice.invoice_number,
        vendor_name: stage.invoice.vendor?.name || 'Unknown',
        amount: Number(stage.invoice.total_amount),
        currency: stage.invoice.currency,
        status: stage.invoice.status,
        stage: stage.stage,
        remaining_hours: Math.round(remainingHours),
        elapsed_hours: Math.round(elapsedHours),
        sla_hours: slaHours,
        risk_level: remainingHours <= 24 ? 'CRITICAL' : 'WARNING',
      });
    }
  }

  // Sort by remaining hours (ascending - most urgent first)
  atRiskInvoices.sort((a, b) => a.remaining_hours - b.remaining_hours);

  return atRiskInvoices.slice(0, 20);
}

/**
 * GET /api/dashboard/sla-countdown/:invoiceId
 * Get SLA countdown for a specific invoice
 */
router.get('/sla-countdown/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const countdown = await getSLACountdown(invoiceId);
    res.json(countdown);
  } catch (error) {
    console.error('Error fetching SLA countdown:', error);
    res.status(500).json({ error: 'Failed to fetch SLA countdown' });
  }
});

export default router;
