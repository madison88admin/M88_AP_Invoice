import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, AlertTriangle, TrendingDown, Activity, Download } from 'lucide-react';
import { slaAnalyticsApi, auditExportApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface StageCycleTime {
  stage: string;
  avg_hours: number;
  min_hours: number;
  max_hours: number;
  count: number;
  breached_count: number;
  breach_rate: number;
}

interface SLABreachSummary {
  currently_breached: number;
  breached_today: number;
  breached_this_week: number;
  by_stage: Array<{ stage: string; count: number }>;
  by_approver_role: Array<{ role: string; count: number }>;
}

interface BottleneckAnalysis {
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

interface SLAAnalyticsSummary {
  cycle_times: StageCycleTime[];
  sla_breaches: SLABreachSummary;
  bottlenecks: BottleneckAnalysis;
  total_active: number;
  total_processed_30d: number;
  avg_cycle_time_hours: number;
  generated_at: Date;
}

const stageLabels: Record<string, string> = {
  RECEIVED: 'Received',
  OCR_PROCESSING: 'OCR Processing',
  VALIDATION_PENDING: 'Validation',
  EXCEPTION_FLAGGED: 'Exception Flagged',
  PENDING_COORDINATOR: 'Coordinator',
  PENDING_MANAGER: 'Purchasing Manager',
  PENDING_MLO_ACCOUNT_HOLDER: 'MLO Account Holder',
  PENDING_MLO_PLANNING_MANAGER: 'Planning Manager',
  PENDING_SR_MANAGER: 'Sr. Manager',
  PENDING_POLLY: 'Ms. Polly',
  PENDING_ACCOUNTING: 'Accounting',
  PAYMENT_SCHEDULED: 'Payment',
  PAID: 'Paid',
  POSTED_TO_QB: 'Posted to QB',
};

export default function SLAAnalyticsDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<SLAAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchSummary();
  }, [days]);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await slaAnalyticsApi.getSummary(days);
      setData(res.data);
    } catch (error) {
      console.error('Failed to fetch SLA analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExportAudit = async () => {
    setExporting(true);
    try {
      const res = await auditExportApi.exportCsv({ limit: 10000 });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit-log-export-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export audit logs:', error);
    } finally {
      setExporting(false);
    }
  };

  const formatHours = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    const d = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 animate-fade-in" style={{ background: 'var(--bg-base)' }}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: 'var(--accent-purple)' }} />
          <div className="h-10 w-10 rounded-full border-2 animate-spin" style={{ borderTopColor: 'var(--accent-purple)', borderRightColor: 'var(--accent-purple)', borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
        </div>
        <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading SLA analytics...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link to="/" style={{ color: 'var(--text-muted)' }}>
              <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
            </Link>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>SLA Analytics Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            {user && ['ACCOUNTING_SUPERVISOR', 'CFO', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role) && (
            <button
              onClick={handleExportAudit}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              {exporting ? 'Exporting...' : 'Export Audit Log'}
            </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KPICard
            label="Active Invoices"
            value={data?.total_active?.toString() || '0'}
            icon={Activity}
            color="var(--accent-blue)"
          />
          <KPICard
            label="Processed (30d)"
            value={data?.total_processed_30d?.toString() || '0'}
            icon={Clock}
            color="var(--accent-lime)"
          />
          <KPICard
            label="Avg Cycle Time"
            value={data ? formatHours(data.avg_cycle_time_hours) : 'N/A'}
            icon={TrendingDown}
            color="var(--accent-purple)"
          />
          <KPICard
            label="Currently Breaching"
            value={data?.sla_breaches?.currently_breached?.toString() || '0'}
            icon={AlertTriangle}
            color="var(--accent-red)"
          />
        </div>

        {/* SLA Breach Summary */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
          <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>SLA Breach Summary</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--accent-red)' }}>{data?.sla_breaches?.currently_breached || 0}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Currently Breached</div>
              </div>
              <div className="text-center p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--accent-amber)' }}>{data?.sla_breaches?.breached_today || 0}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Breached Today</div>
              </div>
              <div className="text-center p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--accent-amber)' }}>{data?.sla_breaches?.breached_this_week || 0}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Breached This Week</div>
              </div>
            </div>
            {data?.sla_breaches?.by_approver_role && data.sla_breaches.by_approver_role.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Breaches by Role</h3>
                <div className="space-y-2">
                  {data.sla_breaches.by_approver_role.map((item) => (
                    <div key={item.role} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{item.role}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)' }}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Cycle Time Per Stage */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
          <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Average Cycle Time Per Stage</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th className="text-left p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>STAGE</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>AVG TIME</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>MIN</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>MAX</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>COUNT</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>BREACHED</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>BREACH RATE</th>
                </tr>
              </thead>
              <tbody>
                {data?.cycle_times?.map((ct) => (
                  <tr key={ct.stage} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="p-3 text-sm" style={{ color: 'var(--text-primary)' }}>{stageLabels[ct.stage] || ct.stage}</td>
                    <td className="p-3 text-sm text-right font-medium" style={{ color: 'var(--text-primary)' }}>{formatHours(ct.avg_hours)}</td>
                    <td className="p-3 text-sm text-right" style={{ color: 'var(--text-secondary)' }}>{formatHours(ct.min_hours)}</td>
                    <td className="p-3 text-sm text-right" style={{ color: 'var(--text-secondary)' }}>{formatHours(ct.max_hours)}</td>
                    <td className="p-3 text-sm text-right" style={{ color: 'var(--text-secondary)' }}>{ct.count}</td>
                    <td className="p-3 text-sm text-right" style={{ color: ct.breached_count > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>{ct.breached_count}</td>
                    <td className="p-3 text-sm text-right">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{
                        background: ct.breach_rate > 20 ? 'color-mix(in srgb, var(--accent-red) 10%, transparent)' : ct.breach_rate > 5 ? 'color-mix(in srgb, var(--accent-amber) 10%, transparent)' : 'var(--bg-elevated)',
                        color: ct.breach_rate > 20 ? 'var(--accent-red)' : ct.breach_rate > 5 ? 'var(--accent-amber)' : 'var(--text-secondary)'
                      }}>{ct.breach_rate}%</span>
                    </td>
                  </tr>
                ))}
                {(!data?.cycle_times || data.cycle_times.length === 0) && (
                  <tr><td colSpan={7} className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No cycle time data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottleneck Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Bottleneck Analysis — Active Invoices by Stage</h2>
            </div>
            <div className="p-4 space-y-3">
              {data?.bottlenecks?.by_stage?.map((stage) => (
                <div key={stage.stage} className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{stageLabels[stage.stage] || stage.stage}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', color: 'var(--accent-purple)' }}>{stage.active_count} active</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>Avg wait: {formatHours(stage.avg_wait_hours)}</span>
                    <span>Max wait: {formatHours(stage.max_wait_hours)}</span>
                    {stage.breached_count > 0 && <span style={{ color: 'var(--accent-red)' }}>{stage.breached_count} breached</span>}
                  </div>
                </div>
              ))}
              {(!data?.bottlenecks?.by_stage || data.bottlenecks.by_stage.length === 0) && (
                <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No active bottlenecks</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Slowest Invoices (Longest Wait)</h2>
            </div>
            <div className="p-4 space-y-2">
              {data?.bottlenecks?.slowest_invoices?.map((inv) => (
                <div key={inv.invoice_id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{inv.invoice_number}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{inv.vendor_name} — {stageLabels[inv.stage] || inv.stage}</div>
                  </div>
                  <div className="text-right ml-3">
                    <div className="text-sm font-semibold" style={{ color: inv.elapsed_hours > 168 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{formatHours(inv.elapsed_hours)}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>${inv.amount.toFixed(2)}</div>
                  </div>
                </div>
              ))}
              {(!data?.bottlenecks?.slowest_invoices || data.bottlenecks.slowest_invoices.length === 0) && (
                <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No slow invoices</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <div className="rounded-lg p-1.5" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
          <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.75} />
        </div>
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
