import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { AlertTriangle, CheckCircle2, X, Filter, RefreshCw, Loader2, Clock, User, FileText, RotateCcw, Flag, CircleDot } from 'lucide-react';

type Finding = {
  id: string;
  run_id: string;
  code: string;
  severity: string;
  detail: string;
  status: string;
  invoice_id?: string | null;
  payment_id?: string | null;
  assigned_to?: string | null;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  reopened_by?: string | null;
  escalated_to?: string | null;
  escalated_at?: string | null;
  occurrence_count?: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  created_at: string;
};

type Run = {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  summary?: { total?: number; critical?: number; high?: number };
  findings: Finding[];
};

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'var(--accent-red)',
  HIGH: 'var(--accent-amber)',
  WARNING: 'var(--accent-blue)',
};

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'var(--accent-red)',
  ASSIGNED: 'var(--accent-amber)',
  ACKNOWLEDGED: 'var(--accent-blue)',
  RESOLVED: 'var(--accent-lime)',
  ESCALATED: 'var(--accent-violet)',
};

const STATUS_OPTIONS = ['OPEN', 'ASSIGNED', 'ACKNOWLEDGED', 'RESOLVED', 'ESCALATED'];
const SEVERITY_OPTIONS = ['CRITICAL', 'HIGH', 'WARNING'];

const fmtDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function FinanceControlsDashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [acting, setActing] = useState('');

  const load = useCallback(async () => setRuns((await api.get('/api/finance-controls/runs')).data), []);
  useEffect(() => { void load(); }, [load]);

  // Keep the selected run valid — after a fresh scan/reconcile, jump to the newest run.
  useEffect(() => {
    if (!runs.some((r) => r.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id || '');
    }
  }, [runs, selectedRunId]);

  const execute = async (path: string) => { setBusy(path); try { await api.post(path); await load(); } finally { setBusy(''); } };

  const act = async (id: string, action: string) => {
    let note: string | undefined;
    if (action === 'RESOLVE') {
      note = window.prompt('Resolution note (required):', '') ?? undefined;
      if (!note?.trim()) return;
    } else if (action === 'ASSIGN') {
      const target = window.prompt('Assign to (user name or email):', '') ?? '';
      if (!target.trim()) return;
      await api.patch(`/api/finance-controls/findings/${id}`, { action, assigned_to: target.trim() });
      await load();
      return;
    } else if (action === 'ESCALATE') {
      const target = window.prompt('Escalate to (role or user):', '') ?? '';
      if (!target.trim()) return;
      await api.patch(`/api/finance-controls/findings/${id}`, { action, escalate_to: target.trim() });
      await load();
      return;
    }
    setActing(id);
    try {
      await api.patch(`/api/finance-controls/findings/${id}`, { action, note });
      await load();
    } finally {
      setActing('');
    }
  };

  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];
  const baseFindings = selectedRun?.findings || [];

  const codes = useMemo(() => [...new Set(baseFindings.map((f) => f.code))].sort(), [baseFindings]);

  const filtered = baseFindings.filter((f) =>
    (!sevFilter || f.severity === sevFilter) &&
    (!statusFilter || f.status === statusFilter) &&
    (!codeFilter || f.code === codeFilter)
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { OPEN: 0, ASSIGNED: 0, ACKNOWLEDGED: 0, RESOLVED: 0, ESCALATED: 0 };
    for (const f of baseFindings) counts[f.status] = (counts[f.status] || 0) + 1;
    return counts;
  }, [baseFindings]);

  const sevCounts = useMemo(() => {
    const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, WARNING: 0 };
    for (const f of baseFindings) counts[f.severity] = (counts[f.severity] || 0) + 1;
    return counts;
  }, [baseFindings]);

  const clearFilters = () => { setSevFilter(''); setStatusFilter(''); setCodeFilter(''); };

  const activeActions = (f: Finding) => {
    const actions: Array<{ key: string; label: string; icon?: any }> = [];
    if (f.status === 'OPEN' || f.status === 'ASSIGNED') actions.push({ key: 'ACKNOWLEDGE', label: 'Acknowledge' });
    if (f.status !== 'RESOLVED') {
      if (!f.assigned_to) actions.push({ key: 'ASSIGN', label: 'Assign' });
      actions.push({ key: 'RESOLVE', label: 'Resolve' });
      if (f.status !== 'ESCALATED') actions.push({ key: 'ESCALATE', label: 'Escalate' });
    }
    if (f.status === 'RESOLVED') actions.push({ key: 'REOPEN', label: 'Reopen' });
    return actions;
  };

  return (
    <div className="space-y-5">
      {/* Actions + run selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <button
            className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--accent-amber)' }}
            disabled={!!busy}
            onClick={() => execute('/api/finance-controls/anomaly-scan')}
          >
            {busy === '/api/finance-controls/anomaly-scan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
            Run anomaly scan
          </button>
          <button
            className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--accent-blue)' }}
            disabled={!!busy}
            onClick={() => execute('/api/finance-controls/reconcile')}
          >
            {busy === '/api/finance-controls/reconcile' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run four-way reconciliation
          </button>
          <button className="px-4 py-2 rounded-lg border text-sm" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <select
          value={selectedRunId}
          onChange={(e) => setSelectedRunId(e.target.value)}
          className="rounded-xl text-sm px-3 py-2 focus:outline-none"
          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
        >
          {runs.length === 0 && <option value="">No runs yet</option>}
          {runs.map((r, i) => (
            <option key={r.id} value={r.id}>
              {i === 0 ? 'Latest · ' : ''}{r.run_type.replace(/_/g, ' ')} · {fmtDate(r.started_at)} ({r.findings.length} findings)
            </option>
          ))}
        </select>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Total</div>
          <div className="text-2xl font-semibold">{baseFindings.length}</div>
        </div>
        {SEVERITY_OPTIONS.map((sev) => (
          <div key={sev} className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: sevCounts[sev] ? SEV_COLOR[sev] : undefined }}>
            <div className="text-xs uppercase flex items-center gap-1.5" style={{ color: sevCounts[sev] ? SEV_COLOR[sev] : 'var(--text-muted)' }}>
              <span className="h-2 w-2 rounded-full inline-block" style={{ background: sevCounts[sev] ? SEV_COLOR[sev] : 'var(--border-color)' }} />
              {sev}
            </div>
            <div className="text-2xl font-semibold" style={{ color: sevCounts[sev] ? SEV_COLOR[sev] : undefined }}>{sevCounts[sev]}</div>
          </div>
        ))}
        <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Open</div>
          <div className="text-2xl font-semibold">{statusCounts.OPEN + statusCounts.ASSIGNED}</div>
        </div>
        <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Resolved</div>
          <div className="text-2xl font-semibold" style={{ color: 'var(--accent-lime)' }}>{statusCounts.RESOLVED}</div>
        </div>
        <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}>
          <div className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Last run</div>
          <div className="text-sm font-medium">{selectedRun ? `${selectedRun.run_type.replace(/_/g, ' ')} · ${fmtDate(selectedRun.started_at)}` : 'None'}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border" style={{ background: 'var(--bg-card)' }}>
        <Filter className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
        <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="rounded-lg text-sm px-3 py-1.5 focus:outline-none" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
          <option value="">All severities</option>
          {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg text-sm px-3 py-1.5 focus:outline-none" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} className="rounded-lg text-sm px-3 py-1.5 focus:outline-none" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
          <option value="">All codes</option>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(sevFilter || statusFilter || codeFilter) && (
          <button className="text-xs underline" style={{ color: 'var(--accent-blue)' }} onClick={clearFilters}>Clear filters</button>
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{filtered.length} of {baseFindings.length} findings</span>
      </div>

      {/* Findings list */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        <div className="p-4 font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
          Actionable findings
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-sm flex flex-col items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <CheckCircle2 className="h-8 w-8" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.5} />
            {baseFindings.length === 0 ? 'No findings in the selected run.' : 'No findings match your filters.'}
          </div>
        ) : (
          filtered.map((f) => {
            const sevColor = SEV_COLOR[f.severity] || 'var(--text-muted)';
            const isSelected = selectedFinding?.id === f.id;
            return (
              <div
                key={f.id}
                onClick={() => setSelectedFinding(f)}
                className="p-4 border-t cursor-pointer transition-colors hover:opacity-90"
                style={{ borderColor: 'var(--border-subtle)', background: isSelected ? 'color-mix(in srgb, var(--accent-blue) 6%, transparent)' : undefined }}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${sevColor} 14%, transparent)`, color: sevColor }}>
                    <CircleDot className="h-3 w-3" strokeWidth={2} />
                    {f.severity}
                  </span>
                  <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{f.code}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[f.status] || 'var(--text-muted)'} 12%, transparent)`, color: STATUS_COLOR[f.status] || 'var(--text-muted)' }}>
                    {f.status.replace(/_/g, ' ')}
                  </span>
                  {f.invoice_id && <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-subtle)' }}><FileText className="h-3 w-3" strokeWidth={1.75} /> {f.invoice_id.slice(0, 8)}</span>}
                  <span className="ml-auto text-[11px]" style={{ color: 'var(--text-subtle)' }}>{fmtDate(f.last_seen_at || f.created_at)}</span>
                </div>
                <p className="text-sm mt-1.5" style={{ color: 'var(--text-secondary)' }}>{f.detail}</p>
                <div className="flex gap-3 mt-2">
                  {activeActions(f).map((a) => (
                    <button
                      key={a.key}
                      onClick={(e) => { e.stopPropagation(); void act(f.id, a.key); }}
                      disabled={acting === f.id}
                      className="text-xs underline"
                      style={{ color: 'var(--accent-blue)' }}
                    >
                      {acting === f.id ? 'Working...' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detail panel */}
      {selectedFinding && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }} onClick={() => setSelectedFinding(null)}>
          <div
            className="w-full max-w-md h-full overflow-y-auto p-6"
            style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedFinding.code}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${SEV_COLOR[selectedFinding.severity] || 'var(--text-muted)'} 14%, transparent)`, color: SEV_COLOR[selectedFinding.severity] || 'var(--text-muted)' }}>
                    {selectedFinding.severity}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[selectedFinding.status] || 'var(--text-muted)'} 12%, transparent)`, color: STATUS_COLOR[selectedFinding.status] || 'var(--text-muted)' }}>
                    {selectedFinding.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedFinding(null)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>{selectedFinding.detail}</p>

            <div className="mt-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-[10px] uppercase flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><FileText className="h-3 w-3" strokeWidth={1.75} /> Invoice</div>
                  <div className="font-medium mt-0.5 break-all" style={{ color: 'var(--text-primary)' }}>{selectedFinding.invoice_id ? selectedFinding.invoice_id.slice(0, 8) + '…' : '—'}</div>
                </div>
                <div className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-[10px] uppercase flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><CircleDot className="h-3 w-3" strokeWidth={1.75} /> Payment</div>
                  <div className="font-medium mt-0.5 break-all" style={{ color: 'var(--text-primary)' }}>{selectedFinding.payment_id ? selectedFinding.payment_id.slice(0, 8) + '…' : '—'}</div>
                </div>
              </div>

              {[
                ['First seen', fmtDate(selectedFinding.first_seen_at)],
                ['Last seen', fmtDate(selectedFinding.last_seen_at)],
                ['Created', fmtDate(selectedFinding.created_at)],
                ['Occurrences', String(selectedFinding.occurrence_count ?? 1)],
                ['Assigned to', selectedFinding.assigned_to || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
                  <span className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    {label === 'Assigned to' && <User className="h-3 w-3" strokeWidth={1.75} />}
                    {label === 'First seen' || label === 'Last seen' || label === 'Created' ? <Clock className="h-3 w-3" strokeWidth={1.75} /> : null}
                    {label}
                  </span>
                  <span className="font-medium text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}

              {selectedFinding.acknowledged_at && (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Acknowledged by {selectedFinding.acknowledged_by || '—'} · {fmtDate(selectedFinding.acknowledged_at)}
                </div>
              )}
              {selectedFinding.escalated_at && (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Escalated to {selectedFinding.escalated_to || '—'} · {fmtDate(selectedFinding.escalated_at)}
                </div>
              )}
              {selectedFinding.resolved_at && (
                <div className="p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-lime) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-lime) 20%, transparent)' }}>
                  <div className="text-[10px] uppercase mb-1" style={{ color: 'var(--accent-lime)' }}>Resolution</div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedFinding.resolution_note || 'No note recorded.'}</p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>by {selectedFinding.resolved_by || '—'} · {fmtDate(selectedFinding.resolved_at)}</p>
                </div>
              )}
            </div>

            <div className="mt-6 space-y-2">
              {activeActions(selectedFinding).map((a) => (
                <button
                  key={a.key}
                  onClick={() => void act(selectedFinding.id, a.key)}
                  disabled={acting === selectedFinding.id}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={a.key === 'RESOLVE'
                    ? { background: 'var(--accent-lime)', color: 'var(--text-primary)' }
                    : a.key === 'REOPEN'
                      ? { background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }
                      : { background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
                >
                  {acting === selectedFinding.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {a.key === 'RESOLVE' ? <CheckCircle2 className="h-4 w-4" /> : a.key === 'REOPEN' ? <RotateCcw className="h-4 w-4" /> : a.key === 'ESCALATE' ? <Flag className="h-4 w-4" /> : null}
                  {acting === selectedFinding.id ? 'Working...' : a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
