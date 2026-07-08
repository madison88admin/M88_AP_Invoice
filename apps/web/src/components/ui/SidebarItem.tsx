import { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: number | string;
  onClick?: () => void;
  collapsed?: boolean;
}

export default function SidebarItem({ icon: Icon, label, active, badge, onClick, collapsed }: SidebarItemProps) {
  const [hovered, setHovered] = useState(false);

  const buttonStyle: React.CSSProperties = active
    ? {
        background: 'color-mix(in srgb, var(--accent-purple) 15%, transparent)',
        color: 'var(--text-primary)',
        boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 15%, transparent)',
      }
    : {
        color: hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
        background: hovered ? 'var(--bg-card-hover)' : 'transparent',
      };

  const iconStyle: React.CSSProperties = {
    color: active ? 'var(--accent-purple)' : hovered ? 'var(--text-secondary)' : 'var(--text-muted)',
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
        active && 'relative before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-[--accent-purple]'
      )}
      style={buttonStyle}
      title={collapsed ? label : undefined}
    >
      <Icon
        className="h-5 w-5 flex-shrink-0"
        style={iconStyle}
        strokeWidth={active ? 2.25 : 1.75}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          {badge !== undefined && badge !== 0 && (
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
              style={{
                background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)',
                color: 'var(--accent-lime)',
                border: '1px solid color-mix(in srgb, var(--accent-lime) 20%, transparent)',
              }}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
