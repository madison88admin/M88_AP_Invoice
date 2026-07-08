import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Activity, TrendingUp, AlertTriangle, Clock, Building2,
  Gauge, CheckCircle, RefreshCw, Cpu, Shield, Brain,
} from 'lucide-react';
import { analyticsApi } from '../lib/api';

interface DashboardData {
  confidence: {
    overall_avg: number;
    per_field: Array<{ field: string; avg_confidence: number; low_confidence_count: number; total: number }>;
    trend: Array<{ date: string; avg_confidence: number; count: number }>;
    distribution: { high: number; medium: number; low: number; missing: number };
  };
  vendors: {
    vendors: Array<{
      vendor_name: string;
      invoice_count: number;
      avg_confidence: number;
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
    auto_approved_rate: number;
    manual_review_rate: number;
    avg_processing_time_ms: number;
    engine_usage: Array<{ engine: string; count: number; avg_confidence: number }>;
    retry_rate: number;
    retry_success_rate: number;
    fraud_detection_rate: number;
    self_validation_pass_rate: number;
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


function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function confidenceColor(conf: number): string {
  if (conf >= 80) return 'text-green-500';
  if (conf >= 60) return 'text-yellow-500';
  if (conf >= 40) return 'text-orange-500';
  return 'text-red-500';
}

export default function ExtractionDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsApi.getDashboard(days);
      setData(res.data);
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
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-gray-500">Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <AlertTriangle className="w-8 h-8 text-red-500" />
        <span className="ml-3 text-red-500">{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const distributionData = [
    { name: 'High (80%+)', value: data.confidence.distribution.high, fill: COLORS.high },
    { name: 'Medium (60-79%)', value: data.confidence.distribution.medium, fill: COLORS.medium },
    { name: 'Low (30-59%)', value: data.confidence.distribution.low, fill: COLORS.low },
    { name: 'Missing (<30%)', value: data.confidence.distribution.missing, fill: COLORS.missing },
  ];

  const severityData = [
    { name: 'Critical', value: data.errors.by_severity.CRITICAL, fill: COLORS.critical },
    { name: 'Warning', value: data.errors.by_severity.WARNING, fill: COLORS.warning },
    { name: 'Info', value: data.errors.by_severity.INFO, fill: COLORS.info },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-7 h-7 text-blue-500" />
            Extraction Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time monitoring of extraction pipeline performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:border-gray-700"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchData}
            className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Gauge className="w-5 h-5" />}
          label="Avg Confidence"
          value={`${data.confidence.overall_avg}%`}
          color={confidenceColor(data.confidence.overall_avg)}
        />
        <KpiCard
          icon={<CheckCircle className="w-5 h-5" />}
          label="Auto-Approved"
          value={`${data.performance.auto_approved_rate}%`}
          subtitle={`${data.performance.total_processed} processed`}
          color="text-green-500"
        />
        <KpiCard
          icon={<Shield className="w-5 h-5" />}
          label="Fraud Detected"
          value={`${data.performance.fraud_detection_rate}%`}
          color="text-orange-500"
        />
        <KpiCard
          icon={<Brain className="w-5 h-5" />}
          label="Self-Validation Pass"
          value={`${data.performance.self_validation_pass_rate}%`}
          color="text-blue-500"
        />
      </div>

      {/* Confidence Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Confidence Trend */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-500" />
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
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Confidence Distribution</h2>
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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-purple-500" />
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
      </div>

      {/* Vendor Analytics */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-green-500" />
          Vendor Analytics
        </h2>
        {data.vendors.vendors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500">
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
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 pr-4 font-medium">{v.vendor_name}</td>
                    <td className="py-2 pr-4 text-right">{v.invoice_count}</td>
                    <td className={`py-2 pr-4 text-right font-medium ${confidenceColor(v.avg_confidence)}`}>
                      {v.avg_confidence}%
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {v.correction_count > 0 ? (
                        <span className="text-orange-500">{v.correction_count}</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {v.fraud_flags > 0 ? (
                        <span className="text-red-500">{v.fraud_flags}</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 text-xs text-gray-500">
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
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
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
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Issues by Severity</h2>
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
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Top Correction Reasons</h2>
          {data.errors.top_correction_reasons.length > 0 ? (
            <div className="space-y-2">
              {data.errors.top_correction_reasons.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/50">
                  <span className="text-sm">{r.reason}</span>
                  <span className="text-sm font-medium px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                    {r.count}x
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No corrections yet" />
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Errors by Field</h2>
          {data.errors.by_field.length > 0 ? (
            <div className="space-y-2">
              {data.errors.by_field.slice(0, 10).map((f, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/50">
                  <div>
                    <span className="text-sm font-medium">{f.field}</span>
                    <span className="text-xs text-gray-500 ml-2">{f.sample_issue}</span>
                  </div>
                  <div className="flex gap-2">
                    {f.error_count > 0 && (
                      <span className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
                        {f.error_count} errors
                      </span>
                    )}
                    {f.warning_count > 0 && (
                      <span className="text-xs px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded">
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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-purple-500" />
          Processing Timeline
          <span className="text-sm font-normal text-gray-500 ml-2">
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

      {/* Engine Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-500" />
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
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Slowest Invoices</h2>
          {data.timeline.slowest_invoices.length > 0 ? (
            <div className="space-y-2">
              {data.timeline.slowest_invoices.map((inv, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/50">
                  <div>
                    <span className="text-sm font-medium">{inv.invoice_number}</span>
                    <span className="text-xs text-gray-500 ml-2">{inv.vendor_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{inv.stage}</span>
                    <span className="text-sm font-medium text-orange-500">{formatMs(inv.duration_ms)}</span>
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
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 text-sm">{label}</span>
        <span className={color || 'text-blue-500'}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${color || ''}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-400 mt-1">{subtitle}</div>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
      {message}
    </div>
  );
}
