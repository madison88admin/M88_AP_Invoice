import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' };
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
  className?: string;
}

const accentBorderStyles = {
  default: 'var(--border-color)',
  success: 'color-mix(in srgb, var(--accent-green) 20%, transparent)',
  warning: 'color-mix(in srgb, var(--accent-amber) 20%, transparent)',
  danger: 'color-mix(in srgb, var(--accent-red) 20%, transparent)',
  info: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)',
};

const accentIconBgStyles = {
  default: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
  success: 'color-mix(in srgb, var(--accent-green) 10%, transparent)',
  warning: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
  danger: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
  info: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)',
};

const accentIconColorStyles = {
  default: 'var(--accent-purple)',
  success: 'var(--accent-lime)',
  warning: 'var(--accent-amber)',
  danger: 'var(--accent-red)',
  info: 'var(--accent-blue)',
};

const accentTrendColorStyles = {
  up: 'var(--accent-lime)',
  down: 'var(--accent-red)',
  neutral: 'var(--text-muted)',
};

export default function StatCard({ title, value, icon: Icon, trend, accent = 'default', onClick, className }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl p-5 border transition-all duration-200',
        onClick && 'cursor-pointer',
        className
      )}
      style={{
        background: 'var(--metric-card-bg)',
        borderColor: accentBorderStyles[accent],
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)'; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--metric-card-bg)'; } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{title}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
          {trend && (
            <p className="mt-1.5 text-xs font-medium flex items-center gap-1" style={{ color: accentTrendColorStyles[trend.direction] }}>
              {trend.direction === 'up' && <span>↑</span>}
              {trend.direction === 'down' && <span>↓</span>}
              {trend.value}
            </p>
          )}
        </div>
        <div
          className="rounded-xl p-2.5"
          style={{
            background: accentIconBgStyles[accent],
            border: `1px solid color-mix(in srgb, ${accentIconColorStyles[accent]} 12%, transparent)`,
          }}
        >
          <Icon className="h-5 w-5" style={{ color: accentIconColorStyles[accent] }} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
