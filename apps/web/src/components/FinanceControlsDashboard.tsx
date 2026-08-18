import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';

type Finding = { id: string; code: string; severity: string; detail: string; status: string; invoice_id?: string };
type Run = { id: string; run_type: string; status: string; started_at: string; summary?: { total?: number; critical?: number; high?: number }; findings: Finding[] };

export default function FinanceControlsDashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => setRuns((await api.get('/api/finance-controls/runs')).data), []);
  useEffect(() => { void load(); }, [load]);
  const execute = async (path: string) => { setBusy(path); try { await api.post(path); await load(); } finally { setBusy(''); } };
  const act = async (id: string, action: string) => {
    const note = action === 'RESOLVE' ? window.prompt('Resolution note (required):') : undefined;
    if (action === 'RESOLVE' && !note) return;
    await api.patch(`/api/finance-controls/findings/${id}`, { action, note });
    await load();
  };
  const latest = runs[0];
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-3">
      <button className="px-4 py-2 rounded-lg bg-amber-500 text-white" disabled={!!busy} onClick={() => execute('/api/finance-controls/anomaly-scan')}>Run anomaly scan</button>
      <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" disabled={!!busy} onClick={() => execute('/api/finance-controls/reconcile')}>Run four-way reconciliation</button>
      <button className="px-4 py-2 rounded-lg border" onClick={load}>Refresh</button>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {['total', 'critical', 'high'].map(key => <div key={key} className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}><div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>{key}</div><div className="text-2xl font-semibold">{latest?.summary?.[key as keyof typeof latest.summary] || 0}</div></div>)}
      <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}><div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Last run</div><div className="text-sm font-medium">{latest ? new Date(latest.started_at).toLocaleString() : 'None'}</div></div>
    </div>
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)' }}>
      <div className="p-4 font-semibold">Actionable findings</div>
      {(latest?.findings || []).length === 0 ? <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>No findings in the latest run.</div> : latest.findings.map(f => <div key={f.id} className="p-4 border-t flex gap-4"><span className="font-semibold min-w-20">{f.severity}</span><div className="flex-1"><div className="font-medium">{f.code} <span className="text-xs">({f.status})</span></div><div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{f.detail}</div><div className="flex gap-2 mt-2">{f.status === 'OPEN' && <button className="text-xs underline" onClick={() => act(f.id, 'ACKNOWLEDGE')}>Acknowledge</button>}{f.status !== 'RESOLVED' && <button className="text-xs underline" onClick={() => act(f.id, 'RESOLVE')}>Resolve</button>}{f.status === 'RESOLVED' && <button className="text-xs underline" onClick={() => act(f.id, 'REOPEN')}>Reopen</button>}</div></div></div>)}
    </div>
  </div>;
}
