import type { CSSProperties } from 'react';

type ExceptionStatus = 'OPEN' | 'RESOLVED' | 'WAIVED' | string;

export function getStatusStyle(status: ExceptionStatus): CSSProperties {
  switch (status) {
    case 'OPEN':
      return {
        background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)',
        color: 'var(--accent-amber)',
        border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)',
      };
    case 'RESOLVED':
      return {
        background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
        color: 'var(--accent-green)',
        border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)',
      };
    case 'WAIVED':
      return {
        background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)',
        color: 'var(--accent-blue)',
        border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)',
      };
    default:
      return {
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-color)',
      };
  }
}
