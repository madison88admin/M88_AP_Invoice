import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, FileText, RotateCcw, Search, X, Loader2, Eye, Edit } from 'lucide-react';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { getReturnedInvoicesForUser } from '../lib/approvalQueue';
import { invoiceApi } from '../lib/api';
import type { MockInvoice } from '../lib/mockData';

const formatDate = (value?: string) => {
  if (!value) return 'Date unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Date unavailable'
    : parsed.toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' });
};

export default function ReturnedInvoices() {
  const { user } = useAuth();
  const { invoices } = useMockData();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedReturned, setSelectedReturned] = useState<MockInvoice | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showReturnReason, setShowReturnReason] = useState(true);
  const [reasonPosition, setReasonPosition] = useState({ x: 24, y: 112 });
  const [draggingReason, setDraggingReason] = useState(false);
  const reasonDragOffset = useRef({ x: 0, y: 0 });

  const returned = useMemo(() => getReturnedInvoicesForUser(invoices, user), [invoices, user]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return returned;
    return returned.filter(({ invoice, reason }) => [
      invoice.invoice_number,
      invoice.vendor_name,
      invoice.brand,
      invoice.mpo_number,
      invoice.po_number,
      reason,
    ].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [returned, search]);

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, returned.length]);

  useEffect(() => {
    if (!draggingReason) return;
    const handlePointerMove = (event: PointerEvent) => {
      const maxX = Math.max(12, window.innerWidth - 360);
      const maxY = Math.max(12, window.innerHeight - 190);
      setReasonPosition({
        x: Math.min(maxX, Math.max(12, event.clientX - reasonDragOffset.current.x)),
        y: Math.min(maxY, Math.max(12, event.clientY - reasonDragOffset.current.y)),
      });
    };
    const stopDragging = () => setDraggingReason(false);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
    };
  }, [draggingReason]);

  useEffect(() => {
    if (!showPdf || !selectedReturned) {
      setPdfLoading(false);
      setPdfUrl(null);
      setPdfError(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setPdfLoading(true);
    void invoiceApi.getDocument(selectedReturned.id).then((response) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([response.data], { type: String(response.headers['content-type'] || 'application/pdf') }));
      setPdfUrl(objectUrl);
    }).catch((error: any) => {
      if (!cancelled) setPdfError(error?.response?.data?.message || 'The invoice PDF is not available.');
    }).finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [showPdf, selectedReturned?.id]);

  const canReviewReturnedInvoices = user?.role === 'PURCHASING_MANAGER' || user?.role === 'PURCHASING_COORDINATOR';

  if (!canReviewReturnedInvoices) {
    return (
      <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>This queue is available to Purchasing Managers and Purchasing Coordinators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2" style={{ background: 'color-mix(in srgb, var(--accent-amber) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 28%, transparent)' }}>
            <RotateCcw className="h-5 w-5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Returned Invoices</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Invoices returned to you for correction, with the latest reason shown below.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice, vendor, PO..."
              className="w-64 rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
            />
          </div>
          <span className="whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>{filtered.length} returned</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="mb-3 inline-flex rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
            <RotateCcw className="h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {returned.length === 0 ? 'No invoices have been returned to you.' : 'No returned invoices match your search.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                <tr>
                  {['Invoice', 'Vendor', 'Amount', 'Returned', 'Reason', ''].map((heading) => (
                    <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(({ invoice, reason, returnedAt }) => (
                  <tr key={invoice.id} className="transition-colors" style={{ borderTop: '1px solid var(--border-subtle)' }} onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-card-hover)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}>
                    <td className="px-5 py-4 align-top">
                      <button onClick={() => { setSelectedReturned(invoice); setShowReturnReason(true); setShowDetails(true); }} className="text-left text-sm font-semibold hover:underline" style={{ color: 'var(--accent-purple)' }}>{invoice.invoice_number || 'Unnamed invoice'}</button>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{String(invoice.status || '').replace(/_/g, ' ')}</p>
                    </td>
                    <td className="px-5 py-4 align-top text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.vendor_name || 'Unknown vendor'}</td>
                    <td className="whitespace-nowrap px-5 py-4 align-top text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{invoice.currency} {Number(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="whitespace-nowrap px-5 py-4 align-top text-xs" style={{ color: 'var(--text-muted)' }}><span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" style={{ color: 'var(--accent-amber)' }} />{formatDate(returnedAt)}</span></td>
                    <td className="min-w-[280px] max-w-[520px] px-5 py-4 align-top"><div className="flex gap-2 rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 22%, transparent)' }}><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-amber)' }} /><span className="text-sm leading-5" style={{ color: 'var(--text-primary)' }}>{reason}</span></div></td>
                    <td className="px-5 py-4 align-top"><div className="flex flex-col gap-2"><button onClick={() => { setSelectedReturned(invoice); setShowReturnReason(true); setShowDetails(true); }} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--accent-purple)', border: '1px solid var(--border-color)' }}><Eye className="h-3.5 w-3.5" />View invoice</button><button onClick={() => navigate(`/repository?invoiceId=${encodeURIComponent(invoice.id)}&edit=1&pdf=1`)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)', border: '1px solid var(--accent-purple)' }}><Edit className="h-3.5 w-3.5" />Edit &amp; Resubmit</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={safePage === 1}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                >
                  Previous
                </button>
                <span className="min-w-16 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>Page {safePage} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={safePage === totalPages}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)', border: '1px solid var(--accent-purple)' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showDetails && selectedReturned && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDetails(false); }}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}><div><h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Returned invoice</h3><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedReturned.invoice_number} · {selectedReturned.vendor_name}</p></div><button type="button" onClick={() => setShowDetails(false)} className="rounded-lg p-2" style={{ color: 'var(--text-muted)' }}><X className="h-5 w-5" /></button></div>
            <div className="grid grid-cols-2 gap-4 p-6"><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Vendor</p><p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedReturned.vendor_name || 'N/A'}</p></div><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Amount</p><p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedReturned.currency} {Number(selectedReturned.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Status</p><p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{String(selectedReturned.status || '').replace(/_/g, ' ')}</p></div><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Invoice date</p><p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatDate(selectedReturned.invoice_date)}</p></div></div>
            <div className="mx-6 mb-6 rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 22%, transparent)' }}><p className="text-xs font-semibold uppercase" style={{ color: 'var(--accent-amber)' }}>Return reason</p><p className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>{returned.find((item) => item.invoice.id === selectedReturned.id)?.reason || 'Reason unavailable'}</p></div>
            <div className="flex flex-wrap justify-end gap-2 px-6 pb-6"><button type="button" onClick={() => setShowPdf(true)} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}><FileText className="h-4 w-4" /> View PDF</button><button type="button" onClick={() => navigate(`/repository?invoiceId=${encodeURIComponent(selectedReturned.id)}&edit=1&pdf=1`)} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}><Edit className="h-4 w-4" /> Edit &amp; Resubmit</button></div>
          </div>
          {showReturnReason && (
            <div
              className="fixed z-[80] w-[min(340px,calc(100vw-24px))] rounded-xl shadow-2xl"
              style={{ left: reasonPosition.x, top: reasonPosition.y, background: 'var(--bg-card)', border: '1px solid color-mix(in srgb, var(--accent-amber) 38%, var(--border-color))' }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div
                className="flex cursor-move items-center justify-between gap-3 rounded-t-xl px-3 py-2"
                style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--accent-amber) 24%, transparent)' }}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  reasonDragOffset.current = { x: event.clientX - reasonPosition.x, y: event.clientY - reasonPosition.y };
                  setDraggingReason(true);
                }}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-amber)' }}>Return reason</span>
                <button type="button" aria-label="Close return reason" onClick={() => setShowReturnReason(false)} className="rounded-lg p-1" style={{ color: 'var(--text-muted)' }}><X className="h-4 w-4" /></button>
              </div>
              <p className="p-3 text-sm leading-5" style={{ color: 'var(--text-primary)' }}>{returned.find((item) => item.invoice.id === selectedReturned.id)?.reason || 'Reason unavailable'}</p>
            </div>
          )}
        </div>
      )}

      {showPdf && selectedReturned && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPdf(false); }}>
          <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}><div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}><div><h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Actual invoice PDF</h3><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedReturned.invoice_number}</p></div><button type="button" onClick={() => setShowPdf(false)} className="rounded-lg p-2" style={{ color: 'var(--text-muted)' }}><X className="h-5 w-5" /></button></div><div className="min-h-0 flex-1 bg-white">{pdfUrl ? <iframe title="Returned invoice PDF" src={pdfUrl} className="h-full w-full" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm" style={{ color: pdfError ? 'var(--accent-red)' : 'var(--text-muted)' }}>{pdfError || (pdfLoading ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading PDF…</> : 'No PDF preview available')}</div>}</div><div className="flex justify-end px-5 py-3" style={{ borderTop: '1px solid var(--border-color)' }}><button type="button" onClick={() => setShowPdf(false)} className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}>Back to invoice</button></div></div>
        </div>
      )}
    </div>
  );
}
