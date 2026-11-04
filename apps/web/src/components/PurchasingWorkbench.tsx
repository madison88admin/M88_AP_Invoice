import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpenCheck, Eye, GitCompare, ScanSearch, ShoppingCart, X } from 'lucide-react';
import api, { invoiceApi } from '../lib/api';

const fmt = (value: any) => (value == null || value === '' ? '-' : String(value));

export default function PurchasingWorkbench() {
  const [tab, setTab] = useState<'lines' | 'extraction' | 'duplicates' | 'learning'>('lines');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [pairs, setPairs] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [learningRules, setLearningRules] = useState<any[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);

  const load = async () => {
    const [queue, duplicates] = await Promise.all([
      api.get('/api/workbench/queue'),
      api.get('/api/workbench/duplicates'),
    ]);
    setInvoices(queue.data);
    setPairs(duplicates.data);
    api.get('/api/workbench/learning-rules?status=pending')
      .then((response) => setLearningRules(response.data))
      .catch(() => setLearningRules([]));
  };

  useEffect(() => {
    load().catch(() => setMessage('Unable to load workbench.'));
  }, []);

  const editLine = async (line: any, field: string) => {
    const value = prompt(`Correct ${field}`, fmt(line[field]) === '-' ? '' : fmt(line[field]));
    if (value == null) return;
    await api.patch(`/api/workbench/lines/${line.id}`, {
      [field]: ['quantity', 'selling_quantity', 'unit_price', 'line_amount', 'received_quantity', 'accepted_quantity'].includes(field) ? Number(value) : value,
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
    setMessage(`${field.replace(/_/g, ' ')} corrected and queued for manager approval before vendor learning.`);
    await load();
  };

  const resolve = async (pair: any, resolution: string) => {
    try {
      await api.post(`/api/workbench/duplicates/${pair.invoice.id}/resolve`, {
        resolution,
        related_invoice_id: pair.match.id,
        note: `Purchasing coordinator reviewed both PDFs and classified as ${resolution}`,
      });
      setMessage(resolution === 'REVISION_OF'
        ? 'Corrected revision activated. The prior invoice is superseded in audit history, and the new document has been revalidated.'
        : 'Duplicate decision saved.');
      await load();
    } catch (error: any) {
      setMessage(error?.response?.data?.error?.message || 'Unable to save the duplicate/revision decision. Review the current invoice states before retrying.');
    }
  };

  const updateLearningRule = async (id: string, action: 'approve' | 'disable') => {
    await api.post(`/api/workbench/learning-rules/${id}/${action}`, action === 'disable' ? { note: 'Disabled in learning review' } : {});
    setMessage(action === 'approve' ? 'Vendor-specific extraction rule approved.' : 'Extraction rule disabled.');
    await load();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap gap-2">
          {([
            ['lines', 'Line Validation', ShoppingCart],
            ['extraction', 'Extraction Review', ScanSearch],
            ['duplicates', 'Duplicate Resolution', GitCompare],
            ['learning', 'Learning Rules', BookOpenCheck],
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
                  {invoice.invoice_number} | {invoice.vendor?.name} | {invoice.mpo_number || invoice.mpo_base_number || 'No MPO'}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {['Line', 'Material', 'MPO / Order', 'Qty', 'Selling Qty', 'Size', 'Ordered', 'Received', 'Accepted', 'Previously Invoiced', 'Receipt Balance', 'Unit Price', 'Amount', 'Extraction', '3-Way Match'].map((heading) => (
                        <th className="p-3 text-left" key={heading}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.invoice_lines.map((line: any) => (
                      <Fragment key={line.id}>
                        <tr style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td className="p-3">{line.line_number}</td>
                          <td className="p-3"><ConfidenceCell line={line} field="material_code" value={line.material_code} onCorrect={() => editLine(line, 'material_code')} onEvidence={setSelectedEvidence} /><small>{fmt(line.material_name)}</small></td>
                          <td className="p-3">{fmt(line.mpo_base_number)}-{fmt(line.mpo_order_sequence)}</td>
                          <td className="p-3"><ConfidenceCell line={line} field="quantity" value={line.quantity} onCorrect={() => editLine(line, 'quantity')} onEvidence={setSelectedEvidence} /></td>
                          <td className="p-3"><ConfidenceCell line={line} field="selling_quantity" value={line.selling_quantity} onCorrect={() => editLine(line, 'selling_quantity')} onEvidence={setSelectedEvidence} /></td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'size')}>{fmt(line.size)}</td>
                          <td className="p-3">{fmt(line.ordered_quantity)}</td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'received_quantity')}>{fmt(line.received_quantity)}</td>
                          <td className="p-3 cursor-pointer" onClick={() => editLine(line, 'accepted_quantity')}>{fmt(line.accepted_quantity)}</td>
                          <td className="p-3">{fmt(line.previously_invoiced_quantity)}</td>
                          <td className="p-3">{fmt(line.remaining_receivable_quantity)}</td>
                          <td className="p-3"><ConfidenceCell line={line} field="unit_price" value={line.unit_price} onCorrect={() => editLine(line, 'unit_price')} onEvidence={setSelectedEvidence} /></td>
                          <td className="p-3"><ConfidenceCell line={line} field="line_amount" value={line.line_amount} onCorrect={() => editLine(line, 'line_amount')} onEvidence={setSelectedEvidence} /></td>
                          <td className="p-3">{fmt(line.extraction_confidence)}%{line.review_required ? <small className="block" style={{ color: 'var(--accent-amber)' }}>Review</small> : null}</td>
                          <td className="p-3">{fmt(line.three_way_match_status)}</td>
                        </tr>
                        {line.tolerance_alerts?.length > 0 && (
                          <tr>
                            <td colSpan={15} className="px-3 pb-3">
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
                {['invoice_number', 'invoice_date', 'total_amount', 'currency', 'mpo_number', 'material_code', 'qty_shipped'].map((field) => {
                  const decision = invoice.field_confidence?.[field];
                  const confidence = decision?.final_confidence ?? decision?.confidence ?? decision;
                  return (
                    <div key={field} className="flex items-center gap-2 p-2 rounded">
                      <button type="button" onClick={() => editField(invoice, field)} className="flex justify-between gap-3 flex-1 text-left hover:opacity-80">
                        <span>{field.replace(/_/g, ' ')}</span>
                        <span>{fmt(invoice[field])} <small style={{ color: Number(confidence) < 80 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>({fmt(confidence)}%)</small></span>
                      </button>
                      <button type="button" title="View source evidence" onClick={() => setSelectedEvidence({ field, value: invoice[field], decision })} className="p-1 rounded" style={{ background: 'var(--bg-elevated)' }}>
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
                <Link className="inline-block mt-3 text-sm" to={`/repository?invoice=${invoice.id}`}>Open invoice and correction history</Link>
              </div>
            ))}
          </div>
        )}

        {tab === 'duplicates' && (
          <div className="space-y-4">
            {pairs.length === 0 ? <div>No unresolved duplicate candidates.</div> : pairs.map((pair: any) => (
              <div key={pair.invoice.id} className="p-5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="mb-4">
                  <h2 className="font-semibold">Review possible duplicate or corrected invoice</h2>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Compare both stored PDFs and the extracted fields before deciding. Choosing “Accept corrected revision” supersedes the old record only when it is still unprotected and in coordinator review.</p>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <Doc title="Flagged document" invoice={pair.invoice} />
                  <Doc title="Existing active invoice" invoice={pair.match} />
                </div>
                <RevisionFieldComparison current={pair.invoice} previous={pair.match} />
                {pair.review && (
                  <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--text-primary)' }}>
                    <div className="font-semibold">Why it was flagged</div>
                    <div>{pair.review.reason || 'Multiple duplicate/revision indicators matched.'}</div>
                    {pair.review.matching_indicators && <pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(pair.review.matching_indicators, null, 2)}</pre>}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-4">
                  {['KEEP_BOTH', 'MARK_DUPLICATE', 'PROFORMA_TO_FINAL', 'REVISION_OF'].map((resolution) => (
                    <button key={resolution} onClick={() => resolve(pair, resolution)} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                      {resolution === 'REVISION_OF' ? 'Accept corrected revision' : resolution.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'learning' && (
          <div className="space-y-3">
            {learningRules.length === 0 ? (
              <div className="p-5 rounded-xl" style={{ background: 'var(--bg-card)' }}>
                No pending vendor learning rules, or your role does not manage rule approvals.
              </div>
            ) : learningRules.map((rule) => (
              <div key={rule.id} className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-semibold">{rule.vendor_name || 'Unknown vendor'}</div>
                    <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{rule.note || 'Manual extraction correction'}</div>
                    <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(rule.corrected_fields, null, 2)}</pre>
                  </div>
                  <div className="flex gap-2 items-start">
                    <button onClick={() => updateLearningRule(rule.id, 'approve')} className="px-3 py-2 rounded-lg" style={{ background: 'var(--accent-green)', color: 'white' }}>Approve for vendor</button>
                    <button onClick={() => updateLearningRule(rule.id, 'disable')} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>Disable</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {selectedEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.65)' }}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-auto rounded-2xl p-5" style={{ background: 'var(--bg-card)' }}>
            <div className="flex justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold">Extraction source evidence</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{selectedEvidence.field}: {fmt(selectedEvidence.value)}</p>
              </div>
              <button onClick={() => setSelectedEvidence(null)}><X className="h-5 w-5" /></button>
            </div>
            <EvidenceDetails evidence={selectedEvidence.evidence || selectedEvidence.decision?.evidence} provenance={selectedEvidence.provenance || selectedEvidence.decision?.provenance} decision={selectedEvidence.decision} />
          </div>
        </div>
      )}
      {message && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }} role="dialog" aria-modal="true" aria-label="Action result">
          <div className="w-full max-w-lg rounded-2xl p-5 shadow-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex justify-between gap-4 items-start">
              <div><h2 className="font-semibold mb-2">Purchasing workbench</h2><p className="text-sm">{message}</p></div>
              <button onClick={() => setMessage('')} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex justify-end mt-5"><button onClick={() => setMessage('')} className="px-4 py-2 rounded-lg" style={{ background: 'var(--accent-purple)', color: 'white' }}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Doc({ title, invoice }: { title: string; invoice: any }) {
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfError, setPdfError] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    invoiceApi.getDocument(invoice.id).then((response) => {
      objectUrl = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      if (active) setPdfUrl(objectUrl);
    }).catch(() => {
      if (active) setPdfError('The stored PDF could not be opened for this invoice.');
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoice.id]);
  return (
    <div>
      <h3 className="font-bold mb-2">{title} — {fmt(invoice.invoice_number)}</h3>
      {pdfUrl ? <iframe title={`${title} PDF`} src={pdfUrl} className="w-full h-[32rem] rounded-lg mb-3" style={{ border: '1px solid var(--border-color)' }} />
        : <div className="h-32 rounded-lg mb-3 flex items-center justify-center text-sm" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>{pdfError || 'Loading stored PDF…'}</div>}
      {[
        ['Invoice', invoice.invoice_number],
        ['Type', invoice.invoice_type],
        ['Vendor', invoice.vendor?.name],
        ['Amount', `${invoice.currency} ${invoice.total_amount}`],
        ['Subtotal', `${invoice.currency} ${invoice.subtotal}`],
        ['Bank charges', `${invoice.currency} ${invoice.bank_charges}`],
        ['MPO', invoice.mpo_number || invoice.mpo_base_number],
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

function RevisionFieldComparison({ current, previous }: { current: any; previous: any }) {
  const fields: Array<[string, string]> = [
    ['Invoice number', 'invoice_number'], ['Vendor', 'vendor_name_raw'], ['Invoice date', 'invoice_date'],
    ['Due date', 'due_date'], ['Currency', 'currency'], ['Total amount', 'total_amount'],
    ['Invoice subtotal', 'subtotal'], ['Bank charges', 'bank_charges'], ['MPO / PO', 'mpo_number'],
    ['Beneficiary', 'beneficiary_name'], ['Bank name', 'bank_name'], ['Account number', 'account_number'],
  ];
  const display = (invoice: any, field: string) => {
    const value = field === 'vendor_name_raw' ? invoice.vendor?.name || invoice.vendor_name_raw : invoice[field];
    if (value == null || value === '') return '-';
    if (field === 'account_number') {
      const digits = String(value).replace(/\s+/g, '');
      return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`;
    }
    if (['total_amount', 'subtotal', 'bank_charges'].includes(field)) return `${invoice.currency || 'USD'} ${value}`;
    if (value instanceof Date || (typeof value === 'string' && field.endsWith('_date'))) return new Date(value).toLocaleDateString();
    return String(value);
  };
  const changed = (field: string) => display(current, field).trim().toLowerCase() !== display(previous, field).trim().toLowerCase();
  return (
    <div className="mt-4 overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
      <h3 className="p-3 font-semibold">Extracted field comparison</h3>
      <table className="w-full text-sm">
        <thead><tr style={{ background: 'var(--bg-elevated)' }}><th className="p-2 text-left">Field</th><th className="p-2 text-left">New PDF</th><th className="p-2 text-left">Existing invoice</th><th className="p-2 text-left">Difference</th></tr></thead>
        <tbody>{fields.map(([label, field]) => (
          <tr key={field} style={{ borderTop: '1px solid var(--border-color)' }}>
            <td className="p-2">{label}</td><td className="p-2">{display(current, field)}</td><td className="p-2">{display(previous, field)}</td>
            <td className="p-2" style={{ color: changed(field) ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{changed(field) ? 'Changed' : 'Same'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ConfidenceCell({ line, field, value, onCorrect, onEvidence }: { line: any; field: string; value: any; onCorrect: () => void; onEvidence: (value: any) => void }) {
  const decision = line.field_confidence?.[field];
  const confidence = Number(decision?.final_confidence ?? decision?.confidence ?? line.extraction_confidence ?? 0);
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="text-left hover:opacity-80" onClick={onCorrect}>
        {fmt(value)} <small style={{ color: confidence < 80 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{confidence ? `${confidence}%` : ''}</small>
      </button>
      <button
        type="button"
        title="View source and engine candidates"
        onClick={() => onEvidence({ field, value, decision, evidence: line.source_evidence?.[field], provenance: line.extraction_provenance?.[field] })}
        className="p-1 rounded"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <Eye className="h-3 w-3" />
      </button>
    </div>
  );
}

function EvidenceDetails({ evidence, provenance, decision }: { evidence: any; provenance: any; decision: any }) {
  const candidates = decision?.candidates || provenance?.other_candidates || [];
  return (
    <div className="space-y-4 text-sm">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}><strong>Selected engine</strong><div>{provenance?.chosen_engine || decision?.selected_engine || '-'}</div></div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}><strong>Confidence</strong><div>{decision?.final_confidence ?? '-'}%</div></div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}><strong>Page / line</strong><div>{evidence?.page || '-'} / {evidence?.line || '-'}</div></div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)' }}><strong>Matched label</strong><div>{evidence?.matched_label || '-'}</div></div>
      </div>
      {evidence?.raw_text_snippet && <div className="p-4 rounded-lg font-mono whitespace-pre-wrap" style={{ background: 'var(--bg-elevated)' }}>{evidence.raw_text_snippet}</div>}
      {evidence?.bounding_box && <div>Bounding box: {JSON.stringify(evidence.bounding_box)}</div>}
      <div><strong>Decision reason</strong><p>{provenance?.selection_reason || decision?.provenance?.selection_reason || '-'}</p></div>
      {candidates.length > 0 && (
        <div><strong>Other candidates</strong><pre className="mt-2 p-3 rounded-lg overflow-auto" style={{ background: 'var(--bg-elevated)' }}>{JSON.stringify(candidates, null, 2)}</pre></div>
      )}
    </div>
  );
}
