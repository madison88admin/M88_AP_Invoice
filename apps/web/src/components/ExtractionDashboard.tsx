import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Activity, TrendingUp, AlertTriangle, Clock, Building2,
  Gauge, CheckCircle, RefreshCw, Cpu, Shield, Brain,
  FileCheck2,
} from 'lucide-react';
import { analyticsApi } from '../lib/api';

interface DashboardData {
  confidence: {
    overall_avg: number | null;
    scored_count: number;
    total_actual_invoices: number;
    coverage_rate: number;
    per_field: Array<{ field: string; avg_confidence: number | null; low_confidence_count: number; total: number; coverage_rate: number }>;
    trend: Array<{ date: string; avg_confidence: number; count: number }>;
    distribution: { high: number; medium: number; low: number; missing: number };
  };
  vendors: {
    vendors: Array<{
      vendor_name: string;
      invoice_count: number;
      avg_confidence: number | null;
      correction_count: number;
      top_error_fields: string[];
      fraud_flags: number;
      last_invoice_date: string | null;
    }>;
  };
  errors: {
    total_errors: number;
    total_warnings: number;
    by_field: Array<{ field: string; error_count: number; warning_count: number; sample_issue: string }>;
    by_severity: { CRITICAL: number; WARNING: number; INFO: number };
    trend: Array<{ date: string; error_count: number; warning_count: number }>;
    top_correction_reasons: Array<{ reason: string; count: number }>;
  };
  timeline: {
    stages: Array<{ stage: string; avg_duration_ms: number; min_duration_ms: number; max_duration_ms: number; count: number }>;
    total_avg_ms: number;
    slowest_invoices: Array<{ invoice_number: string; vendor_name: string; duration_ms: number; stage: string }>;
  };
  performance: {
    total_processed: number;
    actual_invoice_count: number;
    non_invoice_blocked_count: number;
    duplicate_count: number;
    pending_review_count: number;
    auto_approved_rate: number;
    manual_review_rate: number;
    avg_processing_time_ms: number;
    avg_time_to_approval_ms: number | null;
    extraction_accuracy: number | null;
    first_pass_validation_rate: number | null;
    manual_correction_rate: number | null;
    actual_invoice_acceptance_rate: number | null;
    false_positive_non_invoice_rate: number | null;
    duplicate_detection_rate: number | null;
    engine_usage: Array<{ engine: string; count: number; avg_confidence: number | null }>;
    retry_rate: number;
    retry_success_rate: number;
    fraud_detection_rate: number;
    self_validation_pass_rate: number | null;
  };
}

const COLORS = {
  high: '#22c55e',
  medium: '#eab308',
  low: '#f97316',
  missing: '#ef4444',
  critical: '#ef4444',
  warning: '#f97316',
  info: '#3b82f6',
};


function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNullableNumber(value: unknown): number | null {
  const number = nullableNumber(value);
  return number !== null && number > 0 ? number : null;
}

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function confidenceColor(conf: number | null): string {
  if (conf === null || conf === undefined) return 'var(--text-muted)';
  if (conf >= 80) return 'var(--accent-green)';
  if (conf >= 60) return 'var(--accent-amber)';
  if (conf >= 40) return 'var(--accent-amber)';
  return 'var(--accent-red)';
}

function confidenceColorVar(conf: number | null): string {
  return confidenceColor(conf);
}

function displayPercent(value: number | null): string {
  return value === null || value === undefined ? 'N/A' : `${value}%`;
}

/**
 * The API and web app can be deployed independently. During a rolling deploy
 * an older API may omit the newer snake_case fields, so normalize both the
 * current response and the previous response shape before rendering. This
 * also prevents `undefined`/`NaN` from appearing in operational KPIs.
 */
export function normalizeDashboardData(input: any): DashboardData {
  const source = input?.performance || input?.confidence ? input : (input?.data || {});
  const confidence = source.confidence || {};
  const performance = source.performance || {};
  const distribution = confidence.distribution || {};
  const high = finiteNumber(distribution.high);
  const medium = finiteNumber(distribution.medium);
  const low = finiteNumber(distribution.low);
  const missing = finiteNumber(distribution.missing);
  const distributionTotal = high + medium + low + missing;
  const totalActual = finiteNumber(
    confidence.total_actual_invoices ?? confidence.totalActualInvoices ??
      performance.actual_invoice_count ?? performance.actualInvoicesProcessed ??
      performance.total_processed ?? distributionTotal,
  );
  const scored = finiteNumber(
    confidence.scored_count ?? confidence.scoredCount ?? (high + medium + low),
  );
  const coverage = nullableNumber(confidence.coverage_rate ?? confidence.coverageRate) ??
    (totalActual ? Math.round((scored / totalActual) * 100) : 0);
  const actualCount = finiteNumber(
    performance.actual_invoice_count ?? performance.actualInvoicesProcessed ??
      performance.total_processed ?? totalActual,
  );
  const pending = finiteNumber(
    performance.pending_review_count ?? performance.pendingReviewCount ??
      (performance.manual_review_rate !== undefined
        ? Math.round((finiteNumber(performance.manual_review_rate) / 100) * actualCount)
        : 0),
  );
  const avgProcessing = nullableNumber(
    performance.avg_processing_time_ms ?? performance.avgProcessingTimeMs ??
      source.timeline?.total_avg_ms,
  );
  const avgApproval = positiveNullableNumber(
    performance.avg_time_to_approval_ms ?? performance.avgTimeToApprovalMs ??
      (performance.avg_processing_time_ms ?? source.timeline?.total_avg_ms),
  );
  const fields = Array.isArray(confidence.per_field) ? confidence.per_field : [];

  return {
    confidence: {
      overall_avg: nullableNumber(confidence.overall_avg ?? confidence.overallAvg),
      scored_count: scored,
      total_actual_invoices: totalActual,
      coverage_rate: finiteNumber(coverage),
      per_field: fields.map((field: any) => {
        const total = finiteNumber(field.total ?? field.count);
        return {
          field: String(field.field || 'unknown'),
          avg_confidence: nullableNumber(field.avg_confidence ?? field.avgConfidence),
          low_confidence_count: finiteNumber(field.low_confidence_count ?? field.lowConfidenceCount),
          total,
          coverage_rate: finiteNumber(field.coverage_rate ?? field.coverageRate ?? (totalActual ? (total / totalActual) * 100 : 0)),
        };
      }),
      trend: Array.isArray(confidence.trend) ? confidence.trend.map((point: any) => ({
        date: String(point.date || ''),
        avg_confidence: finiteNumber(point.avg_confidence ?? point.avgConfidence),
        count: finiteNumber(point.count),
      })) : [],
      distribution: { high, medium, low, missing: Math.max(missing, Math.max(0, totalActual - scored)) },
    },
    vendors: { vendors: Array.isArray(source.vendors?.vendors) ? source.vendors.vendors : [] },
    errors: {
      total_errors: finiteNumber(source.errors?.total_errors),
      total_warnings: finiteNumber(source.errors?.total_warnings),
      by_field: Array.isArray(source.errors?.by_field) ? source.errors.by_field : [],
      by_severity: {
        CRITICAL: finiteNumber(source.errors?.by_severity?.CRITICAL),
        WARNING: finiteNumber(source.errors?.by_severity?.WARNING),
        INFO: finiteNumber(source.errors?.by_severity?.INFO),
      },
      trend: Array.isArray(source.errors?.trend) ? source.errors.trend : [],
      top_correction_reasons: Array.isArray(source.errors?.top_correction_reasons) ? source.errors.top_correction_reasons : [],
    },
    timeline: {
      stages: Array.isArray(source.timeline?.stages) ? source.timeline.stages : [],
      total_avg_ms: finiteNumber(source.timeline?.total_avg_ms ?? avgProcessing),
      slowest_invoices: Array.isArray(source.timeline?.slowest_invoices) ? source.timeline.slowest_invoices : [],
    },
    performance: {
      total_processed: finiteNumber(performance.total_processed ?? actualCount),
      actual_invoice_count: actualCount,
      non_invoice_blocked_count: finiteNumber(performance.non_invoice_blocked_count ?? performance.nonInvoiceBlockedCount),
      duplicate_count: finiteNumber(performance.duplicate_count ?? performance.duplicateCount),
      pending_review_count: pending,
      auto_approved_rate: finiteNumber(performance.auto_approved_rate ?? performance.autoApprovedRate),
      manual_review_rate: finiteNumber(performance.manual_review_rate ?? performance.manualReviewRate),
      avg_processing_time_ms: avgProcessing ?? 0,
      avg_time_to_approval_ms: avgApproval,
      extraction_accuracy: nullableNumber(performance.extraction_accuracy ?? performance.extractionAccuracy),
      first_pass_validation_rate: nullableNumber(performance.first_pass_validation_rate ?? performance.self_validation_pass_rate ?? performance.firstPassValidationRate),
      manual_correction_rate: nullableNumber(performance.manual_correction_rate ?? performance.manualCorrectionRate),
      actual_invoice_acceptance_rate: nullableNumber(performance.actual_invoice_acceptance_rate ?? performance.actualInvoiceAcceptanceRate ?? performance.auto_approved_rate),
      false_positive_non_invoice_rate: nullableNumber(performance.false_positive_non_invoice_rate ?? performance.falsePositiveNonInvoiceRate),
      duplicate_detection_rate: nullableNumber(performance.duplicate_detection_rate ?? performance.duplicateDetectionRate),
      engine_usage: Array.isArray(performance.engine_usage) ? performance.engine_usage : [],
      retry_rate: finiteNumber(performance.retry_rate),
      retry_success_rate: finiteNumber(performance.retry_success_rate),
      fraud_detection_rate: finiteNumber(performance.fraud_detection_rate ?? performance.fraudDetectionRate),
      self_validation_pass_rate: nullableNumber(performance.self_validation_pass_rate),
    },
  };
}

export default function ExtractionDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [benchmark, setBenchmark] = useState<any | null>(null);
  const [benchmarkError, setBenchmarkError] = useState('');

  const runBenchmark = async (file: File) => {
    try {
      setBenchmarkError('');
      const parsed = JSON.parse(await file.text());
      const cases = Array.isArray(parsed) ? parsed : parsed.cases;
      const response = await analyticsApi.runExtractionBenchmark(cases);
      setBenchmark(response.data);
    } catch (e: any) {
      setBenchmarkError(e.response?.data?.error || e.message || 'Benchmark file is invalid');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsApi.getDashboard(days);
      setData(normalizeDashboardData(res.data));
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [days]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 animate-fade-in" style={{ background: 'var(--bg-base)' }}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: 'var(--accent-blue)' }} />
          <div className="h-10 w-10 rounded-full border-2 animate-spin" style={{ borderTopColor: 'var(--accent-blue)', borderRightColor: 'var(--accent-blue)', borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
        </div>
        <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 animate-fade-in" style={{ background: 'var(--bg-base)' }}>
        <AlertTriangle className="w-8 h-8" style={{ color: 'var(--accent-red)' }} />
        <span className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const distributionData = [
    { name: 'High (80%+)', value: data.confidence.distribution.high, fill: COLORS.high },
    { name: 'Medium (60-79%)', value: data.confidence.distribution.medium, fill: COLORS.medium },
    { name: 'Low (30-59%)', value: data.confidence.distribution.low, fill: COLORS.low },
    { name: 'Missing / Unscored', value: data.confidence.distribution.missing, fill: COLORS.missing },
  ];

  const severityData = [
    { name: 'Critical', value: data.errors.by_severity.CRITICAL, fill: COLORS.critical },
    { name: 'Warning', value: data.errors.by_severity.WARNING, fill: COLORS.warning },
    { name: 'Info', value: data.errors.by_severity.INFO, fill: COLORS.info },
  ];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* Filter Controls */}
      <div className="flex items-center justify-end gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 rounded-lg text-sm transition-all"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchData}
            className="px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-all"
            style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-blue-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-blue)'; }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

      {/* Operational KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<FileCheck2 className="w-5 h-5" />}
          label="Actual Invoices Processed"
          value={`${data.performance.actual_invoice_count}`}
          subtitle={`${data.performance.pending_review_count} pending/manual review`}
          color="var(--accent-blue)"
        />
        <KpiCard
          icon={<CheckCircle className="w-5 h-5" />}
          label="First-Pass Validation"
          value={displayPercent(data.performance.first_pass_validation_rate)}
          subtitle={`Acceptance ${displayPercent(data.performance.actual_invoice_acceptance_rate)}`}
          color="var(--accent-green)"
        />
        <KpiCard
          icon={<RefreshCw className="w-5 h-5" />}
          label="Manual Correction Rate"
          value={displayPercent(data.performance.manual_correction_rate)}
          subtitle={`Extraction accuracy ${displayPercent(data.performance.extraction_accuracy)}`}
          color="var(--accent-amber)"
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />}
          label="Avg Time to Approval"
          value={data.performance.avg_time_to_approval_ms === null ? 'N/A' : formatMs(data.performance.avg_time_to_approval_ms)}
          subtitle={`${data.performance.duplicate_count} duplicate · ${data.performance.non_invoice_blocked_count} non-invoice blocked`}
          color="var(--accent-purple)"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricPill label="Confidence coverage" value={`${data.confidence.coverage_rate}%`} detail={`${data.confidence.scored_count}/${data.confidence.total_actual_invoices} scored`} />
        <MetricPill label="Duplicate detection" value={displayPercent(data.performance.duplicate_detection_rate)} detail={`${data.performance.duplicate_count} records`} />
        <MetricPill label="Fraud flags" value={`${data.performance.fraud_detection_rate}%`} detail="of actual invoices" />
        <MetricPill label="Non-invoice false positive" value={data.performance.false_positive_non_invoice_rate === null ? 'N/A' : displayPercent(data.performance.false_positive_non_invoice_rate)} detail="needs labelled outcomes" />
      </div>

      {/* Confidence Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Confidence Trend */}
        <div className="lg:col-span-2 rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} />
            Confidence Trend
          </h2>
          {data.confidence.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data.confidence.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="avg_confidence" stroke="#3b82f6" name="Avg Confidence %" strokeWidth={2} />
                <Line type="monotone" dataKey="count" stroke="#22c55e" name="Invoice Count" strokeWidth={1} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No confidence data yet" />
          )}
        </div>

        {/* Confidence Distribution */}
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Confidence Distribution</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{data.confidence.scored_count}/{data.confidence.total_actual_invoices} scored ({data.confidence.coverage_rate}% coverage)</p>
          {data.confidence.distribution.high + data.confidence.distribution.medium + data.confidence.distribution.low + data.confidence.distribution.missing > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={distributionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {distributionData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No data" />
          )}
        </div>
      </div>

      {/* Per-Field Confidence */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Gauge className="w-5 h-5" style={{ color: 'var(--accent-purple)' }} />
          Per-Field Confidence
        </h2>
        {data.confidence.per_field.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.confidence.per_field} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="field" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Legend />
              <Bar dataKey="avg_confidence" name="Avg Confidence %" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="low_confidence_count" name="Low Confidence Count" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No per-field data yet" />
        )}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {data.confidence.per_field.map((field) => (
            <div key={field.field} className="text-xs rounded-lg p-2" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{field.field}</div>
              <div>{field.avg_confidence === null ? 'N/A' : `${field.avg_confidence}%`} · {field.total}/{data.confidence.total_actual_invoices} scored</div>
            </div>
          ))}
        </div>
      </div>

      {/* Vendor Analytics */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Building2 className="w-5 h-5" style={{ color: 'var(--accent-green)' }} />
          Vendor Analytics
        </h2>
        {data.vendors.vendors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th className="pb-2 pr-4">Vendor</th>
                  <th className="pb-2 pr-4 text-right">Invoices</th>
                  <th className="pb-2 pr-4 text-right">Avg Conf</th>
                  <th className="pb-2 pr-4 text-right">Corrections</th>
                  <th className="pb-2 pr-4 text-right">Fraud Flags</th>
                  <th className="pb-2">Top Error Fields</th>
                </tr>
              </thead>
              <tbody>
                {data.vendors.vendors.map((v, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: 'var(--text-primary)' }}>{v.vendor_name}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--text-secondary)' }}>{v.invoice_count}</td>
                    <td className="py-2 pr-4 text-right font-medium" style={{ color: confidenceColorVar(v.avg_confidence) }}>
                      {displayPercent(v.avg_confidence)}
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {v.correction_count > 0 ? (
                        <span style={{ color: 'var(--accent-amber)' }}>{v.correction_count}</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {v.fraud_flags > 0 ? (
                        <span style={{ color: 'var(--accent-red)' }}>{v.fraud_flags}</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {v.top_error_fields.length > 0 ? v.top_error_fields.join(', ') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No vendor data yet" />
        )}
      </div>

      {/* Error Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Error Trend */}
        <div className="lg:col-span-2 rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <AlertTriangle className="w-5 h-5" style={{ color: 'var(--accent-amber)' }} />
            Error & Warning Trend
          </h2>
          {data.errors.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data.errors.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="error_count" stroke="#ef4444" name="Errors" strokeWidth={2} />
                <Line type="monotone" dataKey="warning_count" stroke="#f97316" name="Warnings" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No error data yet" />
          )}
        </div>

        {/* Severity Distribution */}
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Issues by Severity</h2>
          {data.errors.by_severity.CRITICAL + data.errors.by_severity.WARNING + data.errors.by_severity.INFO > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={severityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {severityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No issues" />
          )}
        </div>
      </div>

      {/* Top Correction Reasons & Error Fields */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Top Correction Reasons</h2>
          {data.errors.top_correction_reasons.length > 0 ? (
            <div className="space-y-2">
              {data.errors.top_correction_reasons.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.reason}</span>
                  <span className="text-sm font-medium px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' }}>
                    {r.count}x
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No corrections yet" />
          )}
        </div>

        <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Errors by Field</h2>
          {data.errors.by_field.length > 0 ? (
            <div className="space-y-2">
              {data.errors.by_field.slice(0, 10).map((f, i) => (
                <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{f.field}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{f.sample_issue}</span>
                  </div>
                  <div className="flex gap-2">
                    {f.error_count > 0 && (
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)' }}>
                        {f.error_count} errors
                      </span>
                    )}
                    {f.warning_count > 0 && (
                      <span className="text-xs px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' }}>
                        {f.warning_count} warnings
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No field errors" />
          )}
        </div>
      </div>

      {/* Processing Timeline */}
      <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="w-5 h-5" style={{ color: 'var(--accent-purple)' }} />
          Processing Timeline
          <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-muted)' }}>
            Total avg: {formatMs(data.timeline.total_avg_ms)}
          </span>
        </h2>
        {data.timeline.stages.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.timeline.stages}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="stage" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMs(v)} />
              <Tooltip formatter={(v: any) => formatMs(Number(v))} />
              <Legend />
              <Bar dataKey="avg_duration_ms" name="Avg Duration" fill="#a855f7" radius={[4, 4, 0, 0]} />
              <Bar dataKey="max_duration_ms" name="Max Duration" fill="#ec4899" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No timeline data yet" />
        )}
      </div>

      <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <FileCheck2 className="w-5 h-5" style={{ color: 'var(--accent-purple)' }} />
              Ground-truth Extraction Benchmark
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Upload JSON cases containing expected and actual fields to measure true accuracy—not model confidence.</p>
          </div>
          <label className="px-4 py-2 rounded-lg cursor-pointer" style={{ background: 'var(--accent-purple)', color: 'white' }}>
            Run benchmark
            <input type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && runBenchmark(event.target.files[0])} />
          </label>
        </div>
        {benchmarkError && <div className="mt-3 text-sm" style={{ color: 'var(--accent-red)' }}>{benchmarkError}</div>}
        {benchmark && (
          <div className="grid sm:grid-cols-3 gap-4 mt-5">
            <KpiCard icon={<Gauge className="w-5 h-5" />} label="Measured Accuracy" value={`${benchmark.overall_accuracy}%`} subtitle={`${benchmark.case_count} test invoices`} />
            <KpiCard icon={<CheckCircle className="w-5 h-5" />} label="Straight-through Rate" value={`${benchmark.straight_through_rate}%`} subtitle="No field corrections required" />
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)' }}>
              <div className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Lowest-accuracy fields</div>
              {(benchmark.per_field || []).slice(0, 4).map((field: any) => <div key={field.field} className="flex justify-between text-sm"><span>{field.field}</span><strong>{field.accuracy}%</strong></div>)}
            </div>
          </div>
        )}
      </div>

      {/* Engine Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Cpu className="w-5 h-5" style={{ color: 'var(--accent-blue)' }} />
            Engine Usage
          </h2>
          {data.performance.engine_usage.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.performance.engine_usage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="engine" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" name="Usage Count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="avg_confidence" name="Avg Confidence %" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No engine data" />
          )}
        </div>

        {/* Slowest Invoices */}
        <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Slowest Invoices</h2>
          {data.timeline.slowest_invoices.length > 0 ? (
            <div className="space-y-2">
              {data.timeline.slowest_invoices.map((inv, i) => (
                <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{inv.invoice_number}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{inv.vendor_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{inv.stage}</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>{formatMs(inv.duration_ms)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No slow invoices" />
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, subtitle, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl p-5 card-lift" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color: color || 'var(--accent-blue)' }}>{icon}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      {subtitle && <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{subtitle}</div>}
    </div>
  );
}

function MetricPill({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{detail}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-sm animate-soft-bounce" style={{ color: 'var(--text-muted)' }}>
      {message}
    </div>
  );
}
