import { useMemo, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { Clock3, FileText, RefreshCw, Search, UserRound } from 'lucide-react';
import { InvoiceStatus } from '@ap-invoice/shared';
import { useAuth } from '../contexts/AuthContext';
import { useMockData } from '../contexts/MockDataContext';
import { MockInvoice } from '../lib/mockData';

/**
 * Manager-only visibility into invoices that are still in validation. These
 * records have not been endorsed by the Purchasing Coordinator yet, so they
 * must not appear in the manager's approval queue.
 */
export function getCoordinatorDisplayName(invoice: MockInvoice): string {
  const coordinatorSignature = (invoice.signatures || []).find((signature) =>
    ['COORDINATOR', 'PURCHASING_COORDINATOR'].includes(String(signature.signatory_role).toUpperCase()) &&
    !signature.ocr_detected &&
    Boolean(signature.signatory_name),
  );

  if (coordinatorSignature?.signatory_name) return coordinatorSignature.signatory_name;

  const coordinatorAudit = (invoice.audit_logs || []).find((log) =>
    ['COORDINATOR', 'PURCHASING_COORDINATOR'].includes(String(log.actor_role || '').toUpperCase()) &&
    Boolean(log.actor_name),
  );

  return coordinatorAudit?.actor_name || invoice.uploaded_by || 'Not assigned';
}

const formatDate = (value?: string) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

export function getValidationPendingInvoices(invoices: MockInvoice[], search = ''): MockInvoice[] {
  const query = search.trim().toLowerCase();
  return invoices
    .filter((invoice) => String(invoice.status) === InvoiceStatus.VALIDATION_PENDING)
    .filter((invoice) => {
      if (!query) return true;
      const coordinator = getCoordinatorDisplayName(invoice);
      return [
        invoice.invoice_number,
        invoice.vendor_name,
        invoice.vendor_name_raw,
        invoice.brand,
        invoice.po_number,
        invoice.mpo_number,
        coordinator,
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const aDate = new Date(a.invoice_received_date || a.created_at || 0).getTime();
      const bDate = new Date(b.invoice_received_date || b.created_at || 0).getTime();
      return aDate - bDate;
    });
}

export default function ValidationPendingQueue() {
  const { user } = useAuth();
  const { invoices, refresh, loading, isRefreshing } = useMockData();
  const [search, setSearch] = useState('');

  const validationPending = useMemo(() => getValidationPendingInvoices(invoices, search), [invoices, search]);

  const totalPending = invoices.filter((invoice) => String(invoice.status) === InvoiceStatus.VALIDATION_PENDING).length;

  // This is deliberately a manager-only page. Coordinators work the same
  // records from their validation/workbench flow, while the manager gets a
  // read-only visibility queue until the coordinator submits them.
  if (user?.role !== 'PURCHASING_MANAGER') {
    return <Navigate to="/approvals" replace />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className="rounded-xl p-2"
            style={{
              background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-blue) 28%, transparent)',
            }}
          >
            <Clock3 className="h-5 w-5" style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Validation Pending</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Invoices awaiting Purchasing Coordinator validation and submission to your approval queue.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={isRefreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search invoice, vendor, coordinator, PO..."
            className="w-full rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
          />
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {validationPending.length} shown · {totalPending} validation pending
        </span>
      </div>

      {loading && invoices.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          Loading validation queue...
        </div>
      ) : validationPending.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Clock3 className="mx-auto mb-3 h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {totalPending === 0 ? 'No invoices are waiting for coordinator submission.' : 'No validation-pending invoices match your search.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full">
              <thead style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                <tr>
                  {['Invoice', 'Vendor', 'Amount', 'Coordinator', 'Received', 'Next step'].map((heading) => (
                    <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {validationPending.map((invoice) => {
                  const coordinator = getCoordinatorDisplayName(invoice);
                  return (
                    <tr key={invoice.id} className="transition-colors" style={{ borderTop: '1px solid var(--border-subtle)' }} onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-card-hover)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}>
                      <td className="px-5 py-4 align-top">
                        <Link to={`/repository?invoiceId=${encodeURIComponent(invoice.id)}`} className="inline-flex items-center gap-2 text-sm font-semibold hover:underline" style={{ color: 'var(--accent-purple)' }}>
                          <FileText className="h-4 w-4" strokeWidth={1.75} />
                          {invoice.invoice_number || 'Unnamed invoice'}
                        </Link>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{invoice.invoice_type || 'Invoice'}</p>
                      </td>
                      <td className="max-w-[260px] px-5 py-4 align-top text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.vendor_name || invoice.vendor_name_raw || 'Unknown vendor'}</td>
                      <td className="whitespace-nowrap px-5 py-4 align-top text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{invoice.currency || ''} {Number(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-5 py-4 align-top">
                        <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-primary)' }}><UserRound className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />{coordinator}</span>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>Purchasing Coordinator</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 align-top text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(invoice.invoice_received_date || invoice.created_at)}</td>
                      <td className="px-5 py-4 align-top">
                        <span className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }}>Awaiting coordinator</span>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>View invoice details</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Read-only visibility for Purchasing Manager</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Invoices appear in Approvals after coordinator submission</span>
          </div>
        </div>
      )}
    </div>
  );
}
