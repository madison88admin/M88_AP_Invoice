import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Pause, AlertTriangle, Clock, Download } from 'lucide-react';
import { onHoldQueueApi } from '../lib/api';

interface HoldQueueItem {
  id: string;
  invoice_number: string;
  vendor_name: string;
  vendor_id: string;
  amount: number;
  currency: string;
  status: string;
  hold_duration_hours: number;
  hold_reasons: Array<{ reason: string; detail: string; created_at: string }>;
  invoice_date: string;
  invoice_received_date: string;
  is_urgent: boolean;
  priority_pay_date: string;
}

interface HoldQueueSummary {
  total: number;
  on_hold: number;
  exception_flagged: number;
  urgent: number;
  total_amount: number;
  avg_hold_hours: number;
  oldest_hold_hours: number;
}

interface HoldQueueResponse {
  items: HoldQueueItem[];
  summary: HoldQueueSummary;
}

const reasonLabels: Record<string, string> = {
  BATCH_THRESHOLD_NOT_MET: 'Batch Threshold Not Met',
  DUPLICATE_INVOICE: 'Duplicate Invoice',
  MISSING_BANK_INFO: 'Missing Bank Info',
  AMOUNT_VARIANCE: 'Amount Variance',
  PO_NOT_FOUND: 'PO Not Found',
  LOW_OCR_CONFIDENCE: 'Low OCR Confidence',
  MISSING_SIGNATURES: 'Missing Signatures',
  LATE_SUBMISSION: 'Late Submission',
  GL_MAPPING_UNKNOWN: 'GL Mapping Unknown',
  HANDWRITTEN_DOCUMENT: 'Handwritten Document',
};

export default function OnHoldQueue() {
  const [data, setData] = useState<HoldQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('ALL');

  useEffect(() => {
    fetchQueue();
  }, [filter]);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await onHoldQueueApi.getAll(filter !== 'ALL' ? filter : undefined);
      setData(res.data);
    } catch (error) {
      console.error('Failed to fetch on-hold queue:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatHours = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    const d = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
  };

  const getHoldSeverity = (hours: number) => {
    if (hours > 168) return { color: 'var(--accent-red)', label: 'Critical' };
    if (hours > 72) return { color: 'var(--accent-amber)', label: 'Warning' };
    return { color: 'var(--text-muted)', label: 'Normal' };
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 animate-fade-in" style={{ background: 'var(--bg-base)' }}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: 'var(--accent-amber)' }} />
          <div className="h-10 w-10 rounded-full border-2 animate-spin" style={{ borderTopColor: 'var(--accent-amber)', borderRightColor: 'var(--accent-amber)', borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
        </div>
        <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading on-hold queue...</p>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {summary?.total || 0} invoices on hold
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryCard label="Total On Hold" value={summary?.total?.toString() || '0'} icon={Pause} color="var(--accent-amber)" />
          <SummaryCard label="On Hold" value={summary?.on_hold?.toString() || '0'} icon={Clock} color="var(--accent-amber)" />
          <SummaryCard label="Exception Flagged" value={summary?.exception_flagged?.toString() || '0'} icon={AlertTriangle} color="var(--accent-red)" />
          <SummaryCard label="Total Amount" value={formatCurrency(summary?.total_amount || 0, 'USD')} icon={AlertTriangle} color="var(--accent-purple)" />
          <SummaryCard label="Oldest Hold" value={summary ? formatHours(summary.oldest_hold_hours) : 'N/A'} icon={Clock} color="var(--accent-red)" />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          {[
            { key: 'ALL', label: 'All' },
            { key: 'ON_HOLD', label: 'On Hold' },
            { key: 'EXCEPTION_FLAGGED', label: 'Exception Flagged' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={filter === tab.key
                ? { background: 'var(--accent-purple)', color: '#fff' }
                : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Queue Table */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th className="text-left p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>INVOICE</th>
                  <th className="text-left p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>VENDOR</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>AMOUNT</th>
                  <th className="text-left p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>STATUS</th>
                  <th className="text-left p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>HOLD REASON</th>
                  <th className="text-right p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>HOLD DURATION</th>
                  <th className="text-center p-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>URGENT</th>
                </tr>
              </thead>
              <tbody>
                {data?.items?.map((item) => {
                  const severity = getHoldSeverity(item.hold_duration_hours);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="p-3">
                        <Link to={`/approvals`} className="text-sm font-medium hover:underline" style={{ color: 'var(--accent-blue)' }}>
                          {item.invoice_number}
                        </Link>
                      </td>
                      <td className="p-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{item.vendor_name}</td>
                      <td className="p-3 text-sm text-right font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(item.amount, item.currency)}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{
                          background: item.status === 'EXCEPTION_FLAGGED'
                            ? 'color-mix(in srgb, var(--accent-red) 10%, transparent)'
                            : 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
                          color: item.status === 'EXCEPTION_FLAGGED' ? 'var(--accent-red)' : 'var(--accent-amber)'
                        }}>
                          {item.status === 'EXCEPTION_FLAGGED' ? 'Exception' : 'On Hold'}
                        </span>
                      </td>
                      <td className="p-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {item.hold_reasons.length > 0
                          ? item.hold_reasons.map(r => reasonLabels[r.reason] || r.reason).join(', ')
                          : '—'}
                      </td>
                      <td className="p-3 text-sm text-right" style={{ color: severity.color }}>
                        {formatHours(item.hold_duration_hours)}
                        <span className="ml-1 text-xs" style={{ color: severity.color }}>{severity.label}</span>
                      </td>
                      <td className="p-3 text-center">
                        {item.is_urgent && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)' }}>
                            URGENT
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(!data?.items || data.items.length === 0) && (
                  <tr><td colSpan={7} className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No invoices on hold</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <div className="rounded-lg p-1.5" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
          <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.75} />
        </div>
      </div>
      <div className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
