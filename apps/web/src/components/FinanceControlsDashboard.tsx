import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { invoiceApi } from '../lib/api';
import { AlertTriangle, CheckCircle2, X, Filter, RefreshCw, Loader2, Clock, User, FileText, RotateCcw, Flag, CircleDot, Mail, ShieldCheck, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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

type IntakeEvent = {
  id: string;
  source: string;
  stage: string;
  status: string;
  file_name?: string | null;
  invoice_id?: string | null;
  error?: string | null;
  category?: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type IntakeMonitor = {
  latest_poll_at?: string | null;
  failures_24h: number;
  events: IntakeEvent[];
  recovery_queue?: IntakeEvent[];
};

type RetentionRow = {
  invoice_id: string;
  invoice_number?: string | null;
  invoice_status?: string | null;
  status: string;
  legal_hold?: boolean;
  retention_until?: string | null;
  backup_verified_at?: string | null;
  eligible_at?: string | null;
};

type ActionModalState = {
  findingId: string;
  action: 'RESOLVE' | 'ASSIGN' | 'ESCALATE';
  title: string;
  label: string;
  placeholder: string;
  requiredMessage: string;
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
  const { user } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [acting, setActing] = useState('');
  const [intakeMonitor, setIntakeMonitor] = useState<IntakeMonitor | null>(null);
  const [retentionRows, setRetentionRows] = useState<RetentionRow[]>([]);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const [retentionAction, setRetentionAction] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState('');
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null);
  const [invoicePreviewLoading, setInvoicePreviewLoading] = useState(false);
  const [invoicePreviewError, setInvoicePreviewError] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [actionModalValue, setActionModalValue] = useState('');
  const [actionModalError, setActionModalError] = useState('');
  const [actionError, setActionError] = useState('');
  const canManageRetention = Boolean(user && ['ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role));

  useEffect(() => {
    return () => {
      if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    };
  }, [invoicePreviewUrl]);

  useEffect(() => {
    setInvoicePreviewUrl(null);
    setInvoicePreviewError(null);
    setInvoicePreviewLoading(false);
  }, [selectedFinding?.id]);

  const openInvoicePreview = async (invoiceId: string) => {
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoicePreviewUrl(null);
    setInvoicePreviewError(null);
    setInvoicePreviewLoading(true);
    try {
      const response = await invoiceApi.getDocument(invoiceId);
      const contentType = String(response.headers['content-type'] || 'application/pdf');
      setInvoicePreviewUrl(URL.createObjectURL(new Blob([response.data], { type: contentType })));
    } catch (error: any) {
      setInvoicePreviewError(error?.response?.data?.message || 'The actual invoice PDF is not available for this record.');
    } finally {
      setInvoicePreviewLoading(false);
    }
  };

  const load = useCallback(async () => {
    const [runResult, monitorResult] = await Promise.allSettled([
      api.get('/api/finance-controls/runs'),
      api.get('/api/email-intake-monitor?limit=500'),
    ]);
    if (runResult.status === 'fulfilled') setRuns(runResult.value.data);
    if (monitorResult.status === 'fulfilled') setIntakeMonitor(monitorResult.value.data);
    if (canManageRetention) {
      const retentionResult = await api.get('/api/retention/queue').catch(() => null);
      if (retentionResult) setRetentionRows(retentionResult.data?.rows || []);
    }
  }, [canManageRetention]);
  useEffect(() => { void load(); }, [load]);

  // Keep the selected run valid — after a fresh scan/reconcile, jump to the newest run.
  useEffect(() => {
    if (!runs.some((r) => r.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id || '');
    }
  }, [runs, selectedRunId]);

  const execute = async (path: string) => { setBusy(path); try { await api.post(path); await load(); } finally { setBusy(''); } };

  const runRetentionScan = async () => {
    setRetentionBusy(true);
    try { await api.post('/api/retention/run'); await load(); } finally { setRetentionBusy(false); }
  };

  const runRetentionAction = async (row: RetentionRow, action: 'backup' | 'hold' | 'release' | 'dispose') => {
    setRetentionAction(`${row.invoice_id}:${action}`);
    setRetentionError('');
    try {
      if (action === 'backup') {
        const reference = window.prompt('Backup reference (required):', 'backup-verified-by-accounting');
        const hash = window.prompt('Backup hash/checksum (required):', '');
        if (!reference?.trim() || !hash?.trim()) return;
        await api.post(`/api/retention/${row.invoice_id}/backup-attestation`, { reference: reference.trim(), hash: hash.trim() });
      } else if (action === 'hold' || action === 'release') {
        const reason = window.prompt(action === 'hold' ? 'Legal-hold reason (required):' : 'Reason for releasing legal hold (required):', '');
        if (!reason?.trim()) return;
        await api.post(`/api/retention/${row.invoice_id}/legal-hold`, { enabled: action === 'hold', reason: reason.trim() });
      } else {
        const reason = window.prompt('Controlled-disposal reason (required):', 'Retention period expired and backup verified');
        if (!reason?.trim()) return;
        await api.post(`/api/retention/${row.invoice_id}/dispose`, { reason: reason.trim() });
      }
      await load();
    } catch (error: any) {
      setRetentionError(error?.response?.data?.error?.message || error?.response?.data?.message || 'Retention action failed.');
    } finally {
      setRetentionAction(null);
    }
  };

  const openActionModal = (id: string, action: string) => {
    setActionError('');
    if (action === 'RESOLVE') {
      setActionModal({ findingId: id, action: 'RESOLVE', title: 'Resolve finding', label: 'Resolution note', placeholder: 'Describe the corrective action or evidence...', requiredMessage: 'A resolution note is required.' });
    } else if (action === 'ASSIGN') {
      setActionModal({ findingId: id, action: 'ASSIGN', title: 'Assign finding', label: 'Assign to', placeholder: 'User name, email, or role...', requiredMessage: 'An assignee is required.' });
    } else if (action === 'ESCALATE') {
      setActionModal({ findingId: id, action: 'ESCALATE', title: 'Escalate finding', label: 'Escalate to', placeholder: 'Role, user name, or email...', requiredMessage: 'An escalation target is required.' });
    }
    setActionModalValue('');
    setActionModalError('');
  };

  const closeActionModal = () => {
    setActionModal(null);
    setActionModalValue('');
    setActionModalError('');
  };

  const submitActionModal = async () => {
    if (!actionModal) return;
    const value = actionModalValue.trim();
    if (!value) {
      setActionModalError(actionModal.requiredMessage);
      return;
    }
    const { findingId, action } = actionModal;
    setActing(findingId);
    try {
      if (action === 'RESOLVE') {
        await api.patch(`/api/finance-controls/findings/${findingId}`, { action, note: value });
      } else if (action === 'ASSIGN') {
        await api.patch(`/api/finance-controls/findings/${findingId}`, { action, assigned_to: value });
      } else {
        await api.patch(`/api/finance-controls/findings/${findingId}`, { action, escalate_to: value });
      }
      await load();
      closeActionModal();
    } catch (error: any) {
      setActionModalError(error?.response?.data?.message || 'The action could not be completed. Please try again.');
    } finally {
      setActing('');
    }
  };

  const act = async (id: string, action: string) => {
    if (action === 'RESOLVE' || action === 'ASSIGN' || action === 'ESCALATE') {
      openActionModal(id, action);
      return;
    }
    setActionError('');
    setActing(id);
    try {
      await api.patch(`/api/finance-controls/findings/${id}`, { action });
      await load();
    } catch (error: any) {
      setActionError(error?.response?.data?.message || 'The action could not be completed. Please try again.');
    } finally {
      setActing('');
    }
  };

  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0];
  const baseFindings = selectedRun?.findings || [];
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredIntakeEvents = useMemo(() => {
    if (!intakeMonitor?.events) return [];
    if (!normalizedSearch) return intakeMonitor.events;
    return intakeMonitor.events.filter((event) => {
      const metadata = event.metadata ? JSON.stringify(event.metadata) : '';
      return [event.file_name, event.invoice_id, event.source, event.stage, event.status, event.error, metadata]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [intakeMonitor?.events, normalizedSearch]);

  const codes = useMemo(() => [...new Set(baseFindings.map((f) => f.code))].sort(), [baseFindings]);

  const filtered = baseFindings.filter((f) =>
    (!normalizedSearch || [f.code, f.detail, f.invoice_id, f.payment_id, f.status, f.severity]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch))) &&
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

  const clearFilters = () => { setSevFilter(''); setStatusFilter(''); setCodeFilter(''); setSearchTerm(''); };

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
      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border px-4 py-3 text-sm" role="alert" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-red) 30%, transparent)', color: 'var(--accent-red)' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss action error" className="rounded p-0.5"><X className="h-4 w-4" /></button>
        </div>
      )}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        <div className="p-4 flex flex-wrap items-center gap-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <Mail className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
          <div>
            <div className="font-semibold">Invoice intake monitoring</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Received → Attachment detected → Uploaded → Extracted → Created / Failed
            </div>
          </div>
          <div className="ml-auto text-xs text-right" style={{ color: 'var(--text-muted)' }}>
            <div>Last Graph poll: {fmtDate(intakeMonitor?.latest_poll_at)}</div>
            <div style={{ color: intakeMonitor?.failures_24h ? 'var(--accent-red)' : 'var(--accent-lime)' }}>
              {intakeMonitor?.failures_24h ?? 0} failures in 24h
            </div>
          </div>
        </div>
        {!!intakeMonitor?.recovery_queue?.length && (
          <div className="px-4 py-3 border-b flex flex-wrap gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            {Object.entries(intakeMonitor.recovery_queue.reduce<Record<string, number>>((acc, item) => {
              const key = item.category || 'FAILED'; acc[key] = (acc[key] || 0) + 1; return acc;
            }, {})).map(([category, count]) => (
              <span key={category} className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg-elevated)', color: category === 'FAILED' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
                {category.replace(/_/g, ' ')}: {count}
              </span>
            ))}
          </div>
        )}
        {!intakeMonitor ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Intake monitoring data is not available yet.</div>
        ) : intakeMonitor.events.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>No intake events recorded yet.</div>
        ) : filteredIntakeEvents.length === 0 ? (
          <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>No intake events match “{searchTerm}”.</div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {filteredIntakeEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 flex items-start gap-3 text-sm">
                <span
                  className="mt-1 h-2 w-2 rounded-full shrink-0"
                  style={{ background: event.status === 'FAILED' ? 'var(--accent-red)' : event.status === 'REVIEW_REQUIRED' || event.stage === 'REVIEW_REQUIRED' ? 'var(--accent-amber)' : event.stage === 'CREATED' ? 'var(--accent-lime)' : 'var(--accent-blue)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-medium">{event.stage.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>{event.source.replace(/_/g, ' ')}</span>
                    {event.file_name && <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{event.file_name}</span>}
                  </div>
                  {event.error && <div className="text-xs mt-1" style={{ color: event.status === 'FAILED' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>{event.error}</div>}
                </div>
                <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--text-subtle)' }}>{fmtDate(event.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {canManageRetention && (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)' }}>
          <div className="p-4 flex flex-wrap items-center gap-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <ShieldCheck className="h-4 w-4" style={{ color: 'var(--accent-violet)' }} />
            <div>
              <div className="font-semibold">Retention & legal-hold controls</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Seven-year retention, backup evidence, and controlled disposal queue</div>
            </div>
            <button className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--accent-violet)', color: 'white' }} disabled={retentionBusy} onClick={() => void runRetentionScan()}>
              {retentionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run scan
            </button>
          </div>
          {retentionError && <div className="px-4 py-2 text-xs" style={{ color: 'var(--accent-red)', background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)' }}>{retentionError}</div>}
          {retentionRows.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>No retention records returned.</div>
          ) : (
            <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {retentionRows.slice(0, 25).map((row) => (
                <div key={row.invoice_id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="font-medium truncate min-w-0 flex-1">{row.invoice_number || row.invoice_id.slice(0, 8)}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: 'var(--bg-elevated)', color: row.status === 'LEGAL_HOLD' ? 'var(--accent-red)' : row.status === 'ELIGIBLE_FOR_DISPOSAL' ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{row.status.replace(/_/g, ' ')}</span>
                  <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--text-subtle)' }}>{row.retention_until ? new Date(row.retention_until).toLocaleDateString() : '—'}</span>
                  <div className="flex items-center gap-1.5 ml-auto">
                    {!row.backup_verified_at && <button type="button" onClick={() => void runRetentionAction(row, 'backup')} disabled={retentionAction === `${row.invoice_id}:backup`} className="px-2 py-1 rounded text-[10px] border disabled:opacity-50">Verify backup</button>}
                    {row.legal_hold ? <button type="button" onClick={() => void runRetentionAction(row, 'release')} disabled={retentionAction === `${row.invoice_id}:release`} className="px-2 py-1 rounded text-[10px] border disabled:opacity-50">Release hold</button> : <button type="button" onClick={() => void runRetentionAction(row, 'hold')} disabled={retentionAction === `${row.invoice_id}:hold`} className="px-2 py-1 rounded text-[10px] border disabled:opacity-50">Legal hold</button>}
                    {row.status === 'ELIGIBLE_FOR_DISPOSAL' && <button type="button" onClick={() => void runRetentionAction(row, 'dispose')} disabled={retentionAction === `${row.invoice_id}:dispose`} className="px-2 py-1 rounded text-[10px] border disabled:opacity-50" style={{ color: 'var(--accent-red)' }}>Dispose</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        <div className="relative w-full md:w-80 order-3 md:order-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search invoice, file, or finding..."
            aria-label="Search invoice intake and findings"
            className="w-full rounded-lg py-2 pl-9 pr-8 text-sm focus:outline-none"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear invoice search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1" style={{ color: 'var(--text-muted)' }}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
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
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{filtered.length} of {baseFindings.length} findings{normalizedSearch ? ` · ${filteredIntakeEvents.length} intake matches` : ''}</span>
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

            {selectedFinding.invoice_id && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => invoicePreviewUrl ? setInvoicePreviewUrl(null) : void openInvoicePreview(selectedFinding.invoice_id as string)}
                  disabled={invoicePreviewLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
                  style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
                >
                  {invoicePreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {invoicePreviewLoading ? 'Loading actual invoice...' : invoicePreviewUrl ? 'Close quick view' : 'Quick view actual invoice'}
                </button>
                {invoicePreviewError && (
                  <div className="mt-2 text-xs" style={{ color: 'var(--accent-red)' }}>{invoicePreviewError}</div>
                )}
              </div>
            )}

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

            {invoicePreviewUrl && (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6"
                role="dialog"
                aria-modal="true"
                aria-label="Actual invoice PDF quick view"
                style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)' }}
                onMouseDown={(event) => { if (event.target === event.currentTarget) setInvoicePreviewUrl(null); }}
              >
                <div
                  className="flex h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <div className="min-w-0">
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>Actual invoice PDF</div>
                      <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>Finding {selectedFinding.code} · Invoice {selectedFinding.invoice_id}</div>
                    </div>
                    <button type="button" onClick={() => setInvoicePreviewUrl(null)} aria-label="Close actual invoice preview" className="rounded-xl p-2" style={{ color: 'var(--text-muted)' }}>
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 bg-white">
                    <iframe title={`Actual invoice PDF ${selectedFinding.invoice_id}`} src={invoicePreviewUrl} className="h-full w-full" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {actionModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finance-action-modal-title"
          style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeActionModal(); }}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h2 id="finance-action-modal-title" className="font-semibold" style={{ color: 'var(--text-primary)' }}>{actionModal.title}</h2>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>This action will be recorded in the finance-control audit trail.</p>
              </div>
              <button type="button" onClick={closeActionModal} aria-label="Close action modal" className="rounded-xl p-2" style={{ color: 'var(--text-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{actionModal.label}</label>
              <textarea
                value={actionModalValue}
                onChange={(event) => { setActionModalValue(event.target.value); setActionModalError(''); }}
                placeholder={actionModal.placeholder}
                rows={actionModal.action === 'RESOLVE' ? 4 : 2}
                autoFocus
                className="w-full resize-y rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--input-bg)', border: `1px solid ${actionModalError ? 'var(--accent-red)' : 'var(--input-border)'}`, color: 'var(--text-primary)' }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeActionModal();
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submitActionModal();
                }}
              />
              {actionModalError && <p className="mt-2 text-xs" style={{ color: 'var(--accent-red)' }}>{actionModalError}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={closeActionModal} className="rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>Cancel</button>
                <button type="button" onClick={() => void submitActionModal()} className="rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}>Confirm {actionModal.action === 'RESOLVE' ? 'resolution' : actionModal.action.toLowerCase()}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
