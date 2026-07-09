import prisma from '../config/database';
import { InvoiceStatus, SLA_LIMITS, calcWorkingHoursElapsed } from '@ap-invoice/shared';

// SLA thresholds in hours for each stage — derived from SLA_LIMITS
const SLA_THRESHOLDS: Partial<Record<InvoiceStatus, number>> = {
  [InvoiceStatus.PENDING_COORDINATOR]: SLA_LIMITS.COORDINATOR_DAYS * 24,
  [InvoiceStatus.PENDING_MANAGER]: SLA_LIMITS.PURCHASING_MANAGER_DAYS * 24,
  [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS * 24,
  [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS * 24,
  [InvoiceStatus.PENDING_SR_MANAGER]: SLA_LIMITS.SR_MANAGER_DAYS * 24,
  [InvoiceStatus.PENDING_POLLY]: SLA_LIMITS.MS_POLLY_DAYS * 24,
  [InvoiceStatus.PENDING_ACCOUNTING]: SLA_LIMITS.ACCOUNTING_DAYS * 24,
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
      sla_hours: SLA_THRESHOLDS[stage] || (SLA_LIMITS.ACCOUNTING_DAYS * 24),
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
  const durationHours = calcWorkingHoursElapsed(enteredAt, exitedAt);

  const isBreached = durationHours > (SLA_THRESHOLDS[stage] || (SLA_LIMITS.ACCOUNTING_DAYS * 24));

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

  // Get all completed stage timestamps to calculate actual duration
  const completedStages = await prisma.stageTimestamp.findMany({
    where: {
      ...where,
      exited_at: { not: null },
    },
  });

  const totalDurationHours = completedStages.reduce((sum, ts) => {
    const duration = calcWorkingHoursElapsed(new Date(ts.entered_at), new Date(ts.exited_at!));
    return sum + duration;
  }, 0);

  return {
    total_stages: totalStages,
    breached_stages: breachedStages,
    breach_rate: totalStages > 0 ? (breachedStages / totalStages) * 100 : 0,
    average_duration_hours: totalStages > 0 ? totalDurationHours / totalStages : 0,
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
