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

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function Reports() {
  const { invoices } = useMockData();
  const [activeTab, setActiveTab] = useState<'kpi' | 'volume' | 'payments' | 'vendors' | 'exceptions' | 'activity'>('kpi');

  // Calculate KPI metrics from real invoice data
  const kpiMetrics: KPIMetrics = {
    total_invoices: invoices.length,
    pending_approvals: invoices.filter(i => i.status === 'PENDING_MANAGER' || i.status === 'PENDING_MLO_PLANNING_MANAGER' || i.status === 'PENDING_SR_MANAGER' || i.status === 'PENDING_POLLY').length,
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
        if (inv.status === 'PAID' || inv.status === 'APPROVED') existing.approved_invoices++;
        if (inv.status === 'REJECTED') existing.rejected_invoices++;
        if (['VALIDATION_PENDING', 'PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY'].includes(inv.status)) existing.pending_invoices++;
      } else {
        buckets.set(key, {
          date: key,
          total_invoices: 1,
          approved_invoices: ['PAID', 'APPROVED'].includes(inv.status) ? 1 : 0,
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
    { status: 'Pending', count: invoices.filter(i => i.status === 'PENDING_MANAGER' || i.status === 'PENDING_MLO_PLANNING_MANAGER' || i.status === 'PENDING_SR_MANAGER' || i.status === 'PENDING_POLLY').length, total_amount: invoices.filter(i => i.status === 'PENDING_MANAGER' || i.status === 'PENDING_MLO_PLANNING_MANAGER' || i.status === 'PENDING_SR_MANAGER' || i.status === 'PENDING_POLLY').reduce((sum, i) => sum + i.total_amount, 0) },
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
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
      {/* Layered Background Atmosphere */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* Purple orb top-right */}
        <div 
          style={{ 
            position: 'absolute', 
            top: '-10%', 
            right: '-5%', 
            width: '500px', 
            height: '500px',
            background: 'radial-gradient(circle, rgba(139,92,246,0.25), transparent 70%)',
            filter: 'blur(60px)', 
            animation: 'drift1 10s ease-in-out infinite alternate'
          }}
        />
        {/* Blue orb bottom-left */}
        <div 
          style={{ 
            position: 'absolute', 
            bottom: '-10%', 
            left: '-5%', 
            width: '600px', 
            height: '600px',
            background: 'radial-gradient(circle, rgba(59,130,246,0.2), transparent 70%)',
            filter: 'blur(80px)', 
            animation: 'drift2 13s ease-in-out infinite alternate'
          }}
        />
        {/* Teal orb center */}
        <div 
          style={{ 
            position: 'absolute', 
            top: '40%', 
            left: '35%', 
            width: '400px', 
            height: '400px',
            background: 'radial-gradient(circle, rgba(20,184,166,0.12), transparent 70%)',
            filter: 'blur(70px)', 
            animation: 'drift3 9s ease-in-out infinite alternate'
          }}
        />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto p-6">
        <header style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4 sticky top-0 -mx-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-slate-300 hover:text-white transition-colors">
                <ArrowLeft className="h-6 w-6" />
              </Link>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', boxShadow: '0 8px 32px rgba(59,130,246,0.3)' }}>
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
                <p className="text-xs text-slate-400">Comprehensive insights into your invoice processing performance</p>
              </div>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <div style={{ background: 'rgba(255, 255, 255, 0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-2 mb-6">
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
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'text-white shadow-md'
                    : 'text-slate-400 hover:bg-white/10'
                }`}
                style={activeTab === tab.id ? { background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)' } : {}}
              >
                <tab.icon className="h-5 w-5" />
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
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Invoice Volume Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={invoiceVolumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
                <Legend />
                <Bar dataKey="total_invoices" fill="#3b82f6" name="Total" radius={[4, 4, 0, 0]} />
                <Bar dataKey="approved_invoices" fill="#10b981" name="Approved" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rejected_invoices" fill="#f59e0b" name="Rejected" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending_invoices" fill="#ef4444" name="Pending" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Payment Status */}
        {activeTab === 'payments' && (
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Payment Batch Status</h2>
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
                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Vendor Spending */}
        {activeTab === 'vendors' && (
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Top 10 Vendors by Spending</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={vendorSpendingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="vendor_name" angle={-45} textAnchor="end" height={100} stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
                <Legend />
                <Bar dataKey="total_amount" fill="#3b82f6" name="Total Amount" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Exception Rate */}
        {activeTab === 'exceptions' && (
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Exception Rate Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={exceptionRateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
                <Legend />
                <Line type="monotone" dataKey="exception_rate" stroke="#ef4444" name="Exception Rate %" strokeWidth={3} dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent Activity */}
        {activeTab === 'activity' && (
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>
            {invoices && invoices.length > 0 ? (
              <div className="space-y-3">
                {invoices.slice(0, 10).map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between p-4 rounded-lg transition-colors hover:bg-white/5"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${
                        invoice.status === 'PAID' ? 'bg-green-500/20' :
                        invoice.status === 'EXCEPTION_FLAGGED' ? 'bg-red-500/20' :
                        invoice.status.includes('PENDING') ? 'bg-amber-500/20' :
                        'bg-blue-500/20'
                      }`}>
                        <FileText className="h-4 w-4 ${
                          invoice.status === 'PAID' ? 'text-green-400' :
                          invoice.status === 'EXCEPTION_FLAGGED' ? 'text-red-400' :
                          invoice.status.includes('PENDING') ? 'text-amber-400' :
                          'text-blue-400'
                        }" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{invoice.invoice_number}</p>
                        <p className="text-xs text-slate-400">{invoice.vendor_name || 'Unknown Vendor'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-white">${invoice.total_amount.toLocaleString()}</p>
                      <p className="text-xs text-slate-400">{invoice.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                <p className="text-sm text-slate-400">No recent activity</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ title, value, icon, color }: { title: string; value: string | number; icon: React.ReactNode; color: string }) {
  const colorClasses = {
    blue: 'bg-gradient-to-br from-blue-500 to-blue-600',
    green: 'bg-gradient-to-br from-green-500 to-green-600',
    yellow: 'bg-gradient-to-br from-yellow-500 to-yellow-600',
    red: 'bg-gradient-to-br from-red-500 to-red-600',
    purple: 'bg-gradient-to-br from-purple-500 to-purple-600',
  };

  return (
    <div className="group transition-all duration-300 overflow-hidden" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
      <div className="relative p-6">
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 opacity-30 group-hover:opacity-50 transition-opacity" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.15), transparent 70%)' }} />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-400 mb-1">{title}</p>
            <p className="text-3xl font-bold text-white">{value}</p>
          </div>
          <div className={`${colorClasses[color as keyof typeof colorClasses]} p-4 rounded-2xl shadow-lg group-hover:scale-110 transition-transform duration-300`}>
            {icon}
          </div>
        </div>
      </div>
      <div className="h-1" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)' }} />
    </div>
  );
}
