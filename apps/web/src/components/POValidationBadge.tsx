import { useState, useEffect, useRef } from 'react';

export type POValidationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'MATCHED'
  | 'WARNING'
  | 'MISMATCH'
  | 'NOT_FOUND'
  | 'SKIPPED'
  | 'ERROR';

interface POValidationBadgeProps {
  invoiceId: string;
  initialStatus?: POValidationStatus;
  pollInterval?: number;
}

interface POAuditResult {
  invoice_id: string;
  status: POValidationStatus;
  checked_at?: string;
  nextgen_data?: {
    po_number: string;
    vendor_name: string;
    amount: number;
    brand: string;
    season: string;
    order_type: string;
  };
  comparison?: {
    amount_match: boolean;
    vendor_match: boolean;
    brand_match: boolean;
    season_match: boolean;
    order_type_match: boolean;
    variance_pct?: number;
    differences: string[];
  };
  error?: string;
}

const STATUS_CONFIG: Record<POValidationStatus, { color: string; icon: string; label: string; bg: string; text: string; border: string }> = {
  PENDING:   { color: 'gray',   icon: '⏳', label: 'PO Check Pending',    bg: 'bg-slate-500/20',   text: 'text-slate-400',   border: 'border-slate-400/30' },
  RUNNING:   { color: 'blue',   icon: '🔄', label: 'Checking NextGen...', bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-400/30' },
  MATCHED:   { color: 'green',  icon: '✅', label: 'PO Matched',          bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  WARNING:   { color: 'yellow', icon: '⚠️', label: 'Variance Warning',    bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-400/30' },
  MISMATCH:  { color: 'red',    icon: '🔴', label: 'PO Mismatch',         bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-400/30' },
  NOT_FOUND: { color: 'orange', icon: '❓', label: 'PO Not Found',        bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-400/30' },
  SKIPPED:   { color: 'gray',   icon: '➖', label: 'No PO Number',        bg: 'bg-slate-500/20',   text: 'text-slate-400',   border: 'border-slate-400/30' },
  ERROR:     { color: 'red',    icon: '⚡', label: 'NextGen Unavailable', bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-400/30' },
};

const FINAL_STATUSES: POValidationStatus[] = ['MATCHED', 'WARNING', 'MISMATCH', 'NOT_FOUND', 'SKIPPED', 'ERROR'];

export function POValidationBadge({ invoiceId, initialStatus = 'PENDING', pollInterval = 5000 }: POValidationBadgeProps) {
  const [status, setStatus] = useState<POValidationStatus>(initialStatus);
  const [details, setDetails] = useState<POAuditResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (FINAL_STATUSES.includes(status)) return;

    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/po-status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: POAuditResult = await res.json();
        if (!mounted) return;
        setStatus(data.status);
        setDetails(data);
      } catch (err) {
        console.error('PO status poll failed:', err);
      }
    };

    poll();
    const interval = setInterval(poll, pollInterval);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [invoiceId, status, pollInterval]);

  // Close popover when clicking outside
  useEffect(() => {
    if (!showDetails) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setShowDetails(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDetails]);

  const config = STATUS_CONFIG[status];

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          ${config.bg} ${config.text} border ${config.border}
          cursor-pointer hover:brightness-110 transition-all
        `}
      >
        <span>{config.icon}</span>
        <span>{config.label}</span>
        {(status === 'WARNING' || status === 'MISMATCH') && details?.comparison?.variance_pct !== undefined && (
          <span>({details.comparison.variance_pct}%)</span>
        )}
      </button>

      {showDetails && details && (
        <div
          ref={popoverRef}
          className="absolute z-50 top-8 left-0 w-80 p-4 rounded-xl
            bg-slate-900/95 border border-white/10
            backdrop-blur-md shadow-2xl"
        >
          <p className="text-xs font-semibold text-slate-200 mb-3">PO Validation Details</p>

          {details.nextgen_data ? (
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>NextGen PO:</span>
                <span className="text-slate-100 font-medium">{details.nextgen_data.po_number}</span>
              </div>
              <div className="flex justify-between">
                <span>NextGen Amount:</span>
                <span className="text-slate-100 font-medium">${details.nextgen_data.amount?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Vendor Match:</span>
                <span className={details.comparison?.vendor_match ? 'text-emerald-400' : 'text-red-400'}>
                  {details.comparison?.vendor_match ? '✓' : '✗'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Brand Match:</span>
                <span className={details.comparison?.brand_match ? 'text-emerald-400' : 'text-red-400'}>
                  {details.comparison?.brand_match ? '✓' : '✗'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Season Match:</span>
                <span className={details.comparison?.season_match ? 'text-emerald-400' : 'text-red-400'}>
                  {details.comparison?.season_match ? '✓' : '✗'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Amount Match:</span>
                <span className={details.comparison?.amount_match ? 'text-emerald-400' : 'text-amber-400'}>
                  {details.comparison?.amount_match
                    ? '✓'
                    : `${details.comparison?.variance_pct ?? 0}% variance`}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No NextGen data available yet.</p>
          )}

          {details.comparison?.differences && details.comparison.differences.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10">
              <p className="text-xs text-red-400 font-medium mb-1.5">Issues:</p>
              {details.comparison.differences.map((diff, i) => (
                <p key={i} className="text-xs text-slate-400">• {diff}</p>
              ))}
            </div>
          )}

          {details.error && (
            <p className="text-xs text-red-400 mt-2">⚡ {details.error}</p>
          )}

          {details.checked_at && (
            <p className="text-xs text-slate-600 mt-3">
              Checked: {new Date(details.checked_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default POValidationBadge;
