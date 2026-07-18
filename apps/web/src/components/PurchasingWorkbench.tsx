import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, GitCompare, ScanSearch, ShoppingCart } from 'lucide-react';
import api from '../lib/api';

const fmt = (value: any) => (value == null || value === '' ? '-' : String(value));

export default function PurchasingWorkbench() {
  const [tab, setTab] = useState<'lines' | 'extraction' | 'duplicates'>('lines');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pairs, setPairs] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [queue, duplicates] = await Promise.all([
      api.get('/api/workbench/queue'),
      api.get('/api/workbench/duplicates'),
    ]);
    setInvoices(queue.data);
    setPairs(duplicates.data);
  };

  useEffect(() => {
    load().catch(() => setMessage('Unable to load workbench.'));
  }, []);

  const editLine = async (line: any, field: string) => {
    const value = prompt(`Correct ${field}`, fmt(line[field]) === '-' ? '' : fmt(line[field]));
    if (value == null) return;
    await api.patch(`/api/workbench/lines/${line.id}`, {
      [field]: ['quantity', 'selling_quantity', 'unit_price', 'line_amount'].includes(field) ? Number(value) : value,
    });
    setMessage('Correction saved with audit history.');
    await load();
  };

  const editField = async (invoice: any, field: string) => {
    const value = prompt(`Correct ${field}`, fmt(invoice[field]) === '-' ? '' : fmt(invoice[field]));
    if (value == null) return;
    const corrected = ['total_amount', 'qty_shipped'].includes(field) ? Number(value) : value;
    await api.patch(`/api/invoices/${invoice.id}`, { [field]: corrected });
    await api.post(`/api/invoices/${invoice.id}/correct-extraction`, {
      vendor_name: invoice.vendor?.name,
      original_fields: { [field]: invoice[field] },
      corrected_fields: { [field]: corrected },
      note: 'Field-confidence workbench correction',
    });
    setMessage(`${field.replace(/_/g, ' ')} corrected and added to extraction learning history.`);
    await load();
  };

  const resolve = async (pair: any, resolution: string) => {
    await api.post(`/api/workbench/duplicates/${pair.invoice.id}/resolve`, {
      resolution,
      related_invoice_id: pair.match.id,
      note: `Resolved in side-by-side workbench as ${resolution}`,
    });
    setMessage('Duplicate decision saved.');
    await load();
  };

  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 rounded-lg" style={{ background: 'var(--bg-card)' }}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Purchasing & Extraction Workbench</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Validate lines, correct OCR fields, track MPO consumption, and resolve document relationships.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['lines', 'Line Validation', ShoppingCart],
            ['extraction', 'Extraction Review', ScanSearch],
            ['duplicates', 'Duplicate Resolution', GitCompare],
          ] as any[]).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="px-4 py-2 rounded-xl flex gap-2 items-center"
              style={{ background: tab === id ? 'var(--accent-purple)' : 'var(--bg-card)', color: tab === id ? 'white' : 'var(--text-primary)' }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {message && (
          <div className="p-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            {message}
          </div>
        )}

        {tab === 'lines' && (
          <div className="space-y-4">
            {invoices.filter((invoice) => invoice.invoice_lines.length).map((invoice) => (
              <div key={invoice.id} className="rounded-xl overflow-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="p-4 font-semibold">
                  {invoice.invoice_number} | {invoice.vendor?.name} | {invoice.mpo_number || 'No MPO'}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {['Line', 'Material', 'MPO / Order', 'Qty', 'Selling Qty', 'Ordered', 'Total Invoiced', 'Remaining', 'Unit Price', 'Amount', 'Match'].map((heading) => (
                        <th className="p-3 text-left" key={heading}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.invoice_lines.map((line: any) => (
                      <Fragment key={line.id}>
                        <tr style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td className="p-3">{line.line_number}</td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'material_code')}>{fmt(line.material_code)}<br /><small>{fmt(line.material_name)}</small></td>
                          <td className="p-3">{fmt(line.mpo_base_number)}-{fmt(line.mpo_order_sequence)}</td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'quantity')}>{fmt(line.quantity)}</td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'selling_quantity')}>{fmt(line.selling_quantity)}</td>
                          <td className="p-3">{fmt(line.ordered_quantity)}</td>
                          <td className="p-3">{fmt(line.invoiced_quantity)}</td>
                          <td className="p-3">{fmt(line.remaining_quantity)}</td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'unit_price')}>{fmt(line.unit_price)}</td>
                          <td className="p-3">{fmt(line.line_amount)}</td>
                          <td className="p-3">{fmt(line.match_status)}</td>
                        </tr>
                        {line.tolerance_alerts?.length > 0 && (
                          <tr>
                            <td colSpan={11} className="px-3 pb-3">
                              <div className="flex flex-wrap gap-2">
                                {line.tolerance_alerts.map((alert: any) => (
                                  <span
                                    key={alert.type}
                                    className="px-2 py-1 rounded-lg text-xs"
                                    style={{
                                      background: alert.severity === 'error' ? 'color-mix(in srgb, var(--accent-red) 12%, transparent)' : 'color-mix(in srgb, var(--accent-amber) 12%, transparent)',
                                      color: alert.severity === 'error' ? 'var(--accent-red)' : 'var(--accent-amber)',
                                      border: `1px solid ${alert.severity === 'error' ? 'var(--accent-red)' : 'var(--accent-amber)'}`,
                                    }}
                                  >
                                    {alert.message}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {tab === 'extraction' && (
          <div className="grid md:grid-cols-2 gap-4">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="font-semibold mb-3">{invoice.invoice_number} | {invoice.vendor?.name}</div>
                {['invoice_number', 'invoice_date', 'total_amount', 'currency', 'mpo_number', 'material_code', 'qty_shipped'].map((field) => (
                  <button type="button" onClick={() => editField(invoice, field)} key={field} className="flex justify-between gap-3 p-2 w-full text-left rounded hover:opacity-80">
                    <span>{field.replace(/_/g, ' ')}</span>
                    <span>{fmt(invoice[field])} <small style={{ color: 'var(--text-muted)' }}>({fmt(invoice.field_confidence?.[field]?.confidence || invoice.field_confidence?.[field])}%)</small></span>
                  </button>
                ))}
                <Link className="inline-block mt-3 text-sm" to={`/repository?invoice=${invoice.id}`}>Open invoice and correction history</Link>
              </div>
            ))}
          </div>
        )}

        {tab === 'duplicates' && (
          <div className="space-y-4">
            {pairs.length === 0 ? <div>No unresolved duplicate candidates.</div> : pairs.map((pair: any) => (
              <div key={pair.invoice.id} className="p-5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="grid md:grid-cols-2 gap-6">
                  <Doc title="Flagged document" invoice={pair.invoice} />
                  <Doc title="Possible match" invoice={pair.match} />
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {['KEEP_BOTH', 'MARK_DUPLICATE', 'PROFORMA_TO_FINAL', 'REVISION_OF'].map((resolution) => (
                    <button key={resolution} onClick={() => resolve(pair, resolution)} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                      {resolution.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Doc({ title, invoice }: { title: string; invoice: any }) {
  return (
    <div>
      <h3 className="font-bold mb-2">{title}</h3>
      {[
        ['Invoice', invoice.invoice_number],
        ['Type', invoice.invoice_type],
        ['Vendor', invoice.vendor?.name],
        ['Amount', `${invoice.currency} ${invoice.total_amount}`],
        ['MPO', invoice.mpo_number],
        ['Material', invoice.material_code],
        ['Revision', invoice.revision],
      ].map(([label, value]) => (
        <div className="flex justify-between gap-4 p-2" key={label}>
          <span>{label}</span>
          <strong>{fmt(value)}</strong>
        </div>
      ))}
    </div>
  );
}
