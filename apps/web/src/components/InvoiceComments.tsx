import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { invoiceApi } from '../lib/api';
import type { MockAuditLog, MockInvoice } from '../lib/mockData';

type InvoiceCommentsProps = {
  invoice: MockInvoice;
  onCommentAdded?: (comment: MockAuditLog) => void;
};

const roleLabel = (role?: string) => String(role || 'User').replace(/_/g, ' ');

/** Shared, always-visible invoice conversation for coordinator/manager/accounting handoffs. */
export default function InvoiceComments({ invoice, onCommentAdded }: InvoiceCommentsProps) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [localComments, setLocalComments] = useState<MockAuditLog[]>([]);

  const sourceComments = useMemo(
    () => (invoice.audit_logs || []).filter((log) => log.action === 'INVOICE_COMMENT'),
    [invoice.audit_logs],
  );

  useEffect(() => setLocalComments(sourceComments), [sourceComments]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const response = await invoiceApi.addComment(invoice.id, text);
      const raw = response.data || {};
      const comment: MockAuditLog = {
        id: raw.id || `comment-${Date.now()}`,
        invoice_id: invoice.id,
        action: 'INVOICE_COMMENT',
        performed_by: raw.performed_by || '',
        actor_name: raw.actor_name,
        actor_role: raw.actor_role,
        note: raw.note || text,
        created_at: raw.created_at || new Date().toISOString(),
      };
      setLocalComments((current) => [...current, comment]);
      onCommentAdded?.(comment);
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} />
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Invoice conversation</h4>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Visible to workflow participants</span>
      </div>

      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
        {localComments.map((comment) => (
          <div key={comment.id} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{comment.actor_name || comment.performed_by || 'Workflow user'}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{new Date(comment.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--accent-purple)' }}>{roleLabel(comment.actor_role)}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-5" style={{ color: 'var(--text-secondary)' }}>{comment.note}</p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Call out what the next team should check…"
          className="min-h-[58px] flex-1 resize-y rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
        />
        <button type="submit" disabled={!draft.trim() || saving} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </button>
      </form>
    </section>
  );
}
