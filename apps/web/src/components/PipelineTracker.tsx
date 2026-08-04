import { useMemo } from 'react';
import { Clock, CheckCircle, Circle, AlertTriangle, ArrowRight, Hourglass } from 'lucide-react';
import { calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { MockInvoice } from '../lib/mockData';

interface PipelineTrackerProps {
  invoice: MockInvoice;
}

const STAGE_FLOW = [
  { stage: 'RECEIVED', label: 'Received', role: 'System' },
  { stage: 'OCR_PROCESSING', label: 'OCR Processing', role: 'System' },
  { stage: 'VALIDATION_PENDING', label: 'Validation', role: 'Coordinator' },
  { stage: 'EXCEPTION_FLAGGED', label: 'Exception', role: 'Coordinator' },
  { stage: 'PENDING_COORDINATOR', label: 'Coordinator Approval', role: 'Purchasing Coordinator' },
  { stage: 'PENDING_MANAGER', label: 'Manager Approval', role: 'Purchasing Manager' },
  { stage: 'PENDING_MLO_ACCOUNT_HOLDER', label: 'MLO Account Holder', role: 'MLO Account Holder' },
  { stage: 'PENDING_MLO_PLANNING_MANAGER', label: 'MLO Planning Manager', role: 'MLO Planning Manager' },
  { stage: 'PENDING_SR_MANAGER', label: 'Sr. Manager', role: 'Sr. Manager Global Production' },
  { stage: 'PENDING_POLLY', label: 'Ms. Polly', role: 'Ms. Polly' },
  { stage: 'PENDING_ACCOUNTING', label: 'Accounting Review', role: 'Accounting' },
  { stage: 'APPROVED', label: 'Approved', role: 'Accounting' },
  { stage: 'POSTED_TO_QB', label: 'Posted to QB', role: 'Accounting' },
  { stage: 'PAYMENT_SCHEDULED', label: 'Payment Scheduled', role: 'Accounting' },
  { stage: 'PAID', label: 'Paid', role: 'Accounting' },
  { stage: 'PAYMENT_CONFIRMATION_SENT', label: 'Confirmation Sent', role: 'Accounting' },
  { stage: 'ON_HOLD', label: 'On Hold', role: 'System' },
  { stage: 'REJECTED', label: 'Rejected', role: 'System' },
];

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remHours = Math.round(hours % 24);
  return `${days}d${remHours > 0 ? ` ${remHours}h` : ''}`;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function PipelineTracker({ invoice }: PipelineTrackerProps) {
  const timestamps = (invoice as any).stage_timestamps || [];
  const signatures = (invoice as any).signatures || [];
  const currentStatus = invoice.status;

  const stageMap = useMemo(() => {
    const map: Record<string, { entered_at: string; exited_at?: string; sla_hours: number; is_breached: boolean; occurrences: number }> = {};
    for (const ts of timestamps) {
      const key = ts.stage;
      if (!map[key]) {
        map[key] = { entered_at: ts.entered_at, exited_at: ts.exited_at, sla_hours: ts.sla_hours, is_breached: ts.is_breached, occurrences: 1 };
      } else {
        map[key].occurrences++;
        if (!ts.exited_at) {
          map[key].entered_at = ts.entered_at;
          map[key].exited_at = undefined;
        }
      }
    }
    return map;
  }, [timestamps]);

  const visibleStages = useMemo(() => {
    const seen = new Set<string>();
    const result: typeof STAGE_FLOW = [];
    for (const s of STAGE_FLOW) {
      if (stageMap[s.stage] || s.stage === currentStatus) {
        seen.add(s.stage);
        result.push(s);
      }
    }
    if (!seen.has(currentStatus)) {
      const match = STAGE_FLOW.find(s => s.stage === currentStatus);
      if (match) result.push(match);
    }
    if (result.length === 0 && STAGE_FLOW.length > 0) {
      return STAGE_FLOW.slice(0, 5);
    }
    return result;
  }, [stageMap, currentStatus]);

  const currentIndex = visibleStages.findIndex(s => s.stage === currentStatus);
  const returnedSignatures = signatures.filter((s: any) => s.approval_status === 'RECONFIRMATION_REQUIRED');

  return (
    <div className="space-y-4">
      {/* Current Stage Summary */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Current Stage</p>
          {returnedSignatures.length > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full inline-flex items-center gap-1" style={{ background: 'color-mix(in srgb, var(--accent-amber) 15%, transparent)', color: 'var(--accent-amber)' }}>
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
              Returned for correction
            </span>
          )}
        </div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {STAGE_FLOW.find(s => s.stage === currentStatus)?.label || currentStatus.replace(/_/g, ' ')}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {STAGE_FLOW.find(s => s.stage === currentStatus)?.role || 'Unknown'}
        </p>
        {stageMap[currentStatus] && !stageMap[currentStatus].exited_at && stageMap[currentStatus].sla_hours > 0 && (
          <SLABadge enteredAt={stageMap[currentStatus].entered_at} slaHours={stageMap[currentStatus].sla_hours} />
        )}
      </div>

      {/* Visual Timeline */}
      <div className="space-y-0">
        {visibleStages.map((stageInfo, idx) => {
          const ts = stageMap[stageInfo.stage];
          const isCompleted = ts?.exited_at;
          const isCurrent = stageInfo.stage === currentStatus;
          const isPast = idx < currentIndex;
          const isFuture = idx > currentIndex;
          const occurrences = ts?.occurrences || 0;

          let icon: React.ReactNode;
          let dotColor: string;
          let labelColor: string;

          if (isCompleted) {
            icon = <CheckCircle className="h-4 w-4" strokeWidth={2} />;
            dotColor = 'var(--accent-lime)';
            labelColor = 'var(--text-secondary)';
          } else if (isCurrent) {
            icon = <Circle className="h-4 w-4" strokeWidth={2} fill="currentColor" />;
            dotColor = 'var(--accent-purple)';
            labelColor = 'var(--text-primary)';
          } else if (isFuture) {
            icon = <Circle className="h-4 w-4" strokeWidth={1.5} />;
            dotColor = 'var(--text-muted)';
            labelColor = 'var(--text-muted)';
          } else {
            icon = <Circle className="h-4 w-4" strokeWidth={1.5} />;
            dotColor = 'var(--text-muted)';
            labelColor = 'var(--text-muted)';
          }

          return (
            <div key={`${stageInfo.stage}-${idx}`} className="flex gap-3">
              {/* Timeline column */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: isCurrent ? 'color-mix(in srgb, var(--accent-purple) 15%, transparent)' : 'var(--bg-elevated)',
                    border: `2px solid ${dotColor}`,
                    color: dotColor,
                  }}
                >
                  {icon}
                </div>
                {idx < visibleStages.length - 1 && (
                  <div
                    className="w-0.5 flex-1 min-h-[24px]"
                    style={{
                      background: isPast || isCompleted
                        ? 'var(--accent-lime)'
                        : isCurrent
                        ? 'linear-gradient(to bottom, var(--accent-purple), var(--border-subtle))'
                        : 'var(--border-subtle)',
                    }}
                  />
                )}
              </div>

              {/* Content column */}
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium" style={{ color: labelColor }}>{stageInfo.label}</p>
                  {occurrences > 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-amber) 15%, transparent)', color: 'var(--accent-amber)' }}>
                      x{occurrences}
                    </span>
                  )}
                </div>
                {(() => {
                  // Find the approver name from signatures matching this stage
                  const stageSig = signatures.find((s: any) => {
                    if (!s.signed_at) return false;
                    const sigRole = String(s.signatory_role || '').toUpperCase();
                    const stageRole = stageInfo.stage.replace('PENDING_', '');
                    return sigRole === stageRole ||
                      sigRole.replace(/_/g, ' ') === stageRole.replace(/_/g, ' ') ||
                      (stageInfo.stage === 'PENDING_COORDINATOR' && (sigRole === 'PURCHASING_COORDINATOR' || sigRole === 'COORDINATOR')) ||
                      (stageInfo.stage === 'PENDING_MANAGER' && (sigRole === 'PURCHASING_MANAGER' || sigRole === 'MANAGER'));
                  });
                  if (isCompleted && stageSig?.signatory_name) {
                    return (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {stageSig.signatory_name} <span style={{ opacity: 0.6 }}>· {stageInfo.role}</span>
                      </p>
                    );
                  }
                  return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{stageInfo.role}</p>;
                })()}

                {ts && (
                  <div className="mt-1.5 space-y-0.5">
                    {ts.entered_at && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                        <Clock className="h-2.5 w-2.5" strokeWidth={2} />
                        In: {formatTimestamp(ts.entered_at)}
                      </p>
                    )}
                    {ts.exited_at && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                        <ArrowRight className="h-2.5 w-2.5" strokeWidth={2} />
                        Out: {formatTimestamp(ts.exited_at)}
                        {ts.entered_at && (
                          <span style={{ color: 'var(--text-subtle)' }}>
                            ({formatDuration(calcWorkingHoursElapsed(new Date(ts.entered_at), new Date(ts.exited_at)))})
                          </span>
                        )}
                      </p>
                    )}
                    {!ts.exited_at && ts.sla_hours > 0 && (
                      <SLAInline enteredAt={ts.entered_at} slaHours={ts.sla_hours} />
                    )}
                    {ts.is_breached && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--accent-red)' }}>
                        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
                        SLA breached
                      </p>
                    )}
                  </div>
                )}

                {isCurrent && returnedSignatures.length > 0 && (
                  <div className="mt-2 p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                    <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--accent-amber)' }}>
                      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                      Returned by {returnedSignatures.map((s: any) => s.signatory_role).join(', ')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Approval Signatures Summary */}
      {signatures.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Approval Chain</p>
          <div className="space-y-2">
            {signatures.map((sig: any, idx: number) => {
              const isSigned = sig.signed_at;
              const isReconfirmation = sig.approval_status === 'RECONFIRMATION_REQUIRED';
              const isSuperseded = sig.approval_status === 'SUPERSEDED';
              return (
                <div key={sig.id || idx} className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isSigned ? 'color-mix(in srgb, var(--accent-lime) 15%, transparent)' : isReconfirmation ? 'color-mix(in srgb, var(--accent-amber) 15%, transparent)' : 'var(--bg-card)',
                      border: `1px solid ${isSigned ? 'var(--accent-lime)' : isReconfirmation ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                    }}
                  >
                    {isSigned ? (
                      <CheckCircle className="h-3 w-3" style={{ color: 'var(--accent-lime)' }} strokeWidth={2.5} />
                    ) : isReconfirmation ? (
                      <AlertTriangle className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} strokeWidth={2.5} />
                    ) : (
                      <Circle className="h-3 w-3" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: isSuperseded ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: isSuperseded ? 'line-through' : 'none' }}>
                      {sig.signatory_name || sig.signatory_role}
                    </p>
                    {sig.signatory_name && (
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sig.signatory_role}</p>
                    )}
                    {isSigned && (
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        Signed {formatTimestamp(sig.signed_at)}
                      </p>
                    )}
                    {isReconfirmation && (
                      <p className="text-[10px]" style={{ color: 'var(--accent-amber)' }}>Needs reconfirmation</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SLABadge({ enteredAt, slaHours }: { enteredAt: string; slaHours: number }) {
  const elapsed = calcWorkingHoursElapsed(new Date(enteredAt), new Date());
  const remaining = slaHours - elapsed;
  const isOverdue = remaining <= 0;
  const isUrgent = remaining > 0 && remaining <= 24;

  if (!isOverdue && !isUrgent) return null;

  return (
    <div
      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{
        background: isOverdue ? 'var(--accent-red)' : 'color-mix(in srgb, var(--accent-amber) 15%, transparent)',
        color: isOverdue ? 'var(--text-inverse)' : 'var(--accent-amber)',
      }}
    >
      <Hourglass className="h-3 w-3" strokeWidth={2.5} />
      {isOverdue ? `SLA Overdue by ${formatDuration(Math.abs(remaining))}` : `SLA ${formatDuration(remaining)} left`}
    </div>
  );
}

function SLAInline({ enteredAt, slaHours }: { enteredAt: string; slaHours: number }) {
  const elapsed = calcWorkingHoursElapsed(new Date(enteredAt), new Date());
  const remaining = slaHours - elapsed;
  const isOverdue = remaining <= 0;
  const isUrgent = remaining > 0 && remaining <= 24;

  if (!isOverdue && !isUrgent) return null;

  return (
    <p className="text-[11px] flex items-center gap-1" style={{ color: isOverdue ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
      <Hourglass className="h-2.5 w-2.5" strokeWidth={2} />
      {isOverdue ? `SLA Overdue by ${formatDuration(Math.abs(remaining))}` : `SLA ${formatDuration(remaining)} left`}
    </p>
  );
}
