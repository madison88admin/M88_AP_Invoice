import prisma from '../config/database';
import { ApprovalStage, InvoiceStatus } from '@ap-invoice/shared';

// SLA thresholds in hours for each stage
const SLA_THRESHOLDS: Record<ApprovalStage, number> = {
  [ApprovalStage.PURCHASING_COORDINATOR]: 24,    // 24 hours
  [ApprovalStage.PURCHASING_MANAGER]: 48,       // 48 hours
  [ApprovalStage.PLANNING_MANAGER]: 72,        // 72 hours
  [ApprovalStage.LINDSEY]: 96,                  // 96 hours
  [ApprovalStage.POLLY]: 24,                    // 24 hours
  [ApprovalStage.ACCOUNTING]: 48,              // 48 hours
};

/**
 * Create a stage timestamp when an invoice enters a stage
 */
export async function enterStage(invoiceId: string, stage: ApprovalStage): Promise<void> {
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage,
      entered_at: new Date(),
      sla_hours: SLA_THRESHOLDS[stage],
      isBreached: false,
    },
  });
}

/**
 * Update a stage timestamp when an invoice exits a stage
 * Calculates duration and checks if SLA was breached
 */
export async function exitStage(invoiceId: string, stage: ApprovalStage): Promise<void> {
  const stageTimestamp = await prisma.stageTimestamp.findFirst({
    where: {
      invoice_id: invoiceId,
      stage,
      exited_at: null,
    },
  });

  if (!stageTimestamp) {
    throw new Error(`No active stage timestamp found for stage ${stage}`);
  }

  const exitedAt = new Date();
  const enteredAt = new Date(stageTimestamp.entered_at);
  const durationMs = exitedAt.getTime() - enteredAt.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);

  const isBreached = durationHours > SLA_THRESHOLDS[stage];

  await prisma.stageTimestamp.update({
    where: { id: stageTimestamp.id },
    data: {
      exited_at: exitedAt,
      duration_hours: durationHours,
      isBreached,
    },
  });
}

/**
 * Get all stage timestamps for an invoice
 */
export async function getInvoiceStageTimestamps(invoiceId: string) {
  return prisma.stageTimestamp.findMany({
    where: { invoice_id: invoiceId },
    orderBy: { entered_at: 'asc' },
  });
}

/**
 * Get SLA breach report for a specific stage
 */
export async function getSLABreachReport(stage?: ApprovalStage) {
  const where = stage ? { stage } : {};
  
  const breachedStages = await prisma.stageTimestamp.findMany({
    where: {
      ...where,
      is_breached: true,
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: { entered_at: 'desc' },
  });

  return breachedStages;
}

/**
 * Get SLA statistics for a specific stage or all stages
 */
export async function getSLAStatistics(stage?: ApprovalStage) {
  const where = stage ? { stage } : {};
  
  const totalStages = await prisma.stageTimestamp.count({
    where: {
      ...where,
      exited_at: { not: null },
    },
  });

  const breachedStages = await prisma.stageTimestamp.count({
    where: {
      ...where,
      is_breached: true,
    },
  });

  const avgDuration = await prisma.stageTimestamp.aggregate({
    where: {
      ...where,
      exited_at: { not: null },
    },
    _avg: {
      duration_hours: true,
    },
  });

  return {
    total_stages: totalStages,
    breached_stages: breachedStages,
    breach_rate: totalStages > 0 ? (breachedStages / totalStages) * 100 : 0,
    average_duration_hours: avgDuration._avg.duration_hours || 0,
  };
}

/**
 * Check if an invoice has any SLA breaches
 */
export async function hasSLABreaches(invoiceId: string): Promise<boolean> {
  const breaches = await prisma.stageTimestamp.count({
    where: {
      invoice_id: invoiceId,
      is_breached: true,
    },
  });

  return breaches > 0;
}

/**
 * Get invoices with SLA breaches
 */
export async function getInvoicesWithSLABreaches() {
  const invoices = await prisma.invoice.findMany({
    where: {
      stage_timestamps: {
        some: {
          is_breached: true,
        },
      },
    },
    include: {
      vendor: true,
      stage_timestamps: {
        where: {
          is_breached: true,
        },
      },
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  return invoices;
}
