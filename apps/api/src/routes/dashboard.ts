import express, { Router } from 'express';
import prisma from '../config/database';
import { InvoiceStatus, InvoiceType } from '@ap-invoice/shared';
import { getPaidPIMissingCI } from '../services/piFollowUpService';
import { getSLACountdown } from '../services/slaReminderService';

const router: Router = express.Router();

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
    MLO_PLANNING_MANAGER: [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER],
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
    const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
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
