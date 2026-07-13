import { cn } from '../../lib/utils';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusMap: Record<string, { label: string; styleObj: React.CSSProperties }> = {
  RECEIVED: {
    label: 'Received',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  OCR_PROCESSING: {
    label: 'OCR Processing',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-violet) 8%, transparent)',
      color: 'var(--accent-violet)',
      borderColor: 'color-mix(in srgb, var(--accent-violet) 25%, transparent)',
    },
  },
  VALIDATION_PENDING: {
    label: 'Validation Pending',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)',
      color: 'var(--accent-blue)',
      borderColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)',
    },
  },
  EXCEPTION_FLAGGED: {
    label: 'Exception',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)',
      color: 'var(--accent-red)',
      borderColor: 'color-mix(in srgb, var(--accent-red) 25%, transparent)',
    },
  },
  PENDING_COORDINATOR: {
    label: 'Pending Coordinator',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  PENDING_MANAGER: {
    label: 'Pending Manager',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  PENDING_MLO_ACCOUNT_HOLDER: {
    label: 'Pending MLO Account Holder',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  PENDING_MLO_PLANNING_MANAGER: {
    label: 'Pending MLO Planning Manager',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  PENDING_SR_MANAGER: {
    label: 'Pending Sr Manager',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  PENDING_POLLY: {
    label: 'Pending Polly',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
  PENDING_ACCOUNTING: {
    label: 'Pending Accounting',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)',
      color: 'var(--accent-blue)',
      borderColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)',
    },
  },
  APPROVED: {
    label: 'Approved',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-lime) 10%, transparent)',
      color: 'var(--accent-lime)',
      borderColor: 'color-mix(in srgb, var(--accent-lime) 30%, transparent)',
    },
  },
  POSTED_TO_QB: {
    label: 'Posted to QB',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)',
      color: 'var(--accent-blue)',
      borderColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)',
    },
  },
  PAYMENT_SCHEDULED: {
    label: 'Payment Scheduled',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)',
      color: 'var(--accent-blue)',
      borderColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)',
    },
  },
  PAID: {
    label: 'Paid',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-lime) 10%, transparent)',
      color: 'var(--accent-lime)',
      borderColor: 'color-mix(in srgb, var(--accent-lime) 30%, transparent)',
    },
  },
  PAYMENT_CONFIRMATION_SENT: {
    label: 'Confirmation Sent',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
      color: 'var(--accent-green)',
      borderColor: 'color-mix(in srgb, var(--accent-green) 30%, transparent)',
    },
  },
  REJECTED: {
    label: 'Rejected',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)',
      color: 'var(--accent-red)',
      borderColor: 'color-mix(in srgb, var(--accent-red) 25%, transparent)',
    },
  },
  ON_HOLD: {
    label: 'On Hold',
    styleObj: {
      background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
      color: 'var(--accent-amber)',
      borderColor: 'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
    },
  },
};

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const mapped = statusMap[status] || {
    label: status.replace(/_/g, ' '),
    styleObj: {
      background: 'var(--bg-elevated)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--border-color)',
    },
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        className
      )}
      style={mapped.styleObj}
    >
      {mapped.label}
    </span>
  );
}
