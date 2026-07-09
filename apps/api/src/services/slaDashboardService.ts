import prisma from '../config/database';
import { InvoiceStatus, SLA_LIMITS, calcWorkingHoursElapsed } from '@ap-invoice/shared';

export interface SLAMetrics {
  stage: string;
  total_invoices: number;
  sla_compliant: number;
  sla_breached: number;
  compliance_rate: number;
  average_duration_hours: number;
  sla_target_hours: number;
}

export interface SLADashboardReport {
  report_date: Date;
  overall_compliance_rate: number;
  stage_metrics: SLAMetrics[];
  total_breaches: number;
  average_processing_time: number;
}

/**
 * Get SLA target hours for each stage — uses actual InvoiceStatus values
 */
function getSLATarget(stage: string): number {
  const targets: Record<string, number> = {
    [InvoiceStatus.PENDING_COORDINATOR]: SLA_LIMITS.COORDINATOR_DAYS * 24,
    [InvoiceStatus.PENDING_MANAGER]: SLA_LIMITS.PURCHASING_MANAGER_DAYS * 24,
    [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS * 24,
    [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS * 24,
    [InvoiceStatus.PENDING_SR_MANAGER]: SLA_LIMITS.SR_MANAGER_DAYS * 24,
    [InvoiceStatus.PENDING_POLLY]: SLA_LIMITS.MS_POLLY_DAYS * 24,
    [InvoiceStatus.PENDING_ACCOUNTING]: SLA_LIMITS.ACCOUNTING_DAYS * 24,
    [InvoiceStatus.POSTED_TO_QB]: SLA_LIMITS.PAYMENT_DAYS * 24,
    [InvoiceStatus.PAYMENT_SCHEDULED]: SLA_LIMITS.PAYMENT_DAYS * 24,
  };
  return targets[stage] || (SLA_LIMITS.ACCOUNTING_DAYS * 24);
}

/**
 * Calculate duration in hours from entered_at and exited_at
 */
function calcDurationHours(ts: any): number {
  if (!ts.exited_at) return 0;
  return calcWorkingHoursElapsed(new Date(ts.entered_at), new Date(ts.exited_at));
}

/**
 * Generate SLA dashboard report
 */
export async function generateSLADashboardReport(): Promise<SLADashboardReport> {
  const stageTimestamps = await prisma.stageTimestamp.findMany({
    include: {
      invoice: true,
    },
  });

  // Group by stage
  const stageGroups: Record<string, any[]> = {};
  for (const timestamp of stageTimestamps) {
    if (!stageGroups[timestamp.stage]) {
      stageGroups[timestamp.stage] = [];
    }
    stageGroups[timestamp.stage].push(timestamp);
  }

  const stageMetrics: SLAMetrics[] = [];
  let totalInvoices = 0;
  let totalCompliant = 0;
  let totalBreaches = 0;
  let totalDuration = 0;

  for (const [stage, timestamps] of Object.entries(stageGroups)) {
    const slaTarget = getSLATarget(stage);
    const total = timestamps.length;
    const breached = timestamps.filter((ts: any) => ts.is_breached).length;
    const compliant = total - breached;
    const complianceRate = total > 0 ? (compliant / total) * 100 : 0;
    
    const stageTotalDuration = timestamps.reduce((sum: number, ts: any) => sum + calcDurationHours(ts), 0);
    const averageDuration = total > 0 ? stageTotalDuration / total : 0;

    stageMetrics.push({
      stage,
      total_invoices: total,
      sla_compliant: compliant,
      sla_breached: breached,
      compliance_rate: complianceRate,
      average_duration_hours: averageDuration,
      sla_target_hours: slaTarget,
    });

    totalInvoices += total;
    totalCompliant += compliant;
    totalBreaches += breached;
    totalDuration += stageTotalDuration;
  }

  const overallComplianceRate = totalInvoices > 0 ? (totalCompliant / totalInvoices) * 100 : 0;
  const averageProcessingTime = totalInvoices > 0 ? totalDuration / totalInvoices : 0;

  return {
    report_date: new Date(),
    overall_compliance_rate: overallComplianceRate,
    stage_metrics: stageMetrics,
    total_breaches: totalBreaches,
    average_processing_time: averageProcessingTime,
  };
}

/**
 * Get SLA performance trend over time
 */
export async function getSLATrend(days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const stageTimestamps = await prisma.stageTimestamp.findMany({
    where: {
      entered_at: {
        gte: startDate,
      },
    },
    include: {
      invoice: true,
    },
    orderBy: {
      entered_at: 'asc',
    },
  });

  // Group by date
  const dateGroups: Record<string, any[]> = {};
  for (const timestamp of stageTimestamps) {
    const date = timestamp.entered_at.toISOString().split('T')[0];
    if (!dateGroups[date]) {
      dateGroups[date] = [];
    }
    dateGroups[date].push(timestamp);
  }

  const trend = Object.entries(dateGroups).map(([date, timestamps]) => {
    const total = timestamps.length;
    const breached = timestamps.filter((ts: any) => ts.is_breached).length;
    const complianceRate = total > 0 ? ((total - breached) / total) * 100 : 0;

    return {
      date,
      total_invoices: total,
      compliance_rate: complianceRate,
      breaches: breached,
    };
  });

  return trend;
}

/**
 * Get SLA breaches by stage
 */
export async function getSLABreachesByStage() {
  const breaches = await prisma.stageTimestamp.findMany({
    where: {
      is_breached: true,
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: {
      entered_at: 'desc',
    },
  });

  return breaches.map((breach: any) => {
    const durationHours = calcDurationHours(breach);
    return {
      invoice_id: breach.invoice_id,
      invoice_number: breach.invoice.invoice_number,
      vendor_name: breach.invoice.vendor?.name || 'Unknown',
      stage: breach.stage,
      entered_at: breach.entered_at,
      exited_at: breach.exited_at,
      duration_hours: durationHours,
      sla_hours: breach.sla_hours,
      breach_hours: durationHours - breach.sla_hours,
    };
  });
}

/**
 * Get SLA summary statistics
 */
export async function getSLASummary() {
  const report = await generateSLADashboardReport();

  const worstPerformingStage = report.stage_metrics
    .sort((a, b) => a.compliance_rate - b.compliance_rate)[0];

  const bestPerformingStage = report.stage_metrics
    .sort((a, b) => b.compliance_rate - a.compliance_rate)[0];

  return {
    overall_compliance_rate: report.overall_compliance_rate,
    total_breaches: report.total_breaches,
    average_processing_time: report.average_processing_time,
    worst_performing_stage: worstPerformingStage?.stage || 'N/A',
    worst_compliance_rate: worstPerformingStage?.compliance_rate || 0,
    best_performing_stage: bestPerformingStage?.stage || 'N/A',
    best_compliance_rate: bestPerformingStage?.compliance_rate || 0,
  };
}
