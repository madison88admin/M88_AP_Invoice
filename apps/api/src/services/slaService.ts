import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

// SLA thresholds in hours for each stage
const SLA_THRESHOLDS: Partial<Record<InvoiceStatus, number>> = {
  [InvoiceStatus.PENDING_COORDINATOR]: 168,
  [InvoiceStatus.PENDING_MANAGER]: 168,
  [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: 168,
  [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: 168,
  [InvoiceStatus.PENDING_SR_MANAGER]: 168,
  [InvoiceStatus.PENDING_POLLY]: 168,
  [InvoiceStatus.PENDING_ACCOUNTING]: 168,
};

/**
 * Create a stage timestamp when an invoice enters a stage
 */
export async function enterStage(invoiceId: string, stage: InvoiceStatus): Promise<void> {
  await prisma.stageTimestamp.create({
    data: {
      invoice_id: invoiceId,
      stage: stage as any,
      entered_at: new Date(),
      sla_hours: SLA_THRESHOLDS[stage] || 48,
      is_breached: false,
    },
  });
}

/**
 * Update a stage timestamp when an invoice exits a stage
 * Calculates duration and checks if SLA was breached
 */
export async function exitStage(invoiceId: string, stage: InvoiceStatus): Promise<void> {
  const stageTimestamp = await prisma.stageTimestamp.findFirst({
    where: {
      invoice_id: invoiceId,
      stage: stage as any,
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

  const isBreached = durationHours > (SLA_THRESHOLDS[stage] || 48);

  await prisma.stageTimestamp.update({
    where: { id: stageTimestamp.id },
    data: {
      exited_at: exitedAt,
      is_breached: isBreached,
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
export async function getSLABreachReport(stage?: InvoiceStatus) {
  const where = stage ? { stage: stage as any } : {};
  
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
export async function getSLAStatistics(stage?: InvoiceStatus) {
  const where = stage ? { stage: stage as any } : {};
  
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
      sla_hours: true,
    },
  });

  return {
    total_stages: totalStages,
    breached_stages: breachedStages,
    breach_rate: totalStages > 0 ? (breachedStages / totalStages) * 100 : 0,
    average_sla_hours: avgDuration._avg?.sla_hours || 0,
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
