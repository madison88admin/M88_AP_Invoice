import { cn } from '../../lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: React.CSSProperties;
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};

export function Spinner({ size = 'md', className, style }: SpinnerProps) {
  return (
    <div
      className={cn('animate-spin rounded-full border-2', sizeMap[size], className)}
      style={{
        borderTopColor: 'var(--accent-purple)',
        borderRightColor: 'var(--accent-purple)',
        borderBottomColor: 'transparent',
        borderLeftColor: 'transparent',
        ...style,
      }}
    />
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-base)' }}>
      <div className="relative">
        <div
          className="absolute inset-0 rounded-full animate-ping opacity-20"
          style={{ background: 'var(--accent-purple)' }}
        />
        <Spinner size="lg" />
      </div>
      {label && (
        <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
      )}
    </div>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <Spinner size="md" />
      {label && (
        <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
      )}
    </div>
  );
}
