import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Search, AlertTriangle, CheckCircle } from 'lucide-react';
import { invoiceApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { isInvoiceActionableForRole } from '../lib/roleAccess';

export default function InvoiceRepository() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [timeline, setTimeline] = useState<any | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const loadInvoices = () => invoiceApi.getAll().then((response) => setInvoices(response.data || []));

  useEffect(() => {
    loadInvoices()
      .finally(() => setLoading(false));
  }, []);

  const confirmHold = async (invoiceId: string) => {
    await invoiceApi.confirmHold(invoiceId);
    await loadInvoices();
  };

  const statuses = useMemo(() => Array.from(new Set(invoices.map((invoice) => invoice.status))).sort(), [invoices]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (!status && !isInvoiceActionableForRole(invoice, user?.role || '')) return false;
      if (status && status !== '__ALL__' && invoice.status !== status) return false;
      if (!term) return true;
      return [
        invoice.invoice_number,
        invoice.vendor?.name,
        invoice.vendor_name_raw,
        invoice.mpo_number,
        invoice.material_code,
        invoice.material_name,
        invoice.payments?.[0]?.batch_id,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [invoices, search, status, user?.role]);

  const openTimeline = async (invoiceId: string) => {
    setTimelineLoading(true);
    setTimeline({ invoice: { invoice_number: 'Loading...' }, events: [] });
    try {
      const response = await invoiceApi.getTimeline(invoiceId);
      setTimeline(response.data);
    } finally {
      setTimelineLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
        <div className="grid md:grid-cols-[1fr_260px] gap-3 p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <label className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
            <Search className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full py-2 bg-transparent outline-none text-sm" placeholder="Invoice, vendor, MPO, material, batch" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
            <option value="">My active invoices</option>
            <option value="__ALL__">All invoices / history</option>
            {statuses.map((item) => <option key={item} value={item}>{String(item).replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <table className="min-w-full text-sm">
            <thead style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <tr>
                {['Invoice', 'Document', 'Vendor', 'MPO / Material', 'Amount', 'Status / SLA', 'Payment', 'Timeline'].map((label) => (
                  <th key={label} className="px-4 py-3 text-left uppercase text-xs">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.map((invoice) => (
                <tr key={invoice.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="px-4 py-3 font-medium">{invoice.invoice_number}<div className="text-xs" style={{ color: 'var(--text-muted)' }}>Revision {invoice.revision || 1}</div></td>
                  <td className="px-4 py-3">{invoice.invoice_type}</td>
                  <td className="px-4 py-3">{invoice.vendor?.name || invoice.vendor_name_raw}</td>
                  <td className="px-4 py-3">{invoice.mpo_number || '-'}<div className="text-xs" style={{ color: 'var(--text-muted)' }}>{invoice.material_code || invoice.material_name || ''}</div></td>
                  <td className="px-4 py-3 font-semibold">{invoice.currency} {Number(invoice.total_amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-full text-xs" style={{ background: 'var(--bg-elevated)' }}>{String(invoice.status).replace(/_/g, ' ')}</span>
                    {invoice.status === 'ON_HOLD' && invoice.hold_confirmation_due_at && (() => {
                      const remaining = new Date(invoice.hold_confirmation_due_at).getTime() - Date.now();
                      const overdue = remaining < 0 && !invoice.hold_confirmed_at;
                      const hours = Math.max(0, Math.ceil(Math.abs(remaining) / 3600000));
                      return <div className="mt-2 text-xs" style={{ color: overdue ? 'var(--accent-red)' : invoice.hold_confirmed_at ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                        <div className="flex items-center gap-1">{invoice.hold_confirmed_at ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{invoice.hold_confirmed_at ? 'Hold confirmed' : overdue ? `Confirmation overdue by ${hours}h` : `${hours}h to confirm`}</div>
                        {!invoice.hold_confirmed_at && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'].includes(user?.role || '') && <button onClick={() => confirmHold(invoice.id)} className="underline mt-1">Confirm hold</button>}
                      </div>;
                    })()}
                  </td>
                  <td className="px-4 py-3">{invoice.payments?.[0]?.status || (invoice.status === 'PENDING_ACCOUNTING' ? 'APPROVED FOR PAYMENT' : '-')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openTimeline(invoice.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs" style={{ background: 'var(--bg-elevated)', color: 'var(--accent-purple)' }}>
                      <Clock className="h-3 w-3" strokeWidth={1.75} />
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>{status ? 'No invoices match the filters.' : 'No invoices currently require your action. Use the status filter to view history.'}</td></tr>}
              {loading && <tr><td colSpan={8} className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading repository...</td></tr>}
            </tbody>
          </table>
        </div>

      {timeline && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="p-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h2 className="text-lg font-semibold">Invoice Timeline</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{timeline.invoice?.invoice_number}</p>
              </div>
              <button onClick={() => setTimeline(null)} className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-elevated)' }}>Close</button>
            </div>
            <div className="p-5 space-y-3">
              {timelineLoading && <div style={{ color: 'var(--text-muted)' }}>Loading timeline...</div>}
              {!timelineLoading && timeline.events?.map((event: any) => (
                <div key={event.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{String(event.title).replace(/_/g, ' ')}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(event.created_at).toLocaleString()}</div>
                  </div>
                  {event.detail && <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{event.detail}</div>}
                  <div className="flex flex-wrap gap-2 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {event.actor && <span>By {event.actor}</span>}
                    {event.status && <span>{String(event.status).replace(/_/g, ' ')}</span>}
                    <span>{event.type}</span>
                  </div>
                </div>
              ))}
              {!timelineLoading && !timeline.events?.length && <div style={{ color: 'var(--text-muted)' }}>No timeline events yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
