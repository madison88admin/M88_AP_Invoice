import { MockInvoice } from '../lib/mockData';
import { hasPermission, canUserApproveStatus } from '../lib/roleAccess';
import { InvoiceStatus } from '@ap-invoice/shared';
import { CheckCircle, AlertTriangle, Send, Clock, FileText } from 'lucide-react';

interface MyTasksWidgetProps {
  user: { role: string; name: string; email: string } | null;
  invoices: MockInvoice[];
  onFilterClick: (status: InvoiceStatus | undefined) => void;
}

export default function MyTasksWidget({ user, invoices, onFilterClick }: MyTasksWidgetProps) {
  if (!user) return null;

  const role = user.role;

  const pendingApprovals = invoices.filter(
    inv => inv.status && canUserApproveStatus(role, String(inv.status))
  );

  const pendingPosts = hasPermission(role, 'canPost')
    ? invoices.filter(inv => inv.status === InvoiceStatus.PENDING_ACCOUNTING || inv.status === InvoiceStatus.APPROVED)
    : [];

  const pendingPayments = hasPermission(role, 'canSchedulePayment')
    ? invoices.filter(inv => inv.status === InvoiceStatus.POSTED_TO_QB)
    : [];

  const pendingExceptions = hasPermission(role, 'canEditInvoice')
    ? invoices.filter(inv => inv.status === InvoiceStatus.EXCEPTION_FLAGGED)
    : [];

  const tasks = [
    {
      label: 'Pending Approvals',
      count: pendingApprovals.length,
      icon: CheckCircle,
      color: 'var(--accent-amber)',
      bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
      border: 'color-mix(in srgb, var(--accent-amber) 20%, transparent)',
      status: undefined as InvoiceStatus | undefined,
      show: pendingApprovals.length > 0,
    },
    {
      label: 'Ready to Post',
      count: pendingPosts.length,
      icon: Send,
      color: 'var(--accent-purple)',
      bg: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
      border: 'color-mix(in srgb, var(--accent-purple) 20%, transparent)',
      status: InvoiceStatus.PENDING_ACCOUNTING,
      show: pendingPosts.length > 0,
    },
    {
      label: 'Ready to Schedule',
      count: pendingPayments.length,
      icon: Clock,
      color: 'var(--accent-violet)',
      bg: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)',
      border: 'color-mix(in srgb, var(--accent-violet) 20%, transparent)',
      status: InvoiceStatus.POSTED_TO_QB,
      show: pendingPayments.length > 0,
    },
    {
      label: 'Exceptions to Resolve',
      count: pendingExceptions.length,
      icon: AlertTriangle,
      color: 'var(--accent-red)',
      bg: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
      border: 'color-mix(in srgb, var(--accent-red) 20%, transparent)',
      status: InvoiceStatus.EXCEPTION_FLAGGED,
      show: pendingExceptions.length > 0,
    },
  ].filter(t => t.show);

  if (tasks.length === 0) {
    return (
      <div className="p-4 mb-6 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
        <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
          <FileText className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
          No tasks requiring your attention right now.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <FileText className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
        My Tasks
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {tasks.map((task, idx) => (
          <button
            key={task.label}
            onClick={() => onFilterClick(task.status)}
            className="p-4 rounded-xl transition-all duration-200 text-left animate-fade-in-up card-lift"
            style={{ background: task.bg, border: `1px solid ${task.border}`, animationDelay: `${idx * 60}ms` }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = task.bg; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold" style={{ color: task.color, fontVariantNumeric: 'tabular-nums' }}>{task.count}</span>
              <task.icon className="h-5 w-5" style={{ color: task.color }} strokeWidth={1.75} />
            </div>
            <p className="text-sm mt-2" style={{ color: 'var(--text-primary)' }}>{task.label}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Click to filter</p>
          </button>
        ))}
      </div>
    </div>
  );
}
