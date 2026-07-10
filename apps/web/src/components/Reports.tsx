import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, DollarSign, FileText, AlertTriangle, Clock, CheckCircle, ArrowLeft } from 'lucide-react';
import { useMockData } from '../contexts/MockDataContext';

interface KPIMetrics {
  total_invoices: number;
  pending_approvals: number;
  pending_exceptions: number;
  scheduled_payments: number;
  total_amount_pending: number;
  approval_rate: number;
  average_processing_time: number;
}

interface InvoiceVolumeData {
  date: string;
  total_invoices: number;
  approved_invoices: number;
  rejected_invoices: number;
  pending_invoices: number;
  total_amount: number;
}

interface PaymentStatusData {
  status: string;
  count: number;
  total_amount: number;
}

interface VendorSpendingData {
  vendor_id: string;
  vendor_name: string;
  total_invoices: number;
  total_amount: number;
  average_amount: number;
}

interface ExceptionRateData {
  date: string;
  total_invoices: number;
  invoices_with_exceptions: number;
  exception_rate: number;
}

const COLORS = ['#6C5CE7', '#C6FF3D', '#F59E0B', '#EF4444', '#3B82F6'];

export default function Reports() {
  const { invoices } = useMockData();
  const [activeTab, setActiveTab] = useState<'kpi' | 'volume' | 'payments' | 'vendors' | 'exceptions' | 'activity'>('kpi');

  // Calculate KPI metrics from real invoice data
  const kpiMetrics: KPIMetrics = {
    total_invoices: invoices.length,
    pending_approvals: invoices.filter(i => i.status === 'PENDING_MANAGER' || i.status === 'PENDING_MLO_ACCOUNT_HOLDER' || i.status === 'PENDING_MLO_PLANNING_MANAGER' || i.status === 'PENDING_SR_MANAGER' || i.status === 'PENDING_POLLY').length,
    pending_exceptions: invoices.filter(i => i.exceptions.length > 0).length,
    scheduled_payments: invoices.filter(i => i.status === 'PAYMENT_SCHEDULED').length,
    total_amount_pending: invoices.filter(i => i.status !== 'PAID').reduce((sum, i) => sum + i.total_amount, 0),
    approval_rate: invoices.length > 0 ? (invoices.filter(i => i.status === 'PAID').length / invoices.length) * 100 : 0,
    average_processing_time: invoices.length > 0
      ? Math.round(
          invoices
            .filter(i => i.stage_timestamps && i.stage_timestamps.length > 0)
            .reduce((sum, i) => {
              const first = new Date(i.stage_timestamps[0].entered_at).getTime();
              const last = i.stage_timestamps[i.stage_timestamps.length - 1].exited_at
                ? new Date(i.stage_timestamps[i.stage_timestamps.length - 1].exited_at!).getTime()
                : Date.now();
              return sum + (last - first) / (1000 * 60 * 60 * 24);
            }, 0) / invoices.filter(i => i.stage_timestamps && i.stage_timestamps.length > 0).length * 10
        ) / 10
      : 0,
  };

  // Calculate invoice volume data from real invoices, grouped by week
  const invoiceVolumeData: InvoiceVolumeData[] = (() => {
    const buckets = new Map<string, InvoiceVolumeData>();
    invoices.forEach(inv => {
      const date = new Date(inv.invoice_date || inv.created_at || Date.now());
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const key = weekStart.toISOString().split('T')[0];
      const existing = buckets.get(key);
      if (existing) {
        existing.total_invoices++;
        existing.total_amount += inv.total_amount;
        if (['PAID', 'APPROVED', 'PENDING_ACCOUNTING', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED'].includes(inv.status)) existing.approved_invoices++;
        if (inv.status === 'REJECTED') existing.rejected_invoices++;
        if (['VALIDATION_PENDING', 'PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY'].includes(inv.status)) existing.pending_invoices++;
      } else {
        buckets.set(key, {
          date: key,
          total_invoices: 1,
          approved_invoices: ['PAID', 'APPROVED', 'PENDING_ACCOUNTING', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED'].includes(inv.status) ? 1 : 0,
          rejected_invoices: inv.status === 'REJECTED' ? 1 : 0,
          pending_invoices: ['VALIDATION_PENDING', 'PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY'].includes(inv.status) ? 1 : 0,
          total_amount: inv.total_amount,
        });
      }
    });
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  })();

  // Calculate payment status data from real invoice data
  const paymentStatusData: PaymentStatusData[] = [
    { status: 'Paid', count: invoices.filter(i => i.status === 'PAID').length, total_amount: invoices.filter(i => i.status === 'PAID').reduce((sum, i) => sum + i.total_amount, 0) },
    { status: 'Pending', count: invoices.filter(i => i.status === 'PENDING_MANAGER' || i.status === 'PENDING_MLO_ACCOUNT_HOLDER' || i.status === 'PENDING_MLO_PLANNING_MANAGER' || i.status === 'PENDING_SR_MANAGER' || i.status === 'PENDING_POLLY').length, total_amount: invoices.filter(i => i.status === 'PENDING_MANAGER' || i.status === 'PENDING_MLO_ACCOUNT_HOLDER' || i.status === 'PENDING_MLO_PLANNING_MANAGER' || i.status === 'PENDING_SR_MANAGER' || i.status === 'PENDING_POLLY').reduce((sum, i) => sum + i.total_amount, 0) },
    { status: 'Scheduled', count: invoices.filter(i => i.status === 'PAYMENT_SCHEDULED').length, total_amount: invoices.filter(i => i.status === 'PAYMENT_SCHEDULED').reduce((sum, i) => sum + i.total_amount, 0) },
  ];

  // Calculate vendor spending data from real invoice data
  const vendorSpendingData: VendorSpendingData[] = invoices.reduce((acc: VendorSpendingData[], invoice) => {
    const existing = acc.find(v => v.vendor_name === invoice.vendor_name);
    if (existing) {
      existing.total_invoices++;
      existing.total_amount += invoice.total_amount;
      existing.average_amount = existing.total_amount / existing.total_invoices;
    } else {
      acc.push({
        vendor_id: invoice.vendor_id,
        vendor_name: invoice.vendor_name,
        total_invoices: 1,
        total_amount: invoice.total_amount,
        average_amount: invoice.total_amount,
      });
    }
    return acc;
  }, []).slice(0, 10);

  // Calculate exception rate data from real invoices, grouped by week
  const exceptionRateData: ExceptionRateData[] = (() => {
    const buckets = new Map<string, { date: string; total_invoices: number; invoices_with_exceptions: number }>();
    invoices.forEach(inv => {
      const date = new Date(inv.invoice_date || inv.created_at || Date.now());
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const key = weekStart.toISOString().split('T')[0];
      const existing = buckets.get(key);
      const hasExceptions = (inv.exceptions && inv.exceptions.length > 0) || inv.status === 'EXCEPTION_FLAGGED';
      if (existing) {
        existing.total_invoices++;
        if (hasExceptions) existing.invoices_with_exceptions++;
      } else {
        buckets.set(key, {
          date: key,
          total_invoices: 1,
          invoices_with_exceptions: hasExceptions ? 1 : 0,
        });
      }
    });
    return Array.from(buckets.values())
      .map(b => ({
        ...b,
        exception_rate: b.total_invoices > 0 ? Math.round((b.invoices_with_exceptions / b.total_invoices) * 1000) / 10 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-12);
  })();

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10 max-w-7xl mx-auto p-6">
        <header className="px-6 py-4 -mx-6 mb-8" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="transition-colors" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
              </Link>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}>
                <TrendingUp className="h-5 w-5 text-white" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Reports & Analytics</h1>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Comprehensive insights into your invoice processing performance</p>
              </div>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="p-2 mb-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
          <div className="flex space-x-2">
            {[
              { id: 'kpi', label: 'KPI Dashboard', icon: TrendingUp },
              { id: 'volume', label: 'Invoice Volume', icon: FileText },
              { id: 'payments', label: 'Payment Status', icon: DollarSign },
              { id: 'vendors', label: 'Vendor Spending', icon: TrendingUp },
              { id: 'exceptions', label: 'Exception Rate', icon: AlertTriangle },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all duration-200"
                style={activeTab === tab.id
                  ? { background: 'var(--accent-purple)', color: '#fff', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 20%, transparent)' }
                  : { color: 'var(--text-muted)' }
                }
                onMouseEnter={(e) => { if (activeTab !== tab.id) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                onMouseLeave={(e) => { if (activeTab !== tab.id) { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-muted)'; } }}
              >
                <tab.icon className="h-5 w-5" strokeWidth={1.75} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Dashboard */}
        {activeTab === 'kpi' && kpiMetrics && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <KPICard
                title="Total Invoices"
                value={kpiMetrics.total_invoices}
                icon={<FileText className="h-6 w-6" />}
                color="blue"
              />
              <KPICard
                title="Pending Approvals"
                value={kpiMetrics.pending_approvals}
                icon={<Clock className="h-6 w-6" />}
                color="yellow"
              />
              <KPICard
                title="Pending Exceptions"
                value={kpiMetrics.pending_exceptions}
                icon={<AlertTriangle className="h-6 w-6" />}
                color="red"
              />
              <KPICard
                title="Scheduled Payments"
                value={kpiMetrics.scheduled_payments}
                icon={<DollarSign className="h-6 w-6" />}
                color="green"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <KPICard
                title="Total Amount Pending"
                value={`$${kpiMetrics.total_amount_pending.toLocaleString()}`}
                icon={<DollarSign className="h-6 w-6" />}
                color="purple"
              />
              <KPICard
                title="Approval Rate"
                value={`${kpiMetrics.approval_rate.toFixed(1)}%`}
                icon={<CheckCircle className="h-6 w-6" />}
                color="green"
              />
              <KPICard
                title="Avg Processing Time"
                value={`${kpiMetrics.average_processing_time.toFixed(1)} days`}
                icon={<TrendingUp className="h-6 w-6" />}
                color="blue"
              />
            </div>
          </div>
        )}

        {/* Invoice Volume */}
        {activeTab === 'volume' && (
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Invoice Volume Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={invoiceVolumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                <Bar dataKey="total_invoices" fill="#6C5CE7" name="Total" radius={[4, 4, 0, 0]} />
                <Bar dataKey="approved_invoices" fill="#C6FF3D" name="Approved" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rejected_invoices" fill="#F59E0B" name="Rejected" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending_invoices" fill="#EF4444" name="Pending" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Payment Status */}
        {activeTab === 'payments' && (
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Payment Batch Status</h2>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={paymentStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ percent }) => `${(percent || 0 * 100).toFixed(0)}%`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {paymentStatusData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Vendor Spending */}
        {activeTab === 'vendors' && (
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Top 10 Vendors by Spending</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={vendorSpendingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="vendor_name" angle={-45} textAnchor="end" height={100} stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                <Bar dataKey="total_amount" fill="#6C5CE7" name="Total Amount" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Exception Rate */}
        {activeTab === 'exceptions' && (
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Exception Rate Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={exceptionRateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                <Line type="monotone" dataKey="exception_rate" stroke="#EF4444" name="Exception Rate %" strokeWidth={3} dot={{ fill: '#EF4444', strokeWidth: 2, r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent Activity */}
        {activeTab === 'activity' && (
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Recent Activity</h2>
            {invoices && invoices.length > 0 ? (
              <div className="space-y-3">
                {invoices.slice(0, 10).map((invoice) => {
                  const activityStyle: React.CSSProperties = invoice.status === 'PAID'
                    ? { background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }
                    : invoice.status === 'EXCEPTION_FLAGGED'
                    ? { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }
                    : invoice.status.includes('PENDING')
                    ? { background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }
                    : { background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' };
                  const iconColor = invoice.status === 'PAID' ? 'var(--accent-green)' :
                    invoice.status === 'EXCEPTION_FLAGGED' ? 'var(--accent-red)' :
                    invoice.status.includes('PENDING') ? 'var(--accent-amber)' : 'var(--accent-purple)';
                  return (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between p-4 rounded-xl transition-colors"
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg" style={activityStyle}>
                        <FileText className="h-4 w-4" style={{ color: iconColor }} strokeWidth={1.75} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{invoice.invoice_number}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{invoice.vendor_name || 'Unknown Vendor'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${invoice.total_amount.toLocaleString()}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{invoice.status}</p>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="inline-flex p-4 rounded-2xl mb-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <FileText className="h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No recent activity</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ title, value, icon, color }: { title: string; value: string | number; icon: React.ReactNode; color: string }) {
  const colorStyles: Record<string, React.CSSProperties> = {
    blue: { background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)', color: 'var(--accent-purple)' },
    green: { background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)', color: 'var(--accent-green)' },
    yellow: { background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)', color: 'var(--accent-amber)' },
    red: { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)', color: 'var(--accent-red)' },
    purple: { background: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-violet) 20%, transparent)', color: 'var(--accent-violet)' },
  };

  return (
    <div className="rounded-2xl overflow-hidden transition-all duration-300" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-color-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
    >
      <div className="relative p-6">
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>{title}</p>
            <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
          </div>
          <div className="p-4 rounded-2xl" style={colorStyles[color] || colorStyles.blue}>
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}
