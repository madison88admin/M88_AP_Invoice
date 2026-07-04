import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { auditLogApi } from '../lib/api';
import { LayoutDashboard, LogOut, FileText, Download, Search, RefreshCw } from 'lucide-react';

interface AuditLogItem {
  id: string;
  action: string;
  note: string | null;
  performed_by: string | null;
  invoice_id: string | null;
  invoice?: { invoice_number: string } | null;
  created_at: string;
}

const ACTION_OPTIONS = [
  'ALL',
  'USER_LOGIN',
  'USER_LOGIN_DEMO',
  'INVOICE_CREATED',
  'STATUS_UPDATED',
  'APPROVAL_REQUESTED',
  'INVOICE_APPROVED',
  'INVOICE_BATCH_APPROVED',
  'INVOICE_REJECTED',
  'INVOICE_VALIDATED',
  'INVOICE_VALIDATION_FAILED',
  'INVOICE_POSTED',
  'PAYMENT_SCHEDULED',
  'PAYMENT_PROCESSED',
  'CORRECTION_SAVED',
];

export default function AuditLog() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState('ALL');
  const [performedBy, setPerformedBy] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (action && action !== 'ALL') params.action = action;
      if (performedBy.trim()) params.performedBy = performedBy.trim();
      if (invoiceId.trim()) params.invoiceId = invoiceId.trim();
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await auditLogApi.getAll(params);
      setLogs(res.data.logs || []);
    } catch (err: any) {
      console.error('Failed to fetch audit logs:', err);
      setError(err?.response?.data?.error?.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleExport = () => {
    const headers = ['Timestamp', 'Action', 'Performed By', 'Invoice ID', 'Invoice Number', 'Note'];
    const rows = logs.map((log) => [
      new Date(log.created_at).toLocaleString(),
      log.action,
      log.performed_by || '',
      log.invoice_id || '',
      log.invoice?.invoice_number || '',
      log.note || '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <header className="px-6 py-4 border-b flex items-center justify-between" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ background: 'var(--logo-bg)' }}>
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Audit Logs</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{user?.name}</span>
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </button>
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <form onSubmit={handleSearch} className="rounded-xl p-4 mb-6 grid grid-cols-1 md:grid-cols-5 gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Action</label>
            <select value={action} onChange={(e) => setAction(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Performed By</label>
            <input type="text" value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="User name" className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice ID</label>
            <input type="text" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="Invoice ID" className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
          </div>
          <div className="md:col-span-5 flex gap-3">
            <button type="submit" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-purple-hover))' }}>
              <Search className="h-4 w-4" /> Search
            </button>
            <button type="button" onClick={fetchLogs} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" onClick={handleExport} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ml-auto" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-lg p-4 mb-6" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
            {error}
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-card-hover)', borderBottom: '1px solid var(--border-color)' }}>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Timestamp</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Action</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Performed By</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Invoice</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-8 w-8 opacity-50" />
                        <p>No audit logs found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-md text-xs font-medium" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{log.performed_by || '-'}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-primary)' }}>{log.invoice?.invoice_number || log.invoice_id || '-'}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{log.note || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
