import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AuditTileProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  status?: 'success' | 'warning' | 'danger' | 'neutral' | 'info';
  onClick?: () => void;
}

const statusIconBg: Record<string, React.CSSProperties> = {
  success: { background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' },
  warning: { background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' },
  danger:  { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',   border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' },
  info:    { background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)',   border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' },
  neutral: { background: 'var(--bg-card-hover)',                                       border: '1px solid var(--border-subtle)' },
};

const statusIconColor: Record<string, string> = {
  success: 'var(--accent-lime)',
  warning: 'var(--accent-amber)',
  danger:  'var(--accent-red)',
  info:    'var(--accent-blue)',
  neutral: 'var(--text-secondary)',
};

const statusValueColor: Record<string, string> = {
  success: 'var(--accent-lime)',
  warning: 'var(--accent-amber)',
  danger:  'var(--accent-red)',
  info:    'var(--accent-blue)',
  neutral: 'var(--text-primary)',
};

export default function AuditTile({ label, value, icon: Icon, status = 'neutral', onClick }: AuditTileProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)'; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; } : undefined}
      className={cn(
        'flex items-center gap-3 px-4 py-3 text-left transition-all duration-200',
      )}
      style={{ borderRight: '1px solid var(--border-subtle)' }}
    >
      <div
        className="inline-flex rounded-xl p-2"
        style={statusIconBg[status]}
      >
        <Icon className="h-4 w-4" style={{ color: statusIconColor[status] }} strokeWidth={1.75} />
      </div>
      <div>
        <p
          className="text-xl font-bold leading-tight"
          style={{ fontVariantNumeric: 'tabular-nums', color: statusValueColor[status] }}
        >
          {value}
        </p>
        <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
    </button>
  );
}
