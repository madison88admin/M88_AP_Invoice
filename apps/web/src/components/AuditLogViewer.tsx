import { useEffect, useState } from 'react';
import api from '../lib/api';
import { invoiceApi } from '../lib/api';
import { Clock, User, FileText, CheckCircle, XCircle, Upload, AlertTriangle, CreditCard, GitBranch, PenLine, ArrowRight } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { getAuditActorDisplay } from '../lib/auditActor';

interface AuditLog {
  id: string;
  invoice_id?: string;
  action: string;
  performed_by?: string;
  note?: string;
  created_at: string;
}

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  detail?: string | null;
  actor?: string | null;
  status?: string | null;
  created_at: string;
}

interface AuditLogViewerProps {
  invoiceId?: string;
  performedBy?: string;
  limit?: number;
  title?: string;
}

const typeIcon: Record<string, typeof FileText> = {
  upload: Upload,
  audit: FileText,
  workflow: GitBranch,
  stage: Clock,
  approval: CheckCircle,
  signature: PenLine,
  exception: AlertTriangle,
  payment: CreditCard,
  confirmation: CheckCircle,
};

const typeColor: Record<string, string> = {
  upload: 'var(--accent-blue)',
  audit: 'var(--accent-purple)',
  workflow: 'var(--accent-violet)',
  stage: 'var(--text-muted)',
  approval: 'var(--accent-green)',
  signature: 'var(--accent-lime)',
  exception: 'var(--accent-amber)',
  payment: 'var(--accent-blue)',
  confirmation: 'var(--accent-green)',
};

const typeLabel: Record<string, string> = {
  upload: 'Upload',
  audit: 'Audit',
  workflow: 'Workflow',
  stage: 'Stage',
  approval: 'Approval',
  signature: 'Signature',
  exception: 'Exception',
  payment: 'Payment',
  confirmation: 'Confirmation',
};

export default function AuditLogViewer({ invoiceId, performedBy, limit = 100, title = 'Audit Trail' }: AuditLogViewerProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'logs'>('timeline');

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch audit logs
        const params = new URLSearchParams();
        if (invoiceId) params.append('invoiceId', invoiceId);
        if (performedBy) params.append('performedBy', performedBy);
        if (limit) params.append('limit', limit.toString());
        const logResponse = await api.get(`/api/audit-logs?${params.toString()}`);
        const logData = logResponse.data?.logs || logResponse.data || [];
        setLogs(logData);

        // Fetch timeline (includes audit_logs, workflow_actions, signatures, exceptions, payments, stages)
        if (invoiceId) {
          try {
            const tlResponse = await invoiceApi.getTimeline(invoiceId);
            const tlData = tlResponse.data;
            if (tlData?.events) {
              // Sort by created_at ascending (oldest first for timeline)
              const sorted = [...tlData.events].sort((a: TimelineEvent, b: TimelineEvent) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              setTimeline(sorted);
            } else if (tlData?.timeline) {
              setTimeline(tlData.timeline);
            }
          } catch (tlErr) {
            // Timeline endpoint failed — fall back to audit logs only
            console.error('[AuditLogViewer] Timeline fetch failed:', tlErr);
          }
        }
      } catch (err) {
        setError('Failed to load audit trail');
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [invoiceId, performedBy, limit]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm rounded-xl" style={{ color: 'var(--accent-red)', background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
        {error}
      </div>
    );
  }

  const hasTimeline = timeline.length > 0;
  const hasLogs = logs.length > 0;

  if (!hasTimeline && !hasLogs) {
    return (
      <div className="p-4 text-sm rounded-xl text-center" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <FileText className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
          {title}
        </h4>
        {hasTimeline && hasLogs && (
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
            <button
              onClick={() => setViewMode('timeline')}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={viewMode === 'timeline'
                ? { background: 'var(--accent-purple)', color: 'white' }
                : { color: 'var(--text-muted)' }}
            >
              Timeline ({timeline.length})
            </button>
            <button
              onClick={() => setViewMode('logs')}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={viewMode === 'logs'
                ? { background: 'var(--accent-purple)', color: 'white' }
                : { color: 'var(--text-muted)' }}
            >
              Audit Logs ({logs.length})
            </button>
          </div>
        )}
      </div>

      {viewMode === 'timeline' && hasTimeline ? (
        <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
          {/* Timeline vertical line */}
          <div className="relative pl-6">
            <div className="absolute left-2 top-0 bottom-0 w-0.5" style={{ background: 'var(--border-subtle)' }} />
            {timeline.map((event) => {
              const Icon = typeIcon[event.type] || FileText;
              const color = typeColor[event.type] || 'var(--accent-purple)';
              return (
                <div key={event.id} className="relative mb-3">
                  {/* Node dot */}
                  <div className="absolute -left-5 top-1 w-3 h-3 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-card)', border: `2px solid ${color}` }}>
                    <Icon className="h-2 w-2" style={{ color }} strokeWidth={2.5} />
                  </div>
                  {/* Event card */}
                  <div className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
                            {typeLabel[event.type] || event.type}
                          </span>
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{event.title}</p>
                        </div>
                        {event.detail && (
                          <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{event.detail}</p>
                        )}
                      </div>
                      <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(event.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {event.actor && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" strokeWidth={1.75} />
                          {getAuditActorDisplay(event.actor, event.detail)}
                        </span>
                      )}
                      {event.status && (
                        <span className="flex items-center gap-1">
                          <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
                          {event.status.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" strokeWidth={1.75} />
                        {new Date(event.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
          {logs.map((log) => (
            <div key={log.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{log.action}</p>
                  {log.note && (
                    <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{log.note}</p>
                  )}
                </div>
                <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                  {formatDate(log.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                {log.performed_by && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" strokeWidth={1.75} />
                    {getAuditActorDisplay(log.performed_by, log.note)}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" strokeWidth={1.75} />
                  {new Date(log.created_at).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
