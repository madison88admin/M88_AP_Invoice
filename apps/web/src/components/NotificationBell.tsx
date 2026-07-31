import { useState, useEffect, useRef } from 'react';
import { Bell, CheckCircle, AlertTriangle, XCircle, X } from 'lucide-react';
import { notificationApi } from '../lib/api';
import { useToast } from '../contexts/ToastContext';

export default function NotificationBell() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const shownNotificationIds = useRef<Set<string>>(new Set());
  const isInitialLoad = useRef(true);
  const { toast } = useToast();

  const fetchNotifications = async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        notificationApi.getAll(20).catch(() => ({ data: [] })),
        notificationApi.getUnreadCount().catch(() => ({ data: { count: 0 } })),
      ]);
      const newNotifs = notifRes.data || [];
      const newCount = countRes.data?.count || 0;
      setNotifications(newNotifs);
      setUnreadCount(newCount);

      // Fire notifications for new unread items (skip on initial load)
      // Uses browser Notification API when user is NOT on the site (tab hidden/minimized)
      // Falls back to in-app toast when user IS on the site
      if (!isInitialLoad.current) {
        const isPageHidden = document.hidden || document.visibilityState === 'hidden';

        for (const n of newNotifs) {
          if (!n.is_read && !shownNotificationIds.current.has(n.id)) {
            shownNotificationIds.current.add(n.id);

            // 1. Browser notification — only when page is NOT visible
            if (isPageHidden && 'Notification' in window && Notification.permission === 'granted') {
              try {
                const browserNotif = new Notification(n.title || 'AP Invoice Notification', {
                  body: n.message || '',
                  icon: '/favicon.ico',
                  tag: n.id,
                });
                browserNotif.onclick = () => {
                  window.focus();
                  browserNotif.close();
                };
                setTimeout(() => browserNotif.close(), 8000);
              } catch {
                // ignore
              }
            }

            // 2. In-app toast — only when page IS visible (user is on the site)
            if (!isPageHidden) {
              const typeMap: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
                success: 'success',
                warning: 'warning',
                error: 'error',
                info: 'info',
              };
              toast.add({
                title: n.title || 'New Notification',
                description: n.message || '',
                type: typeMap[n.type] || 'info',
                action: n.invoice_number ? {
                  label: 'View',
                  onClick: () => window.open(`/?invoiceId=${n.invoice_id}`, '_self'),
                } : undefined,
              });
            }
          }
        }
      }

      // After initial load, mark all current notification IDs as "seen"
      if (isInitialLoad.current) {
        newNotifs.forEach((n: any) => shownNotificationIds.current.add(n.id));
        isInitialLoad.current = false;
      }
    } catch {
      // silent fail
    }
  };

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // silent fail
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await notificationApi.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // silent fail
    }
  };

  const iconMap: Record<string, any> = {
    success: CheckCircle,
    warning: AlertTriangle,
    error: XCircle,
    info: Bell,
  };
  const colorMap: Record<string, string> = {
    success: 'var(--accent-lime)',
    warning: 'var(--accent-amber)',
    error: 'var(--accent-red)',
    info: 'var(--accent-blue)',
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className="relative p-2.5 rounded-xl transition-colors"
        style={{ color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        title="Notifications"
      >
        <Bell className="h-5 w-5" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: 'var(--accent-red)', color: 'white' }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {showNotifications && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
          <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-96 rounded-2xl z-50 overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ background: 'var(--accent-red)', color: 'white' }}>{unreadCount} new</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs font-medium transition-colors" style={{ color: 'var(--accent-blue)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
                    Mark all read
                  </button>
                )}
                <button onClick={() => setShowNotifications(false)} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {notifications.length > 0 ? (
                notifications.map((n) => {
                  const Icon = iconMap[n.type] || Bell;
                  const color = colorMap[n.type] || 'var(--accent-blue)';
                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(n.created_at).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 1) return 'just now';
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    const days = Math.floor(hrs / 24);
                    return `${days}d ago`;
                  })();
                  return (
                    <div key={n.id} className="p-4 cursor-pointer transition-colors" style={{ borderBottom: '1px solid var(--border-subtle)', background: n.is_read ? 'transparent' : 'color-mix(in srgb, var(--accent-blue) 4%, transparent)' }}
                      onClick={() => { if (!n.is_read) handleMarkRead(n.id); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = n.is_read ? 'transparent' : 'color-mix(in srgb, var(--accent-blue) 4%, transparent)'; }}>
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-xl flex-shrink-0" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
                          <Icon className="h-4 w-4" style={{ color }} strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{n.title}</p>
                            {!n.is_read && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent-blue)' }} />}
                          </div>
                          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{n.message}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{timeAgo}</span>
                            {n.invoice_number && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)' }}>{n.invoice_number}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No notifications yet</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Stage transitions and updates will appear here</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
