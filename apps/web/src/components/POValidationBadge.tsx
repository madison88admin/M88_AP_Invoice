import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { Clock, RefreshCw, CheckCircle, AlertTriangle, XCircle, HelpCircle, Minus, Zap } from 'lucide-react';

export type POValidationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'MATCH'
  | 'MATCHED'
  | 'MISMATCH'
  | 'LINE_NOT_FOUND'
  | 'PO_NOT_FOUND'
  | 'NEXTGEN_UNAVAILABLE'
  | 'MANUAL_REVIEW'
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
    currency?: string;
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
    currency_match?: boolean;
    invoice_amount?: number;
    nextgen_amount?: number;
    amount_difference?: number;
    variance_pct?: number;
    line_comparisons?: Array<{
      invoice_line_number?: number;
      status: 'MATCH' | 'MISMATCH' | 'LINE_NOT_FOUND' | 'MANUAL_REVIEW';
      match_level: string;
      matched_mpo_line?: string;
      matched_material?: string;
      quantity?: { invoice: number; nextgen: number; difference: number; match: boolean };
      unit_price?: { invoice: number; nextgen: number; difference: number; match: boolean };
      amount?: { invoice: number; nextgen: number; difference: number; variance_pct: number; match: boolean };
      reason?: string;
    }>;
    differences: string[];
  };
  reason?: string;
  error?: string;
}

const STATUS_CONFIG: Record<POValidationStatus, { color: string; icon: React.ReactNode; label: string; bg: string; text: string; border: string }> = {
  PENDING:   { color: 'gray',   icon: <Clock className="h-3.5 w-3.5" strokeWidth={2} />, label: 'PO Check Pending',    bg: 'bg-slate-500/20',   text: 'text-slate-400',   border: 'border-slate-400/30' },
  RUNNING:   { color: 'blue',   icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />, label: 'Checking NextGen...', bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-400/30' },
  MATCH:     { color: 'green',  icon: <CheckCircle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'PO Match',            bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  MATCHED:   { color: 'green',  icon: <CheckCircle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'PO Matched',          bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-400/30' },
  MISMATCH:  { color: 'red',    icon: <XCircle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'PO Mismatch',         bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-400/30' },
  LINE_NOT_FOUND: { color: 'orange', icon: <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'Line Not Found', bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-400/30' },
  PO_NOT_FOUND: { color: 'orange', icon: <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'PO Not Found', bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-400/30' },
  NEXTGEN_UNAVAILABLE: { color: 'red', icon: <Zap className="h-3.5 w-3.5" strokeWidth={2} />, label: 'NextGen Unavailable', bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-400/30' },
  MANUAL_REVIEW: { color: 'yellow', icon: <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'Manual Review', bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-400/30' },
  NOT_FOUND: { color: 'orange', icon: <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />, label: 'PO Not Found',        bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-400/30' },
  SKIPPED:   { color: 'gray',   icon: <Minus className="h-3.5 w-3.5" strokeWidth={2} />, label: 'No PO Number',        bg: 'bg-slate-500/20',   text: 'text-slate-400',   border: 'border-slate-400/30' },
  ERROR:     { color: 'red',    icon: <Zap className="h-3.5 w-3.5" strokeWidth={2} />, label: 'NextGen Unavailable', bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-400/30' },
};

const FINAL_STATUSES: POValidationStatus[] = [
  'MATCH', 'MATCHED', 'MISMATCH', 'LINE_NOT_FOUND', 'PO_NOT_FOUND',
  'NEXTGEN_UNAVAILABLE', 'MANUAL_REVIEW', 'NOT_FOUND', 'SKIPPED', 'ERROR',
];

export function POValidationBadge({ invoiceId, initialStatus = 'PENDING', pollInterval = 30000 }: POValidationBadgeProps) {
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
        const res = await api.get(`/api/invoices/${invoiceId}/po-status`);
        const data: POAuditResult = res.data;
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
        <span className="flex items-center">{config.icon}</span>
        <span>{config.label}</span>
        {status === 'MISMATCH' && details?.comparison?.variance_pct !== undefined && (
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
          <p className="text-xs font-semibold text-slate-200 mb-3">NextGen Validation Details</p>

          {details.nextgen_data ? (
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>NextGen PO:</span>
                <span className="text-slate-100 font-medium">{details.nextgen_data.po_number}</span>
              </div>
              <div className="flex justify-between">
                <span>NextGen Amount:</span>
                <span className="text-slate-100 font-medium">
                  {details.nextgen_data.currency || ''} {details.nextgen_data.amount?.toFixed(2)}
                </span>
              </div>
              {details.comparison?.invoice_amount !== undefined && (
                <div className="flex justify-between">
                  <span>Invoice Amount:</span>
                  <span className="text-slate-100 font-medium">{details.comparison.invoice_amount.toFixed(2)}</span>
                </div>
              )}
              {details.comparison?.amount_difference !== undefined && (
                <div className="flex justify-between">
                  <span>Difference:</span>
                  <span className={details.comparison.amount_match ? 'text-emerald-400' : 'text-red-400'}>
                    {details.comparison.amount_difference.toFixed(2)}
                    {details.comparison.variance_pct !== undefined ? ` (${details.comparison.variance_pct}%)` : ''}
                  </span>
                </div>
              )}
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
              <div className="flex justify-between">
                <span>Currency Match:</span>
                <span className={details.comparison?.currency_match === false ? 'text-red-400' : 'text-emerald-400'}>
                  {details.comparison?.currency_match === false ? 'No' : 'Yes'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No NextGen data available yet.</p>
          )}

          {details.comparison?.line_comparisons && details.comparison.line_comparisons.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
              <p className="text-xs text-slate-200 font-medium">Line comparison</p>
              {details.comparison.line_comparisons.map((line, index) => (
                <div key={`${line.invoice_line_number ?? index}`} className="rounded-lg bg-white/5 p-2 text-xs text-slate-400">
                  <div className="flex justify-between gap-2">
                    <span>Line {line.invoice_line_number ?? index + 1}</span>
                    <span className={line.status === 'MATCH' ? 'text-emerald-400' : 'text-amber-400'}>{line.status.replace(/_/g, ' ')}</span>
                  </div>
                  {(line.matched_mpo_line || line.matched_material) && (
                    <p>Matched: {[line.matched_mpo_line && `MPO line ${line.matched_mpo_line}`, line.matched_material].filter(Boolean).join(' / ')}</p>
                  )}
                  {line.quantity && <p>Qty: {line.quantity.invoice} vs {line.quantity.nextgen} (diff {line.quantity.difference})</p>}
                  {line.unit_price && <p>Unit price: {line.unit_price.invoice.toFixed(4)} vs {line.unit_price.nextgen.toFixed(4)} (diff {line.unit_price.difference.toFixed(4)})</p>}
                  {line.amount && <p>Amount: {line.amount.invoice.toFixed(2)} vs {line.amount.nextgen.toFixed(2)} ({line.amount.variance_pct}% variance)</p>}
                  {line.reason && <p className="text-slate-500">{line.reason}</p>}
                </div>
              ))}
            </div>
          )}

          {details.reason && (
            <p className="text-xs text-amber-400 mt-3">{details.reason}</p>
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
            <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><Zap className="h-3 w-3" strokeWidth={2} /> {details.error}</p>
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
