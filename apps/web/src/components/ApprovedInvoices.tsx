import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { CheckCircle, Search, FileText, Loader2, ExternalLink, Clock, CalendarCheck } from 'lucide-react';
import { InvoiceStatus } from '@ap-invoice/shared';
import { MockInvoice } from '../lib/mockData';
import { getApprovedByUser, orderedSignatures } from '../lib/approvalQueue';
import { invoiceApi } from '../lib/api';

const APPROVAL_ROLE_ORDER = [
  'COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER',
  'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY',
  'ACCOUNTING_REVIEWER',
];

// Statuses the workflow reaches AT or AFTER the Purchasing Manager signs.
// The "Approved Invoices" folder only shows these — pre-approval stages
// (RECEIVED → PENDING_MANAGER) never appear here.
const PM_FORWARD_STATUSES: string[] = [
  InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
  InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
  InvoiceStatus.PENDING_SR_MANAGER,
  InvoiceStatus.PENDING_POLLY,
  InvoiceStatus.PENDING_ACCOUNTING,
  InvoiceStatus.APPROVED,
  InvoiceStatus.POSTED_TO_QB,
  InvoiceStatus.PAYMENT_SCHEDULED,
  InvoiceStatus.PAYMENT_CONFIRMATION_SENT,
  InvoiceStatus.PAID,
  InvoiceStatus.ON_HOLD,
  InvoiceStatus.CANCELLED,
  InvoiceStatus.REJECTED,
];

const LOWER_THAN_PM_STATUSES = new Set<string>([
  InvoiceStatus.RECEIVED,
  InvoiceStatus.OCR_PROCESSING,
  InvoiceStatus.VALIDATION_PENDING,
  InvoiceStatus.EXCEPTION_FLAGGED,
  InvoiceStatus.PENDING_COORDINATOR,
  InvoiceStatus.PENDING_MANAGER,
]);

const formatStatusLabel = (status: string) =>
  status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export default function ApprovedInvoices() {
  const { invoices } = useMockData();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [openingDocument, setOpeningDocument] = useState(false);

  // Only the user's own approvals — the "My Approved Invoices" folder — and
  // only invoices whose current status is at/after the PM approval stage.
  const approved = getApprovedByUser(invoices, user).filter(
    ({ invoice }) => !LOWER_THAN_PM_STATUSES.has(String(invoice.status || ''))
  );

  const filtered = approved.filter(({ invoice }) => {
    if (statusFilter && String(invoice.status || '') !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(invoice.invoice_number || '').toLowerCase().includes(q) ||
      String(invoice.vendor_name || '').toLowerCase().includes(q) ||
      String(invoice.brand || '').toLowerCase().includes(q) ||
      String(invoice.mpo_number || '').toLowerCase().includes(q)
    );
  });

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
      const verificationWarning = response.headers['x-pdf-verification'];
      if (verificationWarning) {
        try { showToast(decodeURIComponent(verificationWarning), 'warning'); } catch { showToast(String(verificationWarning), 'warning'); }
      }
      const url = URL.createObjectURL(new Blob([response.data], { type: contentType }));
      if (previewWindow) previewWindow.location.href = url;
      else {
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      previewWindow?.close();
      let message = 'The actual invoice PDF is not available for this record.';
      try {
        const parsed = JSON.parse(await error?.response?.data?.text?.());
        message = parsed?.error?.message || parsed?.message || message;
      } catch { /* keep fallback */ }
      showToast(message, 'error');
    } finally {
      setOpeningDocument(false);
    }
  };

  const approvalProgress = (invoice: MockInvoice) =>
    (invoice.signatures || [])
      .filter(s => !s.ocr_detected)
      .sort((a, b) => APPROVAL_ROLE_ORDER.indexOf(a.signatory_role) - APPROVAL_ROLE_ORDER.indexOf(b.signatory_role));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-lime) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-lime) 25%, transparent)' }}>
            <CheckCircle className="h-5 w-5" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>My Approved Invoices</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Invoices you already approved — history folder</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="Filter by current status (stages at/after Purchasing Manager approval)"
            className="rounded-xl text-sm focus:outline-none px-3 py-2"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
          >
            <option value="">All statuses</option>
            {PM_FORWARD_STATUSES.map((s) => (
              <option key={s} value={s}>{formatStatusLabel(s)}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice #, vendor, brand, MPO..."
              className="pl-9 pr-3 py-2 rounded-xl text-sm focus:outline-none w-64"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
            />
          </div>
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{filtered.length} approved</span>
        </div>
      </div>

      {/* List view */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
          <div className="inline-flex p-4 rounded-2xl mb-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
            <CheckCircle className="h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {approved.length === 0 ? "You haven't approved any invoices yet." : 'No approved invoices match your filters.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full">
              <thead style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                <tr>
                  {['Invoice #', 'Vendor', 'Amount', 'Current status', 'Approved', 'Brand / MPO', ''].map((heading) => (
                    <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ invoice, signedAt }) => (
                  <tr
                    key={invoice.id}
                    onClick={() => setSelectedInvoice(invoice)}
                    className="cursor-pointer transition-colors"
                    style={{ background: selectedInvoice?.id === invoice.id ? 'color-mix(in srgb, var(--accent-lime) 7%, transparent)' : undefined, borderTop: '1px solid var(--border-subtle)' }}
                    onMouseEnter={(event) => { if (selectedInvoice?.id !== invoice.id) event.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(event) => { if (selectedInvoice?.id !== invoice.id) event.currentTarget.style.background = 'transparent'; }}
                  >
                    <td className="px-5 py-4 align-top">
                      <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedInvoice(invoice); }} className="text-left text-sm font-semibold hover:underline" style={{ color: 'var(--accent-purple)' }}>{invoice.invoice_number || 'Unnamed invoice'}</button>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{invoice.invoice_type || 'Invoice'}</p>
                    </td>
                    <td className="max-w-[260px] px-5 py-4 align-top text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.vendor_name || 'Unknown vendor'}</td>
                    <td className="whitespace-nowrap px-5 py-4 align-top text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{invoice.currency || ''} {Number(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-5 py-4 align-top"><span className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }}>{formatStatusLabel(String(invoice.status || ''))}</span></td>
                    <td className="whitespace-nowrap px-5 py-4 align-top text-xs" style={{ color: 'var(--text-muted)' }}><span className="inline-flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" style={{ color: 'var(--accent-lime)' }} strokeWidth={2} />{new Date(signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}</span></td>
                    <td className="max-w-[220px] px-5 py-4 align-top text-xs" style={{ color: 'var(--text-secondary)' }}><span className="block truncate">{invoice.brand || 'No brand'}</span><span className="mt-1 block truncate" style={{ color: 'var(--text-muted)' }}>{invoice.mpo_number || invoice.customer_po_number || 'No MPO / PO'}</span></td>
                    <td className="px-5 py-4 align-top"><button type="button" onClick={(event) => { event.stopPropagation(); void openInvoicePdf(invoice); }} disabled={openingDocument} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium" title="View actual invoice PDF" style={{ background: 'var(--bg-elevated)', color: 'var(--accent-blue)', border: '1px solid var(--border-color)' }}><FileText className="h-3.5 w-3.5" strokeWidth={1.75} /> PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Showing {filtered.length} of {approved.length} approved invoices</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Click a row to view details</span>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={() => setSelectedInvoice(null)}>
          <div
            className="w-full max-w-md h-full overflow-y-auto p-6"
            style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</h3>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {selectedInvoice.vendor_name} · {selectedInvoice.currency} {Number(selectedInvoice.total_amount).toFixed(2)}
                </p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-secondary)' }}>✕</button>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium mb-4" style={{ background: 'color-mix(in srgb, var(--accent-lime) 12%, transparent)', color: 'var(--accent-lime)' }}>
              ✓ Approved by you
            </span>

            <div className="space-y-3">
              {[
                ['Invoice Date', selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString() : 'N/A'],
                ['Due Date', selectedInvoice.due_date ? new Date(selectedInvoice.due_date).toLocaleDateString() : 'N/A'],
                ['Status', String(selectedInvoice.status || '').replace(/_/g, ' ')],
                ['Brand', selectedInvoice.brand || 'N/A'],
                ['Season', selectedInvoice.season || 'N/A'],
                ['MPO', selectedInvoice.mpo_number || 'N/A'],
                ['PO', selectedInvoice.customer_po_number || 'N/A'],
                ['Order Type', selectedInvoice.order_type === 'OTHER'
                  ? `Others${selectedInvoice.order_type_detail ? ` · ${({ COMBINED_BULK_SMS: 'Combined - bulk & sms', COMBINED_SMS_SAMPLE: 'Combined - sms & sample', COMBINED_BULK_SAMPLE: 'Combined - bulk & sample', COMBINED_ALL: 'Combined - all' } as Record<string, string>)[selectedInvoice.order_type_detail] || selectedInvoice.order_type_detail}` : ''}`
                  : String(selectedInvoice.order_type || 'N/A').replace(/_/g, ' ')],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span className="font-medium text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Approval progress */}
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Approval Progress</p>
              <div className="space-y-2">
                {approvalProgress(selectedInvoice).map((sig) => (
                  <div key={sig.id} className="flex items-center justify-between text-sm">
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{sig.signatory_name || sig.signatory_role}</span>
                    <span className="flex items-center">
                      {sig.signed_at ? (
                        <><CheckCircle className="h-4 w-4 mr-1" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} /> Signed</>
                      ) : (
                        <><Clock className="h-4 w-4 mr-1" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} /> Pending</>
                      )}
                    </span>
                  </div>
                ))}
                {orderedSignatures(selectedInvoice).length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No workflow signatures recorded.</p>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <button
                onClick={() => void openInvoicePdf(selectedInvoice)}
                disabled={openingDocument}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
              >
                {openingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {openingDocument ? 'Opening Invoice...' : 'View Actual Invoice'}
              </button>
              <Link
                to="/"
                state={{ selectedInvoiceId: selectedInvoice.id }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                <FileText className="h-4 w-4" />
                View Invoice in System
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
