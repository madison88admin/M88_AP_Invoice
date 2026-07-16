import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Bell, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

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
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-[calc(100vw-2rem)]">
        {toasts.map(toast => {
          const Icon = iconMap[toast.type];
          const color = colorMap[toast.type];
          return (
            <div
              key={toast.id}
              className="rounded-xl border shadow-2xl animate-slide-in-right flex items-start gap-3 p-3 pr-2"
              style={{
                background: 'var(--bg-card)',
                borderLeft: `3px solid ${color}`,
                borderColor: 'var(--border-color)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                minWidth: '280px',
                maxWidth: '400px',
                borderRadius: '12px',
              }}
            >
              <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color }} strokeWidth={1.75} />
              <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{toast.message}</span>
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
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { showToast: (msg: string) => console.log('[toast]', msg) };
  }
  return ctx;
}
