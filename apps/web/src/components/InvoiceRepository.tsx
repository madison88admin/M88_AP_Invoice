import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Archive, Clock, Search } from 'lucide-react';
import { invoiceApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { isInvoiceActionableForRole } from '../lib/roleAccess';

export default function InvoiceRepository() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [category, setCategory] = useState('');
  const [invoiceType, setInvoiceType] = useState('');
  const [brand, setBrand] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [agingBucket, setAgingBucket] = useState('');
  const [urgentDue, setUrgentDue] = useState(false);
  const [timeline, setTimeline] = useState<any | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  useEffect(() => {
    invoiceApi.getAll()
      .then((response) => setInvoices(response.data || []))
      .finally(() => setLoading(false));
  }, []);

  const statuses = useMemo(() => Array.from(new Set(invoices.map((invoice) => invoice.status))).sort(), [invoices]);
  const vendors = useMemo(() => Array.from(new Map<string, string>(invoices.map((i) => [String(i.vendor_id || i.vendor?.id || ''), String(i.vendor?.name || i.vendor_name_raw || '')] as [string, string]).filter(([id]) => id)).entries()), [invoices]);
  const categories = useMemo(() => Array.from(new Set(invoices.map((i) => i.category).filter(Boolean))).sort(), [invoices]);
  const invoiceTypes = useMemo(() => Array.from(new Set(invoices.map((i) => i.invoice_type).filter(Boolean))).sort(), [invoices]);
  const brands = useMemo(() => Array.from(new Set(invoices.map((i) => i.brand || i.brand_code).filter(Boolean))).sort(), [invoices]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const hasDetailedFilter = Boolean(term || vendorId || category || invoiceType || brand || dateFrom || dateTo || agingBucket || urgentDue);
    return invoices.filter((invoice) => {
      // Keep the default view focused on active work. Once a user applies a
      // detailed filter, search the full role-visible repository so historical
      // invoices can actually be found by vendor, date, aging, etc.
      if (!status && !hasDetailedFilter && !isInvoiceActionableForRole(invoice, user?.role || '')) return false;
      if (status && status !== '__ALL__' && invoice.status !== status) return false;
      if (vendorId && String(invoice.vendor_id || invoice.vendor?.id) !== vendorId) return false;
      if (category && invoice.category !== category) return false;
      if (invoiceType && invoice.invoice_type !== invoiceType) return false;
      if (brand && invoice.brand !== brand && invoice.brand_code !== brand) return false;
      const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;
      if (dateFrom && (!invoiceDate || invoiceDate < new Date(`${dateFrom}T00:00:00`))) return false;
      if (dateTo && (!invoiceDate || invoiceDate > new Date(`${dateTo}T23:59:59`))) return false;
      if (agingBucket || urgentDue) {
        const due = invoice.due_date ? new Date(invoice.due_date) : null;
        const days = due ? Math.floor((Date.now() - due.getTime()) / 86400000) : null;
        if (urgentDue && (!due || days! < -2 || days! > 0)) return false;
        if (agingBucket === 'current' && (days == null || days > 0)) return false;
        if (agingBucket === '1-30' && (days == null || days < 1 || days > 30)) return false;
        if (agingBucket === '31-60' && (days == null || days < 31 || days > 60)) return false;
        if (agingBucket === '60+' && (days == null || days < 61)) return false;
      }
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
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <label className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
            <Search className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full py-2 bg-transparent outline-none text-sm" placeholder="Invoice, vendor, MPO, material, batch" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
            <option value="">My active invoices</option>
            <option value="__ALL__">All invoices / history</option>
            {statuses.map((item) => <option key={item} value={item}>{String(item).replace(/_/g, ' ')}</option>)}
          </select>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="px-3 py-2 rounded-xl text-sm"><option value="">All vendors</option>{vendors.map(([id, name]) => <option key={String(id)} value={String(id)}>{String(name)}</option>)}</select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 rounded-xl text-sm"><option value="">All categories</option>{categories.map((v) => <option key={String(v)} value={String(v)}>{String(v).replace(/_/g, ' ')}</option>)}</select>
          <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} className="px-3 py-2 rounded-xl text-sm"><option value="">All invoice types</option>{invoiceTypes.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}</select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="px-3 py-2 rounded-xl text-sm"><option value="">All brands</option>{brands.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}</select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2 rounded-xl text-sm" aria-label="Invoice date from" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2 rounded-xl text-sm" aria-label="Invoice date to" />
          <select value={agingBucket} onChange={(e) => setAgingBucket(e.target.value)} className="px-3 py-2 rounded-xl text-sm"><option value="">All aging</option><option value="current">Current</option><option value="1-30">1–30 days</option><option value="31-60">31–60 days</option><option value="60+">60+ days</option></select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"><input type="checkbox" checked={urgentDue} onChange={(e) => setUrgentDue(e.target.checked)} /> Urgent due</label>
        </div>

        <div className="overflow-x-auto rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <table className="min-w-full text-sm">
            <thead style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <tr>
                {['Invoice', 'Document', 'Vendor', 'MPO / Material', 'Amount', 'Status', 'Payment', 'Timeline'].map((label) => (
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
                  <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-xs" style={{ background: 'var(--bg-elevated)' }}>{String(invoice.status).replace(/_/g, ' ')}</span></td>
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
