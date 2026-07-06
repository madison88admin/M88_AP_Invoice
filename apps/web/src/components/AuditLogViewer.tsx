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
          <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400 bg-red-500/10 rounded-lg border border-red-500/20">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-400 bg-white/5 rounded-lg border border-white/10 text-center">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
        <FileText className="h-4 w-4 text-[#6366f1]" />
        {title}
      </h4>
      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {logs.map((log) => (
          <div key={log.id} className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{log.action}</p>
                {log.note && (
                  <p className="text-xs text-slate-400 mt-1">{log.note}</p>
                )}
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {formatDate(log.created_at)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              {log.performed_by && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {log.performed_by}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(log.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
