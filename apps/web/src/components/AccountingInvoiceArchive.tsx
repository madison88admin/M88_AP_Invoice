import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ExternalLink, FileText, Loader2, Search, XCircle } from 'lucide-react';
import { InvoiceStatus } from '@ap-invoice/shared';
import { useAuth } from '../contexts/AuthContext';
import { useMockData } from '../contexts/MockDataContext';
import { useToast } from '../contexts/ToastContext';
import { invoiceApi } from '../lib/api';
import { MockInvoice } from '../lib/mockData';

export type AccountingArchiveMode = 'approved' | 'rejected';

const ACCOUNTING_ROLES = new Set(['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN']);
const APPROVED_STATUSES = new Set<string>([
  InvoiceStatus.PENDING_ACCOUNTING,
  InvoiceStatus.APPROVED,
  InvoiceStatus.POSTED_TO_QB,
  InvoiceStatus.PAYMENT_SCHEDULED,
  InvoiceStatus.PAYMENT_CONFIRMATION_SENT,
  InvoiceStatus.PAID,
]);

const formatStatus = (status: string) => status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

const latestDecision = (invoice: MockInvoice) => {
  const logs = (invoice.audit_logs || [])
    .filter(log => ['REJECTED', 'RETURNED_FOR_CORRECTION'].includes(String(log.action || '').toUpperCase()))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const log = logs[0];
  if (!log) return null;
  const note = String(log.note || '').trim();
  return {
    note: note.replace(/^reason:\s*/i, '').trim() || 'No rejection reason was recorded.',
    date: log.created_at,
    by: log.performed_by,
  };
};

interface AccountingInvoiceArchiveProps {
  mode: AccountingArchiveMode;
}

export default function AccountingInvoiceArchive({ mode }: AccountingInvoiceArchiveProps) {
  const { invoices } = useMockData();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [openingDocument, setOpeningDocument] = useState(false);

  const isApprovedView = mode === 'approved';
  const title = isApprovedView ? 'Approved Invoices' : 'Rejected Invoices';
  const description = isApprovedView
    ? 'Invoices approved by the workflow and available for accounting follow-up.'
    : 'Invoices rejected by accounting or the approval workflow, with the latest reason.';

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter(invoice => isApprovedView ? APPROVED_STATUSES.has(String(invoice.status)) : invoice.status === InvoiceStatus.REJECTED)
      .filter(invoice => !statusFilter || String(invoice.status) === statusFilter)
      .filter(invoice => !q || [invoice.invoice_number, invoice.vendor_name, invoice.brand, invoice.mpo_number, invoice.customer_po_number]
        .some(value => String(value || '').toLowerCase().includes(q)))
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  }, [invoices, isApprovedView, search, statusFilter]);

  const statuses = useMemo(() => Array.from(new Set(rows.map(invoice => String(invoice.status)))), [rows]);

  const openInvoicePdf = async (invoice: MockInvoice) => {
    const previewWindow = window.open('', '_blank');
    try {
      setOpeningDocument(true);
      if (previewWindow) {
        previewWindow.document.title = 'Loading invoice...';
        previewWindow.document.body.textContent = 'Loading invoice PDF...';
      }
      const response = await invoiceApi.getDocument(invoice.id);
      const contentType = String(response.headers['content-type'] || 'application/pdf');
      const url = URL.createObjectURL(new Blob([response.data], { type: contentType }));
      if (previewWindow) previewWindow.location.href = url;
      else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      previewWindow?.close();
      showToast('The actual invoice PDF is not available for this record.', 'error');
    } finally {
      setOpeningDocument(false);
    }
  };

  if (!user || !ACCOUNTING_ROLES.has(user.role)) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2" style={{ background: isApprovedView ? 'color-mix(in srgb, var(--accent-lime) 12%, transparent)' : 'color-mix(in srgb, var(--accent-red) 12%, transparent)' }}>
            {isApprovedView ? <CheckCircle className="h-5 w-5" style={{ color: 'var(--accent-lime)' }} /> : <XCircle className="h-5 w-5" style={{ color: 'var(--accent-red)' }} />}
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
            <option value="">All statuses</option>
            {statuses.map(status => <option key={status} value={status}>{formatStatus(status)}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search invoice, vendor, MPO..." className="w-56 rounded-xl py-2 pl-9 pr-3 text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
          </div>
          <span className="whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>{rows.length} records</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No {mode} invoices match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full">
              <thead style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                <tr>{['Invoice #', 'Vendor', 'Amount', 'Status', isApprovedView ? 'Updated' : 'Reason', ''].map(heading => <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{heading}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(invoice => {
                  const decision = latestDecision(invoice);
                  return (
                    <tr key={invoice.id} onClick={() => setSelectedInvoice(invoice)} className="cursor-pointer" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td className="px-5 py-4 align-top"><button type="button" onClick={event => { event.stopPropagation(); setSelectedInvoice(invoice); }} className="text-left text-sm font-semibold hover:underline" style={{ color: 'var(--accent-purple)' }}>{invoice.invoice_number || 'Unnamed invoice'}</button><p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{invoice.invoice_type || 'Invoice'}</p></td>
                      <td className="max-w-[260px] px-5 py-4 align-top text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.vendor_name || 'Unknown vendor'}</td>
                      <td className="whitespace-nowrap px-5 py-4 align-top text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{invoice.currency || ''} {Number(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-5 py-4 align-top"><span className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: isApprovedView ? 'color-mix(in srgb, var(--accent-lime) 12%, transparent)' : 'color-mix(in srgb, var(--accent-red) 12%, transparent)', color: isApprovedView ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{formatStatus(String(invoice.status))}</span></td>
                      <td className="max-w-[360px] px-5 py-4 align-top text-xs" style={{ color: 'var(--text-secondary)' }}>{isApprovedView ? (invoice.updated_at ? new Date(invoice.updated_at).toLocaleDateString('en-US') : 'N/A') : <span className="line-clamp-2">{decision?.note || 'No rejection reason was recorded.'}</span>}</td>
                      <td className="px-5 py-4 align-top"><button type="button" onClick={event => { event.stopPropagation(); void openInvoicePdf(invoice); }} disabled={openingDocument} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--accent-blue)', border: '1px solid var(--border-color)' }}><FileText className="h-3.5 w-3.5" /> PDF</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t px-5 py-3 text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>Accounting-only archive · {rows.length} {mode} invoice{rows.length === 1 ? '' : 's'}</div>
      </div>

      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={() => setSelectedInvoice(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto p-6" style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)' }} onClick={event => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between"><div><h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</h3><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{selectedInvoice.vendor_name} · {selectedInvoice.currency} {Number(selectedInvoice.total_amount || 0).toFixed(2)}</p></div><button type="button" onClick={() => setSelectedInvoice(null)} className="p-1.5" style={{ color: 'var(--text-secondary)' }}>✕</button></div>
            <div className="space-y-3 text-sm">
              {[['Status', formatStatus(String(selectedInvoice.status))], ['Invoice date', selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString('en-US') : 'N/A'], ['Due date', selectedInvoice.due_date ? new Date(selectedInvoice.due_date).toLocaleDateString('en-US') : 'N/A'], ['Payment terms', selectedInvoice.payment_terms || 'N/A'], ['PO / MPO', selectedInvoice.customer_po_number || selectedInvoice.mpo_number || 'N/A']].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}><span style={{ color: 'var(--text-muted)' }}>{label}</span><span className="text-right font-medium" style={{ color: 'var(--text-primary)' }}>{value}</span></div>)}
            </div>
            {!isApprovedView && <div className="mt-5 rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 24%, transparent)' }}><p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--accent-red)' }}>Rejection reason</p><p className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>{latestDecision(selectedInvoice)?.note || 'No rejection reason was recorded.'}</p>{latestDecision(selectedInvoice)?.by && <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>Recorded by {latestDecision(selectedInvoice)?.by}</p>}</div>}
            <div className="mt-6 space-y-2"><button type="button" onClick={() => void openInvoicePdf(selectedInvoice)} disabled={openingDocument} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}>{openingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} {openingDocument ? 'Opening Invoice...' : 'View Actual Invoice'}</button><Link to="/repository" state={{ selectedInvoiceId: selectedInvoice.id }} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}><FileText className="h-4 w-4" /> View Invoice in System</Link></div>
          </div>
        </div>
      )}
    </div>
  );
}
