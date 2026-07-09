import { useEffect, useState } from 'react';
import api from '../lib/api';
import { Clock, User, FileText } from 'lucide-react';
import { formatDate } from '../lib/utils';

interface AuditLog {
  id: string;
  invoice_id?: string;
  action: string;
  performed_by?: string;
  note?: string;
  created_at: string;
}

interface AuditLogViewerProps {
  invoiceId?: string;
  performedBy?: string;
  limit?: number;
  title?: string;
}

export default function AuditLogViewer({ invoiceId, performedBy, limit = 100, title = 'Audit Log' }: AuditLogViewerProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (invoiceId) params.append('invoiceId', invoiceId);
        if (performedBy) params.append('performedBy', performedBy);
        if (limit) params.append('limit', limit.toString());
        const response = await api.get(`/api/audit-logs?${params.toString()}`);
        setLogs(response.data?.logs || response.data || []);
        setError(null);
      } catch (err) {
        setError('Failed to load audit logs');
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
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

  if (logs.length === 0) {
    return (
      <div className="p-4 text-sm rounded-xl text-center" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <FileText className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
        {title}
      </h4>
      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {logs.map((log) => (
          <div key={log.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{log.action}</p>
                {log.note && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{log.note}</p>
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
                  {log.performed_by}
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
    </div>
  );
}
