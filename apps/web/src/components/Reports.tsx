import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, DollarSign, FileText, AlertTriangle, Clock, CheckCircle, Calendar, Download, Package, FileSpreadsheet, Filter } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { reportApi } from '../lib/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface KPIMetrics {
  total_invoices: number;
  pending_approvals: number;
  pending_exceptions: number;
  scheduled_payments: number;
  total_amount_pending: number;
  approval_rate: number;
  average_processing_time: number;
  posted_to_qb?: number;
  paid_invoices?: number;
  on_hold_invoices?: number;
  rejected_invoices?: number;
  total_approved_amount?: number;
  total_posted_amount?: number;
  total_paid_amount?: number;
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

const COLORS = ['#6C5CE7', '#C6FF3D', '#F59E0B', '#EF4444', '#3B82F6', '#10B981'];

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function monthLabel(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Reports() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'ACCOUNTING_SUPERVISOR';
  const [activeTab, setActiveTab] = useState<'kpi' | 'volume' | 'payments' | 'weekly' | 'vendors' | 'exceptions' | 'operational'>('kpi');
  const [operational, setOperational] = useState<any>(null);
  const [operationalLoading, setOperationalLoading] = useState(false);

  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [brandFilter, setBrandFilter] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [kpiData, setKpiData] = useState<KPIMetrics | null>(null);
  const [volumeData, setVolumeData] = useState<InvoiceVolumeData[]>([]);
  const [paymentData, setPaymentData] = useState<PaymentStatusData[]>([]);
  const [vendorData, setVendorData] = useState<VendorSpendingData[]>([]);
  const [exceptionData, setExceptionData] = useState<ExceptionRateData[]>([]);

  useEffect(() => {
    reportApi.getBrands().then(res => setBrands(res.data || [])).catch(() => {});
  }, []);

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { startDate, endDate };
      if (brandFilter) params.brand = brandFilter;

      if (activeTab === 'kpi') {
        const res = await reportApi.getKPI(params);
        setKpiData(res.data);
      } else if (activeTab === 'volume') {
        const res = await reportApi.getInvoiceVolume(params);
        setVolumeData(res.data || []);
      } else if (activeTab === 'payments') {
        const res = await reportApi.getPaymentStatus(params);
        setPaymentData(res.data || []);
      } else if (activeTab === 'vendors') {
        const res = await reportApi.getVendorSpending({ ...params, limit: 20 });
        setVendorData(res.data || []);
      } else if (activeTab === 'exceptions') {
        const res = await reportApi.getExceptionRate(params);
        setExceptionData(res.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch report data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, startDate, endDate, brandFilter]);

  useEffect(() => {
    if (activeTab !== 'operational') {
      fetchReportData();
    }
  }, [fetchReportData, activeTab]);

  useEffect(() => {
    if (activeTab !== 'operational' || operational) return;
    setOperationalLoading(true);
    reportApi.getOperational()
      .then((res) => setOperational(res.data))
      .catch(() => setOperational(null))
      .finally(() => setOperationalLoading(false));
  }, [activeTab, operational]);

  const setMonthPreset = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setStartDate(formatDate(start));
    setEndDate(formatDate(end));
  };

  const exportToPDF = (title: string, headers: string[], rows: (string | number)[][]) => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const filterInfo = `Date: ${startDate} to ${endDate}${brandFilter ? ` | Brand: ${brandFilter}` : ''}`;
    doc.setFontSize(16);
    doc.text(title, 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(filterInfo, 14, 28);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);
    autoTable(doc, {
      head: [headers],
      body: rows.map(r => r.map(c => String(c))),
      startY: 40,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [108, 92, 231], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 245, 250] },
    });
    doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${formatDate(new Date())}.pdf`);
  };

  const exportToExcel = (title: string, headers: string[], rows: (string | number)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31));
    XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '-')}-${formatDate(new Date())}.xlsx`);
  };

  const handleExportKPI = (format: 'pdf' | 'excel') => {
    if (!kpiData) return;
    const headers = ['Metric', 'Value'];
    const rows: (string | number)[][] = [
      ['Total Invoices', kpiData.total_invoices],
      ['Pending Approvals', kpiData.pending_approvals],
      ['Pending Exceptions', kpiData.pending_exceptions],
      ['Scheduled Payments', kpiData.scheduled_payments],
      ['Total Amount Pending', `$${kpiData.total_amount_pending.toLocaleString()}`],
      ['Approval Rate', `${kpiData.approval_rate.toFixed(1)}%`],
      ['Avg Processing Time', `${kpiData.average_processing_time.toFixed(1)} days`],
      ['Posted to QB', kpiData.posted_to_qb || 0],
      ['Paid Invoices', kpiData.paid_invoices || 0],
      ['On Hold', kpiData.on_hold_invoices || 0],
      ['Rejected', kpiData.rejected_invoices || 0],
      ['Total Approved Amount', `$${(kpiData.total_approved_amount || 0).toLocaleString()}`],
      ['Total Posted Amount', `$${(kpiData.total_posted_amount || 0).toLocaleString()}`],
      ['Total Paid Amount', `$${(kpiData.total_paid_amount || 0).toLocaleString()}`],
    ];
    if (format === 'pdf') exportToPDF('KPI Dashboard', headers, rows);
    else exportToExcel('KPI Dashboard', headers, rows);
  };

  const handleExportVolume = (format: 'pdf' | 'excel') => {
    const headers = ['Date', 'Total', 'Approved', 'Rejected', 'Pending', 'Total Amount'];
    const rows = volumeData.map(d => [d.date, d.total_invoices, d.approved_invoices, d.rejected_invoices, d.pending_invoices, `$${d.total_amount.toFixed(2)}`]);
    if (format === 'pdf') exportToPDF('Invoice Volume Report', headers, rows);
    else exportToExcel('Invoice Volume Report', headers, rows);
  };

  const handleExportPayment = (format: 'pdf' | 'excel') => {
    const headers = ['Status', 'Count', 'Total Amount'];
    const rows = paymentData.map(d => [d.status, d.count, `$${d.total_amount.toFixed(2)}`]);
    if (format === 'pdf') exportToPDF('Payment Status Report', headers, rows);
    else exportToExcel('Payment Status Report', headers, rows);
  };

  const handleExportVendor = (format: 'pdf' | 'excel') => {
    const headers = ['Vendor', 'Total Invoices', 'Total Amount', 'Average Amount'];
    const rows = vendorData.map(d => [d.vendor_name, d.total_invoices, `$${d.total_amount.toFixed(2)}`, `$${d.average_amount.toFixed(2)}`]);
    if (format === 'pdf') exportToPDF('Vendor Spending Report', headers, rows);
    else exportToExcel('Vendor Spending Report', headers, rows);
  };

  const handleExportException = (format: 'pdf' | 'excel') => {
    const headers = ['Date', 'Total Invoices', 'With Exceptions', 'Exception Rate %'];
    const rows = exceptionData.map(d => [d.date, d.total_invoices, d.invoices_with_exceptions, d.exception_rate.toFixed(1)]);
    if (format === 'pdf') exportToPDF('Exception Rate Report', headers, rows);
    else exportToExcel('Exception Rate Report', headers, rows);
  };

  const handleExportOperational = (format: 'pdf' | 'excel') => {
    if (!operational) return;
    const headers = ['Section', 'Detail', 'Value'];
    const rows: (string | number)[][] = [];
    (operational.ap_aging || []).forEach((r: any) => rows.push(['AP Aging', r.bucket, `$${Number(r.total_amount || 0).toLocaleString()}`]));
    (operational.pending_by_approver || []).forEach((r: any) => rows.push(['Pending Approver', `${r.approver_role} (${r.status})`, `${r.count} invoices`]));
    (operational.pending_by_vendor || []).slice(0, 20).forEach((r: any) => rows.push(['Pending Vendor', r.vendor_name, `${r.count} / $${Number(r.total_amount || 0).toLocaleString()}`]));
    (operational.paid_invoices || []).slice(0, 20).forEach((r: any) => rows.push(['Paid', `${r.invoice_number} - ${r.vendor_name}`, `$${Number(r.amount || 0).toLocaleString()}`]));
    (operational.rejected_invoices || []).slice(0, 20).forEach((r: any) => rows.push(['Rejected', `${r.invoice_number} - ${r.vendor_name}`, `$${Number(r.amount || 0).toLocaleString()}`]));
    if (format === 'pdf') exportToPDF('Operational Report', headers, rows);
    else exportToExcel('Operational Report', headers, rows);
  };

  const FilterBar = ({ showExport, onExportPDF, onExportExcel }: { showExport?: boolean; onExportPDF?: () => void; onExportExcel?: () => void }) => (
    <div className="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Filters:</span>
      </div>
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
        <span style={{ color: 'var(--text-muted)' }}>—</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
      </div>
      <div className="flex items-center gap-1">
        {[
          { label: '1M', months: 1 },
          { label: '3M', months: 3 },
          { label: '6M', months: 6 },
          { label: '1Y', months: 12 },
        ].map(preset => (
          <button key={preset.label} onClick={() => setMonthPreset(preset.months)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}>
            {preset.label}
          </button>
        ))}
      </div>
      <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
        className="px-3 py-1.5 rounded-lg text-sm"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
        <option value="">All Brands</option>
        {brands.map(b => <option key={b} value={b}>{b}</option>)}
      </select>
      {loading && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</span>}
      {showExport && onExportPDF && onExportExcel && (
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={onExportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
            <Download className="h-4 w-4" strokeWidth={1.75} /> PDF
          </button>
          <button onClick={onExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
            <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} /> Excel
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <div className="p-2 mb-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
        <div className="flex space-x-2 flex-wrap">
          {[
            { id: 'kpi', label: 'KPI Dashboard', icon: TrendingUp },
            { id: 'volume', label: 'Invoice Volume', icon: FileText },
            { id: 'payments', label: 'Payment Status', icon: DollarSign },
            { id: 'operational', label: 'Operational', icon: Package },
            ...(isSupervisor ? [{ id: 'weekly', label: 'Weekly Payments', icon: Calendar }] : []),
            { id: 'vendors', label: 'Vendor Spending', icon: TrendingUp },
            { id: 'exceptions', label: 'Exception Rate', icon: AlertTriangle },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all duration-200"
              style={activeTab === tab.id ? { background: 'var(--accent-purple)', color: '#fff', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 20%, transparent)' } : { color: 'var(--text-muted)' }}
              onMouseEnter={e => { if (activeTab !== tab.id) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
              onMouseLeave={e => { if (activeTab !== tab.id) { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-muted)'; } }}>
              <tab.icon className="h-5 w-5" strokeWidth={1.75} /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'kpi' && (
        <div className="space-y-6">
          <FilterBar showExport onExportPDF={() => handleExportKPI('pdf')} onExportExcel={() => handleExportKPI('excel')} />
          {kpiData && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard title="Total Invoices" value={kpiData.total_invoices} icon={<FileText className="h-6 w-6" />} color="blue" />
                <KPICard title="Pending Approvals" value={kpiData.pending_approvals} icon={<Clock className="h-6 w-6" />} color="yellow" />
                <KPICard title="Pending Exceptions" value={kpiData.pending_exceptions} icon={<AlertTriangle className="h-6 w-6" />} color="red" />
                <KPICard title="Scheduled Payments" value={kpiData.scheduled_payments} icon={<DollarSign className="h-6 w-6" />} color="green" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <KPICard title="Total Amount Pending" value={`$${kpiData.total_amount_pending.toLocaleString()}`} icon={<DollarSign className="h-6 w-6" />} color="purple" />
                <KPICard title="Approval Rate" value={`${kpiData.approval_rate.toFixed(1)}%`} icon={<CheckCircle className="h-6 w-6" />} color="green" />
                <KPICard title="Avg Processing Time" value={`${kpiData.average_processing_time.toFixed(1)} days`} icon={<TrendingUp className="h-6 w-6" />} color="blue" />
              </div>
              {(kpiData.posted_to_qb !== undefined || kpiData.paid_invoices !== undefined) && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {kpiData.posted_to_qb !== undefined && <KPICard title="Posted to QB" value={kpiData.posted_to_qb} icon={<FileText className="h-6 w-6" />} color="purple" />}
                  {kpiData.paid_invoices !== undefined && <KPICard title="Paid Invoices" value={kpiData.paid_invoices} icon={<CheckCircle className="h-6 w-6" />} color="green" />}
                  {kpiData.on_hold_invoices !== undefined && <KPICard title="On Hold" value={kpiData.on_hold_invoices} icon={<Clock className="h-6 w-6" />} color="yellow" />}
                  {kpiData.rejected_invoices !== undefined && <KPICard title="Rejected" value={kpiData.rejected_invoices} icon={<AlertTriangle className="h-6 w-6" />} color="red" />}
                </div>
              )}
              {(kpiData.total_approved_amount || kpiData.total_posted_amount || kpiData.total_paid_amount) && (
                <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
                  <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Amount Breakdown</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <AmountBreakdown label="Approved Amount" amount={kpiData.total_approved_amount || 0} color="var(--accent-green)" />
                    <AmountBreakdown label="Posted Amount" amount={kpiData.total_posted_amount || 0} color="var(--accent-purple)" />
                    <AmountBreakdown label="Paid Amount" amount={kpiData.total_paid_amount || 0} color="var(--accent-green)" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'volume' && (
        <div className="space-y-6">
          <FilterBar showExport onExportPDF={() => handleExportVolume('pdf')} onExportExcel={() => handleExportVolume('excel')} />
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Invoice Volume Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" tickFormatter={monthLabel} fontSize={11} />
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
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Daily Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {['Date', 'Total', 'Approved', 'Rejected', 'Pending', 'Amount'].map(h => <th key={h} className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {volumeData.length > 0 ? volumeData.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-primary)' }}>{d.date}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--accent-purple)' }}>{d.total_invoices}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--accent-green)' }}>{d.approved_invoices}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--accent-amber)' }}>{d.rejected_invoices}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--accent-red)' }}>{d.pending_invoices}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${d.total_amount.toLocaleString()}</td>
                    </tr>
                  )) : <tr><td colSpan={6} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No data available</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="space-y-6">
          <FilterBar showExport onExportPDF={() => handleExportPayment('pdf')} onExportExcel={() => handleExportPayment('excel')} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
              <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Payment Status Distribution</h2>
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie data={paymentData} cx="50%" cy="50%" labelLine={false} label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`} outerRadius={120} fill="#8884d8" dataKey="count">
                    {paymentData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
              <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Status Breakdown</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th className="text-left py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Status</th>
                    <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Count</th>
                    <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Total Amount</th>
                  </tr></thead>
                  <tbody>
                    {paymentData.length > 0 ? paymentData.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="py-3 px-4" style={{ color: 'var(--text-primary)' }}>{d.status}</td>
                        <td className="py-3 px-4 text-right" style={{ color: 'var(--text-secondary)' }}>{d.count}</td>
                        <td className="py-3 px-4 text-right" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${d.total_amount.toLocaleString()}</td>
                      </tr>
                    )) : <tr><td colSpan={3} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No data available</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'operational' && (
        <div className="space-y-6">
          <FilterBar showExport onExportPDF={() => handleExportOperational('pdf')} onExportExcel={() => handleExportOperational('excel')} />
          {operationalLoading ? (
            <div className="p-8 text-center rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)' }}>Loading operational reports...</div>
          ) : operational ? (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ReportTable title="AP Aging" rows={operational.ap_aging || []} columns={[['bucket', 'Bucket'], ['count', 'Invoices'], ['total_amount', 'Amount', 'money']]} />
                <ReportTable title="Pending by Approver" rows={operational.pending_by_approver || []} columns={[['approver_role', 'Approver'], ['status', 'Status'], ['count', 'Invoices'], ['total_amount', 'Amount', 'money']]} />
              </div>
              <ReportTable title="Pending by Vendor" rows={(operational.pending_by_vendor || []).slice(0, 20)} columns={[['vendor_name', 'Vendor'], ['count', 'Invoices'], ['total_amount', 'Amount', 'money'], ['oldest_due_date', 'Oldest Due', 'date']]} />
              <ReportTable title="Paid Invoices" rows={(operational.paid_invoices || []).slice(0, 20)} columns={[['invoice_number', 'Invoice'], ['vendor_name', 'Vendor'], ['amount', 'Amount', 'money'], ['paid_at', 'Paid Date', 'date'], ['reference', 'Reference'], ['bank_used', 'Bank']]} />
              <ReportTable title="Rejected Invoices" rows={(operational.rejected_invoices || []).slice(0, 20)} columns={[['invoice_number', 'Invoice'], ['vendor_name', 'Vendor'], ['amount', 'Amount', 'money'], ['reason', 'Reason'], ['updated_at', 'Updated', 'date']]} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ReportTable title="Duplicate / Proforma Tracking" rows={(operational.duplicate_proforma_tracking || []).slice(0, 20)} columns={[['invoice_number', 'Invoice'], ['vendor_name', 'Vendor'], ['invoice_type', 'Type'], ['status', 'Status'], ['parent_invoice_number', 'Parent'], ['child_count', 'Children']]} />
                <ReportTable title="Vendor Extraction Rules" rows={(operational.vendor_template_rules || []).slice(0, 20)} columns={[['vendor_name', 'Vendor'], ['invoice_template_type', 'Template'], ['use_count', 'Uses'], ['updated_at', 'Updated', 'date']]} />
              </div>
            </>
          ) : (
            <div className="p-8 text-center rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)' }}>Operational report is not available.</div>
          )}
        </div>
      )}

      {activeTab === 'vendors' && (
        <div className="space-y-6">
          <FilterBar showExport onExportPDF={() => handleExportVendor('pdf')} onExportExcel={() => handleExportVendor('excel')} />
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Top Vendors by Spending</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={vendorData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="vendor_name" angle={-45} textAnchor="end" height={100} stroke="var(--text-muted)" fontSize={11} />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                <Bar dataKey="total_amount" fill="#6C5CE7" name="Total Amount" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Vendor Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th className="text-left py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Vendor</th>
                  <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Invoices</th>
                  <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Total Amount</th>
                  <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Average</th>
                </tr></thead>
                <tbody>
                  {vendorData.length > 0 ? vendorData.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-3 px-4" style={{ color: 'var(--text-primary)' }}>{d.vendor_name}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-secondary)' }}>{d.total_invoices}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${d.total_amount.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>${d.average_amount.toFixed(2)}</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No data available</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'exceptions' && (
        <div className="space-y-6">
          <FilterBar showExport onExportPDF={() => handleExportException('pdf')} onExportExcel={() => handleExportException('excel')} />
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Exception Rate Over Time</h2>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={exceptionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" tickFormatter={monthLabel} fontSize={11} />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Legend wrapperStyle={{ color: 'var(--text-secondary)' }} />
                <Line type="monotone" dataKey="exception_rate" stroke="#EF4444" name="Exception Rate %" strokeWidth={3} dot={{ fill: '#EF4444', strokeWidth: 2, r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Exception Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th className="text-left py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Total</th>
                  <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>With Exceptions</th>
                  <th className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-secondary)' }}>Rate %</th>
                </tr></thead>
                <tbody>
                  {exceptionData.length > 0 ? exceptionData.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-3 px-4" style={{ color: 'var(--text-primary)' }}>{d.date}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-secondary)' }}>{d.total_invoices}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--accent-red)' }}>{d.invoices_with_exceptions}</td>
                      <td className="py-3 px-4 text-right" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{d.exception_rate.toFixed(1)}%</td>
                    </tr>
                  )) : <tr><td colSpan={4} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>No data available</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AmountBreakdown({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color, fontVariantNumeric: 'tabular-nums' }}>${amount.toLocaleString()}</p>
    </div>
  );
}

function ReportTable({ title, rows, columns }: { title: string; rows: any[]; columns: Array<[string, string, string?]> }) {
  const formatValue = (value: any, type?: string) => {
    if (value === null || value === undefined || value === '') return '-';
    if (type === 'money') return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (type === 'date') return new Date(value).toLocaleDateString();
    if (typeof value === 'object') return Object.keys(value).join(', ') || '-';
    return String(value);
  };

  return (
    <div className="p-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
      <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              {columns.map(([, label]) => (
                <th key={label} className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((row, index) => (
              <tr key={index} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {columns.map(([field, label, type]) => (
                  <td key={label} className="py-3 px-3 align-top max-w-xs truncate" style={{ color: 'var(--text-primary)', fontVariantNumeric: type === 'money' ? 'tabular-nums' : undefined }}>
                    {formatValue(row[field], type)}
                  </td>
                ))}
              </tr>
            )) : (
              <tr><td colSpan={columns.length} className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>No data available</td></tr>
            )}
          </tbody>
        </table>
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
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-color-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
    >
      <div className="relative p-6">
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>{title}</p>
            <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
          </div>
          <div className="p-4 rounded-2xl" style={colorStyles[color] || colorStyles.blue}>{icon}</div>
        </div>
      </div>
    </div>
  );
}

