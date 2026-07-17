import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Archive, Search } from 'lucide-react';
import { invoiceApi } from '../lib/api';

export default function InvoiceRepository() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    invoiceApi.getAll()
      .then((response) => setInvoices(response.data || []))
      .finally(() => setLoading(false));
  }, []);

  const statuses = useMemo(() => Array.from(new Set(invoices.map(i => i.status))).sort(), [invoices]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter(invoice => {
      if (status && invoice.status !== status) return false;
      if (!term) return true;
      return [
        invoice.invoice_number, invoice.vendor?.name, invoice.vendor_name_raw,
        invoice.mpo_number, invoice.material_code, invoice.material_name,
        invoice.payments?.[0]?.batch_id,
      ].some(value => String(value || '').toLowerCase().includes(term));
    });
  }, [invoices, search, status]);

  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <div className="max-w-7xl mx-auto space-y-5">
        <header className="flex items-center gap-3">
          <Link to="/" className="p-2 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg-card)' }}><ArrowLeft className="h-5 w-5" /></Link>
          <Archive className="h-6 w-6" style={{ color: 'var(--accent-purple)' }} />
          <div>
            <h1 className="text-2xl font-bold">Invoice Repository</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Read-only organization-wide invoice lifecycle storage</p>
          </div>
        </header>

        <div className="grid md:grid-cols-[1fr_260px] gap-3 p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <label className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}>
            <Search className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} className="w-full py-2 bg-transparent outline-none text-sm" placeholder="Invoice, vendor, MPO, material, batch" />
          </label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
            <option value="">All lifecycle statuses</option>
            {statuses.map(item => <option key={item} value={item}>{String(item).replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        <div className="overflow-x-auto rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <table className="min-w-full text-sm">
            <thead style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}><tr>
              {['Invoice', 'Document', 'Vendor', 'MPO / Material', 'Amount', 'Status', 'Payment'].map(label => <th key={label} className="px-4 py-3 text-left uppercase text-xs">{label}</th>)}
            </tr></thead>
            <tbody>
              {!loading && filtered.map(invoice => <tr key={invoice.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td className="px-4 py-3 font-medium">{invoice.invoice_number}<div className="text-xs" style={{ color: 'var(--text-muted)' }}>Revision {invoice.revision || 1}</div></td>
                <td className="px-4 py-3">{invoice.invoice_type}</td>
                <td className="px-4 py-3">{invoice.vendor?.name || invoice.vendor_name_raw}</td>
                <td className="px-4 py-3">{invoice.mpo_number || '—'}<div className="text-xs" style={{ color: 'var(--text-muted)' }}>{invoice.material_code || invoice.material_name || ''}</div></td>
                <td className="px-4 py-3 font-semibold">{invoice.currency} {Number(invoice.total_amount || 0).toLocaleString()}</td>
                <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-xs" style={{ background: 'var(--bg-elevated)' }}>{String(invoice.status).replace(/_/g, ' ')}</span></td>
                <td className="px-4 py-3">{invoice.payments?.[0]?.status || (invoice.status === 'PENDING_ACCOUNTING' ? 'APPROVED FOR PAYMENT' : '—')}</td>
              </tr>)}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>No invoices match the filters.</td></tr>}
              {loading && <tr><td colSpan={7} className="p-10 text-center" style={{ color: 'var(--text-muted)' }}>Loading repository…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
