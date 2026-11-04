import { useState } from 'react';

export type AccountingAction = 'hold' | 'return' | 'cfo-approve' | 'cfo-reject' | 'reconcile';
export interface AccountingActionValues { reason: string; evidenceReference: string; reviewDate: string }

export function AccountingActionModal({ action, subject, owner, busy, onCancel, onConfirm }: {
  action: AccountingAction; subject: string; owner?: string; busy: boolean;
  onCancel: () => void; onConfirm: (values: AccountingActionValues) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const today = new Date();
  const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [reviewDate, setReviewDate] = useState(minimumDate);
  const title = { hold: 'Place payment on hold', return: 'Return batch for correction', 'cfo-approve': 'Approve bank execution', 'cfo-reject': 'Reject bank execution', reconcile: 'Reconcile batch amounts' }[action];
  const hold = action === 'hold';
  const valid = (action === 'cfo-approve' || Boolean(reason.trim())) && (!hold || Boolean(evidenceReference.trim() && reviewDate >= minimumDate));
  const inputStyle = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="accounting-action-title" className="w-full max-w-lg rounded-2xl p-6 shadow-xl" style={{ background: 'var(--bg-card)' }}
        onSubmit={async (event) => { event.preventDefault(); if (valid && !busy) await onConfirm({ reason: reason.trim(), evidenceReference: evidenceReference.trim(), reviewDate }); }}>
        <h2 id="accounting-action-title" className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{subject}</p>
        {action === 'reconcile' && <p className="mt-3 text-sm">This resets the batch to Draft. Re-upload corrected bill stubs and submit for Supervisor review again. Previous evidence stays in the audit history.</p>}
        {hold && <p className="mt-3 text-sm">Responsible owner: {owner || 'Current Accounting Associate'}</p>}
        <label className="mt-4 block text-sm">{action === 'cfo-approve' ? 'Approval note (optional)' : 'Reason (required)'}
          <textarea autoFocus required={action !== 'cfo-approve'} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg p-3" style={inputStyle} />
        </label>
        {hold && <>
          <label className="mt-3 block text-sm">Supporting evidence / document reference (required)
            <input required value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} className="mt-1 w-full rounded-lg p-3" style={inputStyle} />
          </label>
          <label className="mt-3 block text-sm">Expected response / review date (required)
            <input type="date" required min={minimumDate} value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} className="mt-1 w-full rounded-lg p-3" style={inputStyle} />
          </label>
        </>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg px-4 py-2">Cancel</button>
          <button type="submit" disabled={!valid || busy} className="rounded-lg px-4 py-2 font-semibold disabled:opacity-50" style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}>{busy ? 'Saving…' : title}</button>
        </div>
      </form>
    </div>
  );
}
