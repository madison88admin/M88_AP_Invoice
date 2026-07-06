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
    ? invoices.filter(inv => inv.status === InvoiceStatus.APPROVED)
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
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      status: undefined as InvoiceStatus | undefined,
      show: pendingApprovals.length > 0,
    },
    {
      label: 'Ready to Post',
      count: pendingPosts.length,
      icon: Send,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      status: InvoiceStatus.APPROVED,
      show: pendingPosts.length > 0,
    },
    {
      label: 'Ready to Schedule',
      count: pendingPayments.length,
      icon: Clock,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
      status: InvoiceStatus.POSTED_TO_QB,
      show: pendingPayments.length > 0,
    },
    {
      label: 'Exceptions to Resolve',
      count: pendingExceptions.length,
      icon: AlertTriangle,
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      status: InvoiceStatus.EXCEPTION_FLAGGED,
      show: pendingExceptions.length > 0,
    },
  ].filter(t => t.show);

  if (tasks.length === 0) {
    return (
      <div className="p-4 mb-6 bg-white/5 border border-white/10 rounded-lg">
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#6366f1]" />
          No tasks requiring your attention right now.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-[#6366f1]" />
        My Tasks
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {tasks.map((task) => (
          <button
            key={task.label}
            onClick={() => onFilterClick(task.status)}
            className={`p-4 ${task.bg} border ${task.border} rounded-lg hover:bg-white/10 transition-colors text-left`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-2xl font-bold ${task.color}`}>{task.count}</span>
              <task.icon className={`h-5 w-5 ${task.color}`} />
            </div>
            <p className="text-sm text-white mt-2">{task.label}</p>
            <p className="text-xs text-slate-400 mt-1">Click to filter</p>
          </button>
        ))}
      </div>
    </div>
  );
}
