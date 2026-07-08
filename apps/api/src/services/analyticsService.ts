import prisma from '../config/database';
import { logger } from '../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface ConfidenceMetrics {
  overall_avg: number;
  per_field: Array<{ field: string; avg_confidence: number; low_confidence_count: number; total: number }>;
  trend: Array<{ date: string; avg_confidence: number; count: number }>;
  distribution: { high: number; medium: number; low: number; missing: number };
}

export interface VendorAnalytics {
  vendors: Array<{
    vendor_name: string;
    invoice_count: number;
    avg_confidence: number;
    correction_count: number;
    top_error_fields: string[];
    fraud_flags: number;
    last_invoice_date: Date | null;
  }>;
}

export interface ErrorAnalytics {
  total_errors: number;
  total_warnings: number;
  by_field: Array<{ field: string; error_count: number; warning_count: number; sample_issue: string }>;
  by_severity: { CRITICAL: number; WARNING: number; INFO: number };
  trend: Array<{ date: string; error_count: number; warning_count: number }>;
  top_correction_reasons: Array<{ reason: string; count: number }>;
}

export interface ProcessingTimeline {
  stages: Array<{
    stage: string;
    avg_duration_ms: number;
    min_duration_ms: number;
    max_duration_ms: number;
    count: number;
  }>;
  total_avg_ms: number;
  slowest_invoices: Array<{
    invoice_number: string;
    vendor_name: string;
    duration_ms: number;
    stage: string;
  }>;
}

export interface PerformanceMetrics {
  total_processed: number;
  auto_approved_rate: number;
  manual_review_rate: number;
  avg_processing_time_ms: number;
  engine_usage: Array<{ engine: string; count: number; avg_confidence: number }>;
  retry_rate: number;
  retry_success_rate: number;
  fraud_detection_rate: number;
  self_validation_pass_rate: number;
}

export interface DashboardSummary {
  confidence: ConfidenceMetrics;
  vendors: VendorAnalytics;
  errors: ErrorAnalytics;
  timeline: ProcessingTimeline;
  performance: PerformanceMetrics;
  generated_at: Date;
}

// ============================================================================
// ANALYTICS SERVICE
// ============================================================================

export class AnalyticsService {
  private static instance: AnalyticsService;

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  async getDashboardSummary(days: number = 30): Promise<DashboardSummary> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [confidence, vendors, errors, timeline, performance] = await Promise.all([
      this.getConfidenceMetrics(startDate),
      this.getVendorAnalytics(startDate),
      this.getErrorAnalytics(startDate),
      this.getProcessingTimeline(startDate),
      this.getPerformanceMetrics(startDate),
    ]);

    return {
      confidence,
      vendors,
      errors,
      timeline,
      performance,
      generated_at: new Date(),
    };
  }

  // ============================================================================
  // CONFIDENCE METRICS
  // ============================================================================

  async getConfidenceMetrics(startDate: Date): Promise<ConfidenceMetrics> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: {
          created_at: { gte: startDate },
          ocr_confidence_score: { not: null },
        },
        select: {
          ocr_confidence_score: true,
          ocr_raw_data: true,
          created_at: true,
          vendor_name_raw: true,
        },
        orderBy: { created_at: 'desc' },
        take: 500,
      });

      const scores = invoices
        .map(i => Number(i.ocr_confidence_score))
        .filter(s => !isNaN(s) && s > 0);

      const overallAvg = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)
        : 0;

      // Distribution
      const distribution = { high: 0, medium: 0, low: 0, missing: 0 };
      for (const s of scores) {
        if (s >= 0.8) distribution.high++;
        else if (s >= 0.6) distribution.medium++;
        else if (s >= 0.3) distribution.low++;
        else distribution.missing++;
      }

      // Per-field confidence from ocr_raw_data (which may contain field_decision data)
      const fieldStats = new Map<string, { total: number; sum: number; lowCount: number }>();
      const fieldNames = ['vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'total_amount', 'currency', 'po_number', 'mpo_number', 'brand', 'season', 'payment_terms'];

      for (const field of fieldNames) {
        fieldStats.set(field, { total: 0, sum: 0, lowCount: 0 });
      }

      for (const inv of invoices) {
        const rawData = inv.ocr_raw_data as any;
        const decision = rawData?.field_decision || rawData?.decision;
        if (decision?.fields) {
          for (const [fieldName, fieldData] of Object.entries(decision.fields)) {
            const fd = fieldData as any;
            const stats = fieldStats.get(fieldName);
            if (stats && fd.final_confidence !== undefined) {
              stats.total++;
              stats.sum += fd.final_confidence;
              if (fd.final_confidence < 60) stats.lowCount++;
            }
          }
        }
      }

      const perField = Array.from(fieldStats.entries()).map(([field, stats]) => ({
        field,
        avg_confidence: stats.total > 0 ? Math.round(stats.sum / stats.total) : 0,
        low_confidence_count: stats.lowCount,
        total: stats.total,
      }));

      // Trend (daily averages)
      const trendMap = new Map<string, { sum: number; count: number }>();
      for (const inv of invoices) {
        const date = inv.created_at.toISOString().split('T')[0];
        const score = Number(inv.ocr_confidence_score);
        if (!isNaN(score) && score > 0) {
          if (!trendMap.has(date)) trendMap.set(date, { sum: 0, count: 0 });
          const t = trendMap.get(date)!;
          t.sum += score;
          t.count++;
        }
      }

      const trend = Array.from(trendMap.entries())
        .map(([date, t]) => ({
          date,
          avg_confidence: Math.round((t.sum / t.count) * 100),
          count: t.count,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        overall_avg: overallAvg,
        per_field: perField.sort((a, b) => a.avg_confidence - b.avg_confidence),
        trend,
        distribution,
      };
    } catch (error) {
      logger.error('[Analytics] Confidence metrics failed:', error);
      return { overall_avg: 0, per_field: [], trend: [], distribution: { high: 0, medium: 0, low: 0, missing: 0 } };
    }
  }

  // ============================================================================
  // VENDOR ANALYTICS
  // ============================================================================

  async getVendorAnalytics(startDate: Date): Promise<VendorAnalytics> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { created_at: { gte: startDate } },
        select: {
          vendor_name_raw: true,
          ocr_confidence_score: true,
          ocr_raw_data: true,
          created_at: true,
        },
      });

      const corrections = await prisma.correctionLog.findMany({
        where: { created_at: { gte: startDate } },
        select: { vendor_name: true, original_fields: true, corrected_fields: true },
      });

      const vendorMap = new Map<string, {
        invoice_count: number;
        confidence_sum: number;
        correction_count: number;
        error_fields: Set<string>;
        fraud_flags: number;
        last_invoice_date: Date | null;
      }>();

      for (const inv of invoices) {
        const vendor = inv.vendor_name_raw || 'Unknown';
        if (!vendorMap.has(vendor)) {
          vendorMap.set(vendor, {
            invoice_count: 0,
            confidence_sum: 0,
            correction_count: 0,
            error_fields: new Set(),
            fraud_flags: 0,
            last_invoice_date: null,
          });
        }
        const v = vendorMap.get(vendor)!;
        v.invoice_count++;
        const score = Number(inv.ocr_confidence_score);
        if (!isNaN(score)) v.confidence_sum += score;

        // Check for fraud flags in raw data
        const rawData = inv.ocr_raw_data as any;
        if (rawData?.fraud_check && !rawData.fraud_check.passed) {
          v.fraud_flags++;
        }

        if (!v.last_invoice_date || inv.created_at > v.last_invoice_date) {
          v.last_invoice_date = inv.created_at;
        }
      }

      // Count corrections per vendor
      for (const corr of corrections) {
        const vendor = corr.vendor_name || 'Unknown';
        const v = vendorMap.get(vendor);
        if (v) {
          v.correction_count++;
          // Extract corrected fields
          const corrected = corr.corrected_fields as any;
          if (corrected) {
            for (const field of Object.keys(corrected)) {
              v.error_fields.add(field);
            }
          }
        }
      }

      const vendors = Array.from(vendorMap.entries())
        .map(([vendor_name, v]) => ({
          vendor_name,
          invoice_count: v.invoice_count,
          avg_confidence: v.invoice_count > 0 ? Math.round((v.confidence_sum / v.invoice_count) * 100) : 0,
          correction_count: v.correction_count,
          top_error_fields: Array.from(v.error_fields).slice(0, 5),
          fraud_flags: v.fraud_flags,
          last_invoice_date: v.last_invoice_date,
        }))
        .sort((a, b) => b.invoice_count - a.invoice_count)
        .slice(0, 20);

      return { vendors };
    } catch (error) {
      logger.error('[Analytics] Vendor analytics failed:', error);
      return { vendors: [] };
    }
  }

  // ============================================================================
  // ERROR ANALYTICS
  // ============================================================================

  async getErrorAnalytics(startDate: Date): Promise<ErrorAnalytics> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { created_at: { gte: startDate } },
        select: { ocr_raw_data: true, created_at: true },
        take: 500,
      });

      const corrections = await prisma.correctionLog.findMany({
        where: { created_at: { gte: startDate } },
        select: { note: true, original_fields: true, corrected_fields: true },
      });

      let totalErrors = 0;
      let totalWarnings = 0;
      const byFieldMap = new Map<string, { errors: number; warnings: number; sample: string }>();
      const bySeverity = { CRITICAL: 0, WARNING: 0, INFO: 0 };
      const trendMap = new Map<string, { errors: number; warnings: number }>();
      const reasonMap = new Map<string, number>();

      for (const inv of invoices) {
        const rawData = inv.ocr_raw_data as any;
        const date = inv.created_at.toISOString().split('T')[0];
        if (!trendMap.has(date)) trendMap.set(date, { errors: 0, warnings: 0 });

        // Self validation issues
        if (rawData?.self_validation?.issues) {
          for (const issue of rawData.self_validation.issues) {
            if (issue.severity === 'ERROR') {
              totalErrors++;
              trendMap.get(date)!.errors++;
            } else if (issue.severity === 'WARNING') {
              totalWarnings++;
              trendMap.get(date)!.warnings++;
            }

            const field = issue.field || 'unknown';
            if (!byFieldMap.has(field)) byFieldMap.set(field, { errors: 0, warnings: 0, sample: issue.issue });
            const f = byFieldMap.get(field)!;
            if (issue.severity === 'ERROR') f.errors++;
            else if (issue.severity === 'WARNING') f.warnings++;
            if (!f.sample) f.sample = issue.issue;
          }
        }

        // Decision conflicts
        if (rawData?.decision?.conflicts) {
          for (const conflict of rawData.decision.conflicts) {
            bySeverity[conflict.severity as keyof typeof bySeverity]++;
            const field = conflict.field || 'unknown';
            if (!byFieldMap.has(field)) byFieldMap.set(field, { errors: 0, warnings: 0, sample: conflict.reason });
            const f = byFieldMap.get(field)!;
            if (conflict.severity === 'CRITICAL') f.errors++;
            else if (conflict.severity === 'WARNING') f.warnings++;
          }
        }

        // Fraud checks
        if (rawData?.fraud_check && !rawData.fraud_check.passed) {
          for (const check of rawData.fraud_check.checks || []) {
            if (!check.passed) {
              totalWarnings++;
              trendMap.get(date)!.warnings++;
            }
          }
        }
      }

      // Parse correction reasons from notes
      for (const corr of corrections) {
        if (corr.note) {
          const reasonMatch = corr.note.match(/Reasons?:\s*(.+?)(?:;|$)/);
          if (reasonMatch) {
            const reason = reasonMatch[1].trim();
            reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
          }
        }
      }

      const by_field = Array.from(byFieldMap.entries())
        .map(([field, f]) => ({
          field,
          error_count: f.errors,
          warning_count: f.warnings,
          sample_issue: f.sample,
        }))
        .sort((a, b) => (b.error_count + b.warning_count) - (a.error_count + a.warning_count))
        .slice(0, 15);

      const trend = Array.from(trendMap.entries())
        .map(([date, t]) => ({ date, error_count: t.errors, warning_count: t.warnings }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const top_correction_reasons = Array.from(reasonMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        total_errors: totalErrors,
        total_warnings: totalWarnings,
        by_field,
        by_severity: bySeverity,
        trend,
        top_correction_reasons,
      };
    } catch (error) {
      logger.error('[Analytics] Error analytics failed:', error);
      return {
        total_errors: 0, total_warnings: 0, by_field: [],
        by_severity: { CRITICAL: 0, WARNING: 0, INFO: 0 },
        trend: [], top_correction_reasons: [],
      };
    }
  }

  // ============================================================================
  // PROCESSING TIMELINE
  // ============================================================================

  async getProcessingTimeline(startDate: Date): Promise<ProcessingTimeline> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { created_at: { gte: startDate } },
        select: { ocr_raw_data: true, invoice_number: true, vendor_name_raw: true },
        take: 500,
      });

      const stageMap = new Map<string, { durations: number[]; count: number }>();
      const stageOrder = ['madison', 'gemini', 'qwen', 'groq', 'ollama', 'decision', 'line_item_validation', 'fraud_detection', 'self_validation', 'vendor_history'];

      for (const stage of stageOrder) {
        stageMap.set(stage, { durations: [], count: 0 });
      }

      const slowInvoices: Array<{ invoice_number: string; vendor_name: string; duration_ms: number; stage: string }> = [];

      for (const inv of invoices) {
        const rawData = inv.ocr_raw_data as any;
        const decision = rawData?.decision;

        if (decision?.extraction_time_ms) {
          stageMap.get('decision')!.durations.push(decision.extraction_time_ms);
          stageMap.get('decision')!.count++;

          if (decision.extraction_time_ms > 5000) {
            slowInvoices.push({
              invoice_number: inv.invoice_number,
              vendor_name: inv.vendor_name_raw || 'Unknown',
              duration_ms: decision.extraction_time_ms,
              stage: 'decision',
            });
          }
        }

        // Engine times (if available in raw data)
        if (rawData?.extraction_trace) {
          const trace = rawData.extraction_trace;
          for (const engine of ['madison', 'gemini', 'qwen', 'groq', 'ollama']) {
            if (trace[engine]?.duration_ms) {
              stageMap.get(engine)!.durations.push(trace[engine].duration_ms);
              stageMap.get(engine)!.count++;
            }
          }
        }
      }

      const stages = stageOrder
        .map(stage => {
          const s = stageMap.get(stage)!;
          if (s.durations.length === 0) return null;
          const avg = s.durations.reduce((a, b) => a + b, 0) / s.durations.length;
          return {
            stage,
            avg_duration_ms: Math.round(avg),
            min_duration_ms: Math.min(...s.durations),
            max_duration_ms: Math.max(...s.durations),
            count: s.count,
          };
        })
        .filter(s => s !== null) as ProcessingTimeline['stages'];

      const totalAvg = stages.length > 0
        ? Math.round(stages.reduce((a, b) => a + b.avg_duration_ms, 0))
        : 0;

      return {
        stages,
        total_avg_ms: totalAvg,
        slowest_invoices: slowInvoices.sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 10),
      };
    } catch (error) {
      logger.error('[Analytics] Processing timeline failed:', error);
      return { stages: [], total_avg_ms: 0, slowest_invoices: [] };
    }
  }

  // ============================================================================
  // PERFORMANCE METRICS
  // ============================================================================

  async getPerformanceMetrics(startDate: Date): Promise<PerformanceMetrics> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: { created_at: { gte: startDate } },
        select: {
          status: true,
          ocr_confidence_score: true,
          ocr_raw_data: true,
          created_at: true,
        },
        take: 1000,
      });

      const totalProcessed = invoices.length;
      const autoApproved = invoices.filter(i =>
        i.status === 'POSTED_TO_QB' || i.status === 'PAYMENT_SCHEDULED' || i.status === 'PAID'
      ).length;

      const manualReview = invoices.filter(i =>
        i.status === 'PENDING_COORDINATOR' || i.status === 'PENDING_MANAGER'
      ).length;

      // Engine usage from raw data
      const engineMap = new Map<string, { count: number; confidenceSum: number }>();
      let retryCount = 0;
      let retrySuccessCount = 0;
      let fraudDetectedCount = 0;
      let selfValidationPassCount = 0;
      let selfValidationTotal = 0;

      for (const inv of invoices) {
        const rawData = inv.ocr_raw_data as any;
        const decision = rawData?.decision;

        if (decision?.engines_used) {
          for (const engine of decision.engines_used) {
            if (!engineMap.has(engine)) engineMap.set(engine, { count: 0, confidenceSum: 0 });
            const e = engineMap.get(engine)!;
            e.count++;
            const score = Number(inv.ocr_confidence_score);
            if (!isNaN(score)) e.confidenceSum += score;
          }
        }

        if (rawData?.fraud_check && !rawData.fraud_check.passed) {
          fraudDetectedCount++;
        }

        if (rawData?.self_validation) {
          selfValidationTotal++;
          if (rawData.self_validation.passed) selfValidationPassCount++;
        }
      }

      const engine_usage = Array.from(engineMap.entries())
        .map(([engine, e]) => ({
          engine,
          count: e.count,
          avg_confidence: e.count > 0 ? Math.round((e.confidenceSum / e.count) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      return {
        total_processed: totalProcessed,
        auto_approved_rate: totalProcessed > 0 ? Math.round((autoApproved / totalProcessed) * 100) : 0,
        manual_review_rate: totalProcessed > 0 ? Math.round((manualReview / totalProcessed) * 100) : 0,
        avg_processing_time_ms: 0, // computed from timeline
        engine_usage,
        retry_rate: totalProcessed > 0 ? Math.round((retryCount / totalProcessed) * 100) : 0,
        retry_success_rate: retryCount > 0 ? Math.round((retrySuccessCount / retryCount) * 100) : 0,
        fraud_detection_rate: totalProcessed > 0 ? Math.round((fraudDetectedCount / totalProcessed) * 100) : 0,
        self_validation_pass_rate: selfValidationTotal > 0 ? Math.round((selfValidationPassCount / selfValidationTotal) * 100) : 0,
      };
    } catch (error) {
      logger.error('[Analytics] Performance metrics failed:', error);
      return {
        total_processed: 0, auto_approved_rate: 0, manual_review_rate: 0,
        avg_processing_time_ms: 0, engine_usage: [], retry_rate: 0,
        retry_success_rate: 0, fraud_detection_rate: 0, self_validation_pass_rate: 0,
      };
    }
  }
}

export const analyticsService = AnalyticsService.getInstance();
