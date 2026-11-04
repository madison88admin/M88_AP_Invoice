import { useEffect, useRef } from 'react';

export function ReceivedDateTimeRange({ from, to, onChange }: { from?: string; to?: string; onChange: (bound: 'from' | 'to', value: string) => void }) {
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (fromInput.current) fromInput.current.value = from || ''; }, [from]);
  useEffect(() => { if (toInput.current) toInput.current.value = to || ''; }, [to]);
  const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' };
  // Native date/time fields must retain incomplete keyboard segments while the
  // user enters them. A controlled value="" resets those segments in Chromium.
  return <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Actual received date &amp; time</span>
    <input ref={fromInput} type="datetime-local" defaultValue={from} onChange={(event) => { if (event.target.validity.valid) onChange('from', event.target.value); }} className="h-9 min-w-0 max-w-full rounded-full px-3 text-sm" style={inputStyle} aria-label="Received date and time from" />
    <span style={{ color: 'var(--text-subtle)' }}>to</span>
    <input ref={toInput} type="datetime-local" defaultValue={to} onChange={(event) => { if (event.target.validity.valid) onChange('to', event.target.value); }} className="h-9 min-w-0 max-w-full rounded-full px-3 text-sm" style={inputStyle} aria-label="Received date and time to" />
    <button type="button" className="rounded-full border px-3 py-2 text-xs" onClick={() => {
      if (!fromInput.current?.reportValidity() || !toInput.current?.reportValidity()) return;
      onChange('from', fromInput.current.value); onChange('to', toInput.current.value);
    }}>Apply received cut-off</button>
    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
    {from && to && from > to && <span role="alert" className="text-xs" style={{ color: 'var(--accent-red)' }}>Start must be on or before the end.</span>}
  </div>;
}
