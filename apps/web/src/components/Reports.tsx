import { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, DollarSign, FileText, AlertTriangle, Clock, CheckCircle } from 'lucide-react';

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
  const [kpiMetrics, setKpiMetrics] = useState<KPIMetrics | null>(null);
  const [invoiceVolume, setInvoiceVolume] = useState<InvoiceVolumeData[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusData[]>([]);
  const [vendorSpending, setVendorSpending] = useState<VendorSpendingData[]>([]);
  const [exceptionRate, setExceptionRate] = useState<ExceptionRateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'kpi' | 'volume' | 'payments' | 'vendors' | 'exceptions'>('kpi');

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [kpiRes, volumeRes, paymentRes, vendorRes, exceptionRes] = await Promise.all([
        fetch('http://localhost:3001/api/reports/kpi'),
        fetch('http://localhost:3001/api/reports/invoice-volume?startDate=2024-01-01&endDate=2024-12-31'),
        fetch('http://localhost:3001/api/reports/payment-status'),
        fetch('http://localhost:3001/api/reports/vendor-spending?limit=10'),
        fetch('http://localhost:3001/api/reports/exception-rate?startDate=2024-01-01&endDate=2024-12-31'),
      ]);

      const [kpiData, volumeData, paymentData, vendorData, exceptionData] = await Promise.all([
        kpiRes.json(),
        volumeRes.json(),
        paymentRes.json(),
        vendorRes.json(),
        exceptionRes.json(),
      ]);

      setKpiMetrics(kpiData);
      setInvoiceVolume(volumeData);
      setPaymentStatus(paymentData);
      setVendorSpending(vendorData);
      setExceptionRate(exceptionData);
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading reports...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-2">Reports & Analytics</h1>
          <p className="text-gray-600">Comprehensive insights into your invoice processing performance</p>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-2 mb-6 border border-gray-200/50">
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
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
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
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200/50">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Invoice Volume Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={invoiceVolume}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip contentStyle={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }} />
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
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200/50">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Payment Batch Status</h2>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={paymentStatus}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ percent }) => `${(percent || 0 * 100).toFixed(0)}%`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {paymentStatus.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Vendor Spending */}
        {activeTab === 'vendors' && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200/50">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Top 10 Vendors by Spending</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={vendorSpending}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="vendor_name" angle={-45} textAnchor="end" height={100} stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip contentStyle={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }} />
                <Legend />
                <Bar dataKey="total_amount" fill="#3b82f6" name="Total Amount" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Exception Rate */}
        {activeTab === 'exceptions' && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200/50">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Exception Rate Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={exceptionRate}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip contentStyle={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }} />
                <Legend />
                <Line type="monotone" dataKey="exception_rate" stroke="#ef4444" name="Exception Rate %" strokeWidth={3} dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
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
    <div className="group bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200/50 hover:border-gray-300/50 overflow-hidden">
      <div className="relative p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-gray-50 to-transparent rounded-full -mr-16 -mt-16 opacity-50 group-hover:opacity-75 transition-opacity" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-600 mb-1">{title}</p>
            <p className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">{value}</p>
          </div>
          <div className={`${colorClasses[color as keyof typeof colorClasses]} p-4 rounded-2xl shadow-lg group-hover:scale-110 transition-transform duration-300`}>
            {icon}
          </div>
        </div>
      </div>
      <div className="h-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
    </div>
  );
}
