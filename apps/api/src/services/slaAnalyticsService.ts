import prisma from '../config/database';
import { InvoiceStatus, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { logger } from '../utils/logger';

export interface StageCycleTime {
  stage: string;
  avg_hours: number;
  min_hours: number;
  max_hours: number;
  count: number;
  breached_count: number;
  breach_rate: number;
}

export interface SLABreachSummary {
  currently_breached: number;
  breached_today: number;
  breached_this_week: number;
  by_stage: Array<{ stage: string; count: number }>;
  by_approver_role: Array<{ role: string; count: number }>;
}

export interface BottleneckAnalysis {
  by_stage: Array<{
    stage: string;
    active_count: number;
    avg_wait_hours: number;
    max_wait_hours: number;
    breached_count: number;
  }>;
  slowest_invoices: Array<{
    invoice_id: string;
    invoice_number: string;
    vendor_name: string;
    stage: string;
    elapsed_hours: number;
    amount: number;
  }>;
}

export interface SLAAnalyticsSummary {
  cycle_times: StageCycleTime[];
  sla_breaches: SLABreachSummary;
  bottlenecks: BottleneckAnalysis;
  total_active: number;
  total_processed_30d: number;
  avg_cycle_time_hours: number;
  generated_at: Date;
}

class SLAAnalyticsService {
  private static instance: SLAAnalyticsService;

  static getInstance(): SLAAnalyticsService {
    if (!SLAAnalyticsService.instance) {
      SLAAnalyticsService.instance = new SLAAnalyticsService();
    }
    return SLAAnalyticsService.instance;
  }

  async getSummary(days: number = 30): Promise<SLAAnalyticsSummary> {
    const [cycleTimes, slaBreaches, bottlenecks, totalActive, totalProcessed] = await Promise.all([
      this.getStageCycleTimes(days),
      this.getSLABreachSummary(),
      this.getBottleneckAnalysis(),
      this.getTotalActive(),
      this.getTotalProcessed(days),
    ]);

    const avgCycleTime = cycleTimes.length > 0
      ? Math.round(cycleTimes.reduce((a, b) => a + b.avg_hours, 0) / cycleTimes.length)
      : 0;

    return {
      cycle_times: cycleTimes,
      sla_breaches: slaBreaches,
      bottlenecks,
      total_active: totalActive,
      total_processed_30d: totalProcessed,
      avg_cycle_time_hours: avgCycleTime,
      generated_at: new Date(),
    };
  }

  async getStageCycleTimes(days: number = 30): Promise<StageCycleTime[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stages = await prisma.stageTimestamp.findMany({
        where: {
          exited_at: { not: null },
          entered_at: { gte: startDate },
        },
        select: {
          stage: true,
          entered_at: true,
          exited_at: true,
          sla_hours: true,
          is_breached: true,
        },
      });

      const stageMap = new Map<string, { durations: number[]; breached: number }>();

      for (const s of stages) {
        const stageName = s.stage as string;
        if (!stageMap.has(stageName)) {
          stageMap.set(stageName, { durations: [], breached: 0 });
        }
        const entry = stageMap.get(stageName)!;
        const duration = calcWorkingHoursElapsed(new Date(s.entered_at), new Date(s.exited_at!));
        entry.durations.push(duration);
        if (s.is_breached) entry.breached++;
      }

      const result: StageCycleTime[] = Array.from(stageMap.entries()).map(([stage, data]) => {
        const avg = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
        return {
          stage,
          avg_hours: Math.round(avg * 10) / 10,
          min_hours: Math.round(Math.min(...data.durations) * 10) / 10,
          max_hours: Math.round(Math.max(...data.durations) * 10) / 10,
          count: data.durations.length,
          breached_count: data.breached,
          breach_rate: data.durations.length > 0 ? Math.round((data.breached / data.durations.length) * 100) : 0,
        };
      }).sort((a, b) => a.avg_hours - b.avg_hours);

      return result;
    } catch (error) {
      logger.error('[SLA Analytics] Cycle times failed:', error);
      return [];
    }
  }

  async getSLABreachSummary(): Promise<SLABreachSummary> {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);

      const [currentlyBreached, breachedToday, breachedThisWeek] = await Promise.all([
        prisma.stageTimestamp.count({
          where: { is_breached: true, exited_at: null },
        }),
        prisma.stageTimestamp.count({
          where: { is_breached: true, exited_at: { gte: todayStart } },
        }),
        prisma.stageTimestamp.count({
          where: { is_breached: true, exited_at: { gte: weekStart } },
        }),
      ]);

      const byStageRaw = await prisma.stageTimestamp.groupBy({
        by: ['stage'],
        where: { is_breached: true, exited_at: null },
        _count: true,
      });

      const by_stage = byStageRaw.map(s => ({
        stage: s.stage as string,
        count: s._count,
      })).sort((a, b) => b.count - a.count);

      const stageToRole: Record<string, string> = {
        PENDING_COORDINATOR: 'Purchasing Coordinator',
        PENDING_MANAGER: 'Purchasing Manager',
        PENDING_MLO_ACCOUNT_HOLDER: 'MLO Account Holder',
        PENDING_MLO_PLANNING_MANAGER: 'Planning Manager',
        PENDING_SR_MANAGER: 'Sr. Manager Global Production',
        PENDING_POLLY: 'Ms. Polly',
        PENDING_ACCOUNTING: 'Accounting',
        PAYMENT_SCHEDULED: 'Payment Processing',
      };

      const by_approver_role = by_stage.map(s => ({
        role: stageToRole[s.stage] || s.stage,
        count: s.count,
      }));

      return {
        currently_breached: currentlyBreached,
        breached_today: breachedToday,
        breached_this_week: breachedThisWeek,
        by_stage,
        by_approver_role,
      };
    } catch (error) {
      logger.error('[SLA Analytics] Breach summary failed:', error);
      return {
        currently_breached: 0,
        breached_today: 0,
        breached_this_week: 0,
        by_stage: [],
        by_approver_role: [],
      };
    }
  }

  async getBottleneckAnalysis(): Promise<BottleneckAnalysis> {
    try {
      const activeStages = await prisma.stageTimestamp.findMany({
        where: { exited_at: null },
        include: {
          invoice: {
            include: { vendor: true },
          },
        },
      });

      const stageMap = new Map<string, { count: number; durations: number[]; breached: number }>();

      for (const s of activeStages) {
        const stageName = s.stage as string;
        if (!stageMap.has(stageName)) {
          stageMap.set(stageName, { count: 0, durations: [], breached: 0 });
        }
        const entry = stageMap.get(stageName)!;
        entry.count++;
        const elapsed = calcWorkingHoursElapsed(new Date(s.entered_at), new Date());
        entry.durations.push(elapsed);
        if (s.is_breached) entry.breached++;
      }

      const by_stage = Array.from(stageMap.entries()).map(([stage, data]) => ({
        stage,
        active_count: data.count,
        avg_wait_hours: Math.round((data.durations.reduce((a, b) => a + b, 0) / data.durations.length) * 10) / 10,
        max_wait_hours: Math.round(Math.max(...data.durations) * 10) / 10,
        breached_count: data.breached,
      })).sort((a, b) => b.active_count - a.active_count);

      const slowest = activeStages
        .map(s => ({
          invoice_id: s.invoice.id,
          invoice_number: s.invoice.invoice_number,
          vendor_name: s.invoice.vendor?.name || 'Unknown',
          stage: s.stage as string,
          elapsed_hours: Math.round(calcWorkingHoursElapsed(new Date(s.entered_at), new Date()) * 10) / 10,
          amount: Number(s.invoice.total_amount),
        }))
        .sort((a, b) => b.elapsed_hours - a.elapsed_hours)
        .slice(0, 10);

      return { by_stage, slowest_invoices: slowest };
    } catch (error) {
      logger.error('[SLA Analytics] Bottleneck analysis failed:', error);
      return { by_stage: [], slowest_invoices: [] };
    }
  }

  private async getTotalActive(): Promise<number> {
    try {
      return await prisma.stageTimestamp.count({ where: { exited_at: null } });
    } catch {
      return 0;
    }
  }

  private async getTotalProcessed(days: number): Promise<number> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      return await prisma.invoice.count({
        where: {
          status: { in: [InvoiceStatus.PAID as any, InvoiceStatus.POSTED_TO_QB as any] },
          updated_at: { gte: startDate },
        },
      });
    } catch {
      return 0;
    }
  }
}

export const slaAnalyticsService = SLAAnalyticsService.getInstance();
