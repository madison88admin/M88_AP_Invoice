import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Bell, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  title: string;
  description?: string;
  message: string; // legacy — maps to title
  type: ToastType;
  duration: number;
  action?: ToastAction;
}

interface ToastOptions {
  title?: string;
  description?: string;
  type?: ToastType;
  duration?: number;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
  toast: {
    add: (options: ToastOptions) => string;
    close: (id: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((options: ToastOptions): string => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    const toast: Toast = {
      id,
      title: options.title || '',
      description: options.description,
      message: options.title || '',
      type: options.type || 'info',
      // Action feedback is presented as a blocking in-app dialog. Keep it open
      // until the user acknowledges it instead of disappearing like a toast.
      duration: options.duration ?? 0,
      action: options.action,
    };
    setToasts(prev => [...prev, toast]);
    if (toast.duration > 0) {
      setTimeout(() => dismissToast(id), toast.duration);
    }
    return id;
  }, [dismissToast]);

  // Legacy showToast — kept for backward compatibility
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    addToast({ title: message, type });
  }, [addToast]);

  const iconMap: Record<ToastType, typeof CheckCircle> = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Bell,
  };

  const colorMap: Record<ToastType, string> = {
    success: 'var(--accent-lime)',
    error: 'var(--accent-red)',
    warning: 'var(--accent-amber)',
    info: 'var(--accent-purple)',
  };

  return (
    <ToastContext.Provider value={{ showToast, toast: { add: addToast, close: dismissToast } }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="presentation">
        {toasts.slice(0, 1).map(toast => {
          const Icon = iconMap[toast.type];
          const color = colorMap[toast.type];
          return (
            <div
              key={toast.id}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`notification-title-${toast.id}`}
              className="w-full max-w-md rounded-2xl border shadow-2xl animate-modal-in flex items-start gap-3 p-5"
              style={{
                background: 'var(--bg-card)',
                borderLeft: `3px solid ${color}`,
                borderColor: 'var(--border-color)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                borderRadius: '16px',
              }}
            >
              <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color }} strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <p id={`notification-title-${toast.id}`} className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {toast.title || toast.message}
                </p>
                {toast.description && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {toast.description}
                  </p>
                )}
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action!.onClick();
                      dismissToast(toast.id);
                    }}
                    className="mt-2 px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: `color-mix(in srgb, ${color} 12%, transparent)`,
                      color,
                      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 20%, transparent)`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 12%, transparent)`; }}
                  >
                    {toast.action.label}
                  </button>
                )}
                {!toast.action && (
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold"
                    style={{ background: color, color: 'var(--text-inverse)' }}
                  >OK</button>
                )}
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="flex-shrink-0 p-1 rounded transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          );
        })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: (msg: string) => console.log('[toast]', msg),
      toast: {
        add: (options: ToastOptions) => { console.log('[toast]', options); return ''; },
        close: (id: string) => {},
      },
    };
  }
  return ctx;
}
