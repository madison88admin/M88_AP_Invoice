import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { InvoiceStatus } from '@ap-invoice/shared';
import { useMockData } from '../contexts/MockDataContext';
import { MockInvoice } from '../lib/mockData';
import { invoiceApi } from '../lib/api';
import { FileText, Search, Filter, Download, Eye, CheckCircle, XCircle, Calendar, FileSearch, AlertTriangle, Landmark, Clock, User, Paperclip, Check, X as XIcon, Loader2 } from 'lucide-react';
export default function AccountingReview() {
  const { invoices } = useMockData();
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [activeTab, setActiveTab] = useState<'posted' | 'soa' | 'bank-requests'>('posted');
  const [filters, setFilters] = useState({
    status: InvoiceStatus.POSTED_TO_QB,
    search: '',
  });
  const [bankRequests, setBankRequests] = useState<any[]>([]);
  const [bankRequestsLoading, setBankRequestsLoading] = useState(false);
  const [bankActionLoading, setBankActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const statementInvoices = invoices.filter(i => i.invoice_type === 'STATEMENT');

  const reloadBankRequests = useCallback(() => {
    setBankRequestsLoading(true);
    invoiceApi.getBankChangeRequests()
      .then((res) => setBankRequests(res.data || []))
      .catch(() => setBankRequests([]))
      .finally(() => setBankRequestsLoading(false));
  }, []);

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  useEffect(() => {
    if (activeTab === 'bank-requests') {
      reloadBankRequests();
    }
  }, [activeTab, reloadBankRequests]);

  const filteredInvoices = invoices.filter(invoice => {
    if (activeTab === 'soa' && invoice.invoice_type !== 'STATEMENT') return false;
    if (activeTab === 'posted' && invoice.invoice_type === 'STATEMENT') return false;
    if (filters.status && invoice.status !== filters.status) return false;
    return invoice.invoice_number.toLowerCase().includes(filters.search.toLowerCase()) ||
    invoice.vendor_name.toLowerCase().includes(filters.search.toLowerCase());
  });

  const getInvoiceStatusStyle = (status: string): React.CSSProperties => {
    if (status === InvoiceStatus.POSTED_TO_QB) {
      return { background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' };
    }
    if (status === InvoiceStatus.PAID) {
      return { background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' };
    }
    if (status === InvoiceStatus.PAYMENT_CONFIRMATION_SENT) {
      return { background: 'color-mix(in srgb, var(--accent-lime) 12%, transparent)', color: 'var(--accent-lime)', border: '1px solid color-mix(in srgb, var(--accent-lime) 20%, transparent)' };
    }
    return { background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' };
  };

  const exportToExcel = () => {
    const rows = filteredInvoices;
    if (rows.length === 0) return;

    const tabLabel = activeTab === 'soa' ? 'SOA Reconciliation' : activeTab === 'bank-requests' ? 'Bank Change Requests' : 'Posted Invoices';
    const exportDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const fileName = `Accounting-Review-${tabLabel.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.xls`;

    const columns = [
      { header: '#', width: 40 },
      { header: 'Invoice Number', width: 160 },
      { header: 'Vendor', width: 220 },
      { header: 'Amount', width: 100 },
      { header: 'Currency', width: 70 },
      { header: 'Status', width: 140 },
      { header: 'Posted Date', width: 120 },
      { header: 'Invoice Date', width: 100 },
      { header: 'Due Date', width: 100 },
      { header: 'Payment Terms', width: 100 },
      { header: 'Brand', width: 100 },
      { header: 'PO Number', width: 120 },
      { header: 'MPO Number', width: 120 },
      { header: 'Bank Name', width: 180 },
      { header: 'SWIFT Code', width: 120 },
      { header: 'Account Number', width: 160 },
    ];

    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const headerRow = columns.map(c =>
      `<td style="background:#1F2937;color:#FFFFFF;font-weight:bold;text-align:center;border:1px solid #374151;padding:6px 8px;white-space:nowrap;">${esc(c.header)}</td>`
    ).join('');

    const dataRows = rows.map((inv: any, idx: number) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F3F4F6';
      const style = `style="background:${bg};border:1px solid #D1D5DB;padding:5px 8px;white-space:nowrap;mso-number-format:'\\@';"`;
      const amountStyle = `style="background:${bg};border:1px solid #D1D5DB;padding:5px 8px;text-align:right;white-space:nowrap;mso-number-format:'#,##0.00';"`;
      const centerStyle = `style="background:${bg};border:1px solid #D1D5DB;padding:5px 8px;text-align:center;white-space:nowrap;"`;
      return `<tr>` +
        `<td ${centerStyle}>${idx + 1}</td>` +
        `<td ${style}>${esc(inv.invoice_number || '')}</td>` +
        `<td ${style}>${esc(inv.vendor_name || inv.vendor?.name || '')}</td>` +
        `<td ${amountStyle}>${esc(inv.total_amount || 0)}</td>` +
        `<td ${centerStyle}>${esc(inv.currency || 'USD')}</td>` +
        `<td ${centerStyle}>${esc((inv.status || '').replace(/_/g, ' '))}</td>` +
        `<td ${centerStyle}>${esc(inv.updated_at ? new Date(inv.updated_at).toLocaleDateString('en-US') : 'N/A')}</td>` +
        `<td ${centerStyle}>${esc(inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-US') : '')}</td>` +
        `<td ${centerStyle}>${esc(inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-US') : '')}</td>` +
        `<td ${centerStyle}>${esc(inv.payment_terms || '')}</td>` +
        `<td ${style}>${esc(inv.brand || '')}</td>` +
        `<td ${style}>${esc(inv.po_number || inv.customer_po_number || '')}</td>` +
        `<td ${style}>${esc(inv.mpo_number || '')}</td>` +
        `<td ${style}>${esc(inv.bank_name || '')}</td>` +
        `<td ${style}>${esc(inv.swift_code || '')}</td>` +
        `<td ${style}>${esc(inv.account_number || '')}</td>` +
        `</tr>`;
    }).join('');

    const totalAmount = rows.reduce((sum: number, inv: any) => sum + (Number(inv.total_amount) || 0), 0);

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Accounting Review</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table>
<tr><td colspan="${columns.length}" style="font-size:18px;font-weight:bold;color:#1F2937;padding:4px 0;">Madison 88 — Accounting Review Report</td></tr>
<tr><td colspan="${columns.length}" style="font-size:12px;color:#6B7280;padding:2px 0;">Tab: ${esc(tabLabel)} &nbsp;|&nbsp; Generated: ${esc(exportDate)} &nbsp;|&nbsp; Total Records: ${rows.length}</td></tr>
<tr><td colspan="${columns.length}" style="font-size:12px;color:#6B7280;padding:2px 0 10px 0;">Total Amount: ${esc(rows[0]?.currency || 'USD')} ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
<tr></tr>
<tr>${headerRow}</tr>
${dataRows}
</table>
</body>
</html>`;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
        {/* Tab Switcher */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('posted')}
              className="px-4 py-2.5 rounded-xl transition-all text-sm font-medium"
              style={activeTab === 'posted'
                ? { background: 'var(--accent-purple)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              Posted Invoices
            </button>
            <button
              onClick={() => setActiveTab('soa')}
              className="px-4 py-2.5 rounded-xl transition-all text-sm font-medium flex items-center gap-2"
              style={activeTab === 'soa'
                ? { background: 'var(--accent-amber)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
              SOA Reconciliation ({statementInvoices.length})
            </button>
            <button
              onClick={() => setActiveTab('bank-requests')}
              className="px-4 py-2.5 rounded-xl transition-all text-sm font-medium flex items-center gap-2"
              style={activeTab === 'bank-requests'
                ? { background: 'var(--accent-blue)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              <Landmark className="h-4 w-4" strokeWidth={1.75} />
              Bank Change Requests ({bankRequests.length})
            </button>
          </div>

          {/* SOA Info Banner */}
          {activeTab === 'soa' && (
            <div className="p-4 mb-6 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Statement Type — Manual SOA Reconciliation Required</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>These are monthly statement invoices with aggregated totals (current charges + prior overdue + finance surcharge). PO amount matching is skipped. Reconcile against vendor Statements of Account manually.</p>
                </div>
              </div>
            </div>
          )}

          {/* Bank Change Requests Tab */}
          {activeTab === 'bank-requests' && (
            <div className="rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Landmark className="h-5 w-5" style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />
                  Bank Details Change Requests
                </h2>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{bankRequests.length} request(s)</span>
              </div>

              {bankRequestsLoading ? (
                <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>Loading requests...</div>
              ) : bankRequests.length === 0 ? (
                <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>No bank details change requests yet.</div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {bankRequests.map((req: any) => (
                    <div key={req.id} className="p-5 hover:bg-[var(--bg-card-hover)] transition-colors">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{req.invoice_number}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }}>
                              {req.field === 'bank_name' ? 'Bank Name' : req.field === 'swift_code' ? 'SWIFT Code' : req.field === 'account_number' ? 'Account Number' : req.field}
                            </span>
                            {req.status && req.status !== 'PENDING' && (
                              <span className="text-xs px-2 py-0.5 rounded-full" style={{
                                background: req.status === 'APPROVED' ? 'color-mix(in srgb, var(--accent-lime) 12%, transparent)' : 'color-mix(in srgb, var(--accent-red) 12%, transparent)',
                                color: req.status === 'APPROVED' ? 'var(--accent-lime)' : 'var(--accent-red)',
                              }}>
                                {req.status}
                              </span>
                            )}
                          </div>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{req.vendor_name}</p>
                        </div>
                        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                          {new Date(req.created_at).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                          <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Current Value</p>
                          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{req.current_value || '—'}</p>
                        </div>
                        <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-lime) 8%, transparent)' }}>
                          <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Requested Value</p>
                          <p className="text-sm font-medium" style={{ color: 'var(--accent-lime)' }}>{req.requested_value || '—'}</p>
                        </div>
                      </div>

                      <div className="mb-2">
                        <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Reason</p>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{req.reason}</p>
                      </div>

                      {/* Attachment */}
                      {req.has_attachment && req.attachment_filename && (
                        <div className="mb-3">
                          <a
                            href={`${window.location.origin}/api/invoices/bank-change-requests/${req.id}/attachment`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={async (e) => {
                              e.preventDefault();
                              try {
                                const res = await invoiceApi.downloadBankChangeAttachment(req.id);
                                const url = window.URL.createObjectURL(res.data);
                                window.open(url, '_blank');
                              } catch (err) {
                                console.error('Failed to download attachment:', err);
                              }
                            }}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 20%, transparent)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 10%, transparent)'; }}
                          >
                            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {req.attachment_filename}
                          </a>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" strokeWidth={1.75} />
                            {req.requested_by}
                          </span>
                          <Link to={`/?invoiceId=${req.invoice_id}`} className="flex items-center gap-1 transition-colors" style={{ color: 'var(--accent-blue)' }}>
                            <Eye className="h-3 w-3" strokeWidth={1.75} />
                            View Invoice
                          </Link>
                        </div>
                        {(!req.status || req.status === 'PENDING') && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                setBankActionLoading(req.id);
                                try {
                                  const res = await invoiceApi.approveBankChangeRequest(req.id);
                                  showToast(res.data?.message || `Approved — ${req.field.replace(/_/g, ' ')} updated to "${req.requested_value}" on invoice ${req.invoice_number}`, 'success');
                                  reloadBankRequests();
                                } catch (err: any) {
                                  const msg = err?.response?.data?.error?.message || 'Failed to approve request';
                                  showToast(msg, 'error');
                                } finally {
                                  setBankActionLoading(null);
                                }
                              }}
                              disabled={bankActionLoading === req.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                              style={{ background: 'color-mix(in srgb, var(--accent-lime) 10%, transparent)', color: 'var(--accent-lime)', border: '1px solid color-mix(in srgb, var(--accent-lime) 20%, transparent)' }}
                              onMouseEnter={(e) => { if (bankActionLoading !== req.id) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-lime) 20%, transparent)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-lime) 10%, transparent)'; }}
                            >
                              {bankActionLoading === req.id ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} /> : <Check className="h-3 w-3" strokeWidth={2.5} />}
                              Approve
                            </button>
                            <button
                              onClick={async () => {
                                setBankActionLoading(req.id + '-reject');
                                try {
                                  const res = await invoiceApi.rejectBankChangeRequest(req.id);
                                  showToast('Bank change request rejected', 'success');
                                  reloadBankRequests();
                                } catch (err: any) {
                                  const msg = err?.response?.data?.error?.message || 'Failed to reject request';
                                  showToast(msg, 'error');
                                } finally {
                                  setBankActionLoading(null);
                                }
                              }}
                              disabled={bankActionLoading === req.id + '-reject'}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                              style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}
                              onMouseEnter={(e) => { if (bankActionLoading !== req.id + '-reject') e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                            >
                              {bankActionLoading === req.id + '-reject' ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} /> : <XIcon className="h-3 w-3" strokeWidth={2.5} />}
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab !== 'bank-requests' && (
          <div>
          {/* Filters */}
          <div className="p-6 mb-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                  <input
                    type="text"
                    placeholder="Search invoices..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-12 pr-4 py-3 w-full rounded-xl focus:outline-none transition-all text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus })}
                className="px-4 py-3 rounded-xl focus:outline-none transition-all text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value={InvoiceStatus.POSTED_TO_QB}>Posted</option>
                <option value={InvoiceStatus.PAID}>Paid</option>
                <option value={InvoiceStatus.PAYMENT_CONFIRMATION_SENT}>Confirmation Sent</option>
                <option value={InvoiceStatus.PAYMENT_SCHEDULED}>Payment Scheduled</option>
                <option value="">All Statuses</option>
              </select>
              <button className="flex items-center px-4 py-3 text-white rounded-xl transition-all text-sm font-medium" style={{ background: 'var(--accent-purple)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-purple)'; }}
              >
                <Filter className="h-5 w-5 mr-2" strokeWidth={1.75} />
                More Filters
              </button>
            </div>
          </div>

          {/* Invoice Table */}
          <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {activeTab === 'soa' ? 'SOA Reconciliation Queue' : 'Posted Invoices'} ({filteredInvoices.length})
              </h2>
              <button
                onClick={exportToExcel}
                disabled={filteredInvoices.length === 0}
                className="flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-lime)'; }}
              >
                <Download className="h-5 w-5 mr-2" strokeWidth={1.75} />
                Export Excel{filteredInvoices.length > 0 ? ` (${filteredInvoices.length})` : ''}
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>Loading invoices...</div>
            ) : (
              <table className="min-w-full">
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendor</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Posted Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice, idx) => (
                    <tr key={invoice.id} className="transition-colors" style={{ borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 mr-2" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{invoice.invoice_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.vendor_name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${invoice.total_amount.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full" style={getInvoiceStatusStyle(invoice.status)}>{invoice.status}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.updated_at ? new Date(invoice.updated_at).toLocaleDateString() : 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onClick={() => setSelectedInvoice(invoice)} className="transition-colors" style={{ color: 'var(--accent-purple)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-violet)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}
                        >
                          <Eye className="h-5 w-5" strokeWidth={1.75} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!loading && filteredInvoices.length === 0 && (
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>No invoices found</div>
            )}
          </div>
          </div>
          )}

          {/* Invoice Detail Panel */}
          {selectedInvoice && (
            <div className="mt-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Invoice Details</h2>
                  <button onClick={() => setSelectedInvoice(null)} className="transition-colors" style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <XCircle className="h-6 w-6" strokeWidth={1.75} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Number</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.vendor_name}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${selectedInvoice.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Currency</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.currency}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Due Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.due_date ? new Date(selectedInvoice.due_date).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.status}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Posted Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.updated_at ? new Date(selectedInvoice.updated_at).toLocaleDateString() : 'N/A'}</p>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <h3 className="text-md font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Bank Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bank Name</label>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.bank_name || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Account Number</label>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.account_number || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>SWIFT Code</label>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.swift_code || 'N/A'}</p>
                    </div>
                    <div className="mt-4 p-3 rounded-xl" style={selectedInvoice.swift_code && selectedInvoice.account_number
                      ? { background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }
                      : { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }
                    }>
                      <div className="flex items-center">
                        {selectedInvoice.swift_code && selectedInvoice.account_number ? (
                          <>
                            <CheckCircle className="h-5 w-5 mr-2" style={{ color: 'var(--accent-green)' }} strokeWidth={1.75} />
                            <span className="text-sm font-medium" style={{ color: 'var(--accent-green)' }}>Bank information is complete and validated</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 mr-2" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                            <span className="text-sm font-medium" style={{ color: 'var(--accent-red)' }}>Bank information is incomplete - requires vendor update</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <h3 className="text-md font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Audit Trail</h3>
                  <div className="space-y-2">
                    <div className="flex items-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="h-4 w-4 mr-2" style={{ color: 'var(--accent-green)' }} strokeWidth={1.75} />
                      <span>Posted on {selectedInvoice.updated_at ? new Date(selectedInvoice.updated_at).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div className="flex items-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <Calendar className="h-4 w-4 mr-2" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
                      <span>Created on {selectedInvoice.created_at ? new Date(selectedInvoice.created_at).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

      {/* Toast Notification */}
      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-xl border shadow-2xl animate-slide-in-right"
          style={{
            background: 'var(--bg-card)',
            borderLeft: toast.type === 'success' ? '3px solid var(--accent-lime)' : '3px solid var(--accent-red)',
            borderColor: 'var(--border-color)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: '12px 16px',
            minWidth: '300px',
            maxWidth: '450px',
            borderRadius: '12px',
          }}
        >
          <div className="flex items-center gap-3">
            {toast.type === 'success' ? (
              <CheckCircle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
            ) : (
              <XCircle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
            )}
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{toast.message}</p>
          </div>
        </div>
      )}
        </div>
  );
}
