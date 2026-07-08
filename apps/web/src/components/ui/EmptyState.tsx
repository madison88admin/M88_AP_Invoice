import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  compact?: boolean;
}

export default function EmptyState({ icon: Icon, title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-6' : 'py-10', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
        <Icon className="h-5 w-5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
      </div>
      <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      {description && (
        <p className="mt-1 max-w-[240px] text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 text-xs font-medium transition-colors"
          style={{ color: 'var(--accent-purple)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-lime)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
