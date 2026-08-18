import { useState, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMockData } from '../contexts/MockDataContext';
import { getPendingApprovalsForUser, getApprovedByUser } from '../lib/approvalQueue';
import { ThemeToggle } from './ThemeToggle';
import NotificationBell from './NotificationBell';
import SidebarItem from './ui/SidebarItem';
import {
  LayoutDashboard, FileText, CheckSquare, AlertTriangle, Building2,
  Package, BarChart3, FileSearch, Users, Settings, ChevronLeft,
  Menu, X, LogOut, Upload, Pause, Activity, Gauge, History,
  ClipboardList, Landmark,
} from 'lucide-react';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  icon?: ReactNode;
}

interface NavItem {
  icon: any;
  label: string;
  path: string;
  roles?: string[];
  badgeKey?: string;
  badgeColor?: 'lime' | 'red' | 'amber' | 'blue' | 'purple';
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export default function AppLayout({ children, title, icon }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const currentPath = location.pathname;

  const navGroups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/', badgeKey: 'dashboard', badgeColor: 'blue' },
        { icon: FileText, label: 'Invoice Repository', path: '/repository', badgeKey: 'repository', badgeColor: 'purple' },
        { icon: Upload, label: 'Upload Invoice', path: '/upload', roles: ['PURCHASING_COORDINATOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN', 'INVOICE_UPLOADER'] },
      ],
    },
    {
      label: 'Workflow',
      items: [
        { icon: CheckSquare, label: 'Approvals', path: '/approvals', roles: ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY', 'ACCOUNTING_SUPERVISOR'], badgeKey: 'approvals', badgeColor: 'red' },
        { icon: History, label: 'Approved Invoices', path: '/approved-invoices', roles: ['PURCHASING_MANAGER'], badgeKey: 'approvedByMe', badgeColor: 'lime' },
        { icon: AlertTriangle, label: 'Exceptions', path: '/exceptions', roles: ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'IT_ADMIN'], badgeKey: 'exceptions', badgeColor: 'amber' },
        { icon: Pause, label: 'On-Hold Queue', path: '/on-hold-queue', roles: ['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN'], badgeKey: 'onhold', badgeColor: 'amber' },
      ],
    },
    {
      label: 'Accounting',
      items: [
        { icon: Package, label: 'Payment Batches', path: '/payment-batches', roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'], badgeKey: 'batches', badgeColor: 'lime' },
        { icon: FileSearch, label: 'Accounting Review', path: '/accounting-review', roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'], badgeKey: 'review', badgeColor: 'blue' },
        { icon: Landmark, label: 'Bank Details', path: '/bank-details', roles: ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN'] },
      ],
    },
    {
      label: 'Analytics',
      items: [
        { icon: BarChart3, label: 'Reports', path: '/reports', roles: ['PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'ACCOUNTING_ASSOCIATE', 'CC_REPORTS'] },
        { icon: AlertTriangle, label: 'Finance Controls', path: '/finance-controls', roles: ['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'CFO', 'IT_ADMIN'] },
        { icon: Gauge, label: 'SLA Analytics', path: '/sla-analytics', roles: ['ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'ACCOUNTING_ASSOCIATE', 'CC_REPORTS'] },
        { icon: Activity, label: 'Extraction Analytics', path: '/extraction-analytics', roles: ['PURCHASING_COORDINATOR', 'IT_ADMIN', 'ACCOUNTING_SUPERVISOR', 'CC_REPORTS'] },
      ],
    },
    {
      label: 'Admin',
      items: [
        { icon: ClipboardList, label: 'Audit Logs', path: '/audit-logs', roles: ['ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'ACCOUNTING_ASSOCIATE'] },
        { icon: Building2, label: 'Vendors', path: '/vendors', roles: ['IT_ADMIN'] },
        { icon: Users, label: 'User Management', path: '/users', roles: ['IT_ADMIN', 'SUPERADMIN'] },
        { icon: Settings, label: 'System Configuration', path: '/settings', roles: ['IT_ADMIN', 'SUPERADMIN'] },
      ],
    },
  ];

  // Compute badges from mock data
  const { invoices, vendors, paymentBatches } = useMockData();
  const badges: Record<string, number> = {
    dashboard: invoices.filter(i => ['RECEIVED', 'VALIDATION_PENDING', 'EXCEPTION_FLAGGED'].includes(i.status)).length,
    repository: invoices.length,
    workbench: invoices.filter(i => ['VALIDATION_PENDING', 'EXCEPTION_FLAGGED'].includes(i.status)).length,
    // Per-user pending queue — must match the Approval Inbox page count.
    approvals: getPendingApprovalsForUser(invoices, user).length,
    approvedByMe: getApprovedByUser(invoices, user).length,
    exceptions: invoices.filter(i => i.exceptions.some(e => e.status === 'OPEN' || e.status === 'PENDING')).length,
    onhold: invoices.filter(i => i.status === 'ON_HOLD').length,
    batches: paymentBatches.filter(b => b.status === 'DRAFT').length,
    review: invoices.filter(i => ['PENDING_ACCOUNTING', 'APPROVED', 'POSTED_TO_QB', 'PAID', 'PAYMENT_SCHEDULED'].includes(i.status)).length,
  };

  const visibleGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (user?.role === 'SUPERADMIN') {
        return true; // SUPERADMIN sees all sidebar items
      }
      if (user?.role === 'INVOICE_UPLOADER') {
        return item.path === '/' || item.label === 'Upload Invoice';
      }
      return !item.roles || item.roles.includes(user?.role || '') || user?.role === 'IT_ADMIN';
    }),
  })).filter(group => group.items.length > 0);

  const handleNavClick = (path: string) => {
    setMobileSidebarOpen(false);
    navigate(path);
  };

  const renderNavItems = (items: NavItem[], collapsed: boolean) => (
    items.map((item) => (
      <SidebarItem
        key={item.path}
        icon={item.icon}
        label={item.label}
        active={currentPath === item.path}
        badge={item.badgeKey ? badges[item.badgeKey] : undefined}
        badgeColor={item.badgeColor}
        collapsed={collapsed}
        onClick={() => handleNavClick(item.path)}
      />
    ))
  );

  const sidebarNav = (
    <nav className="flex-1 px-3 py-2 overflow-y-auto min-h-0">
      {visibleGroups.map((group, gIdx) => (
        <div key={group.label} className={gIdx > 0 ? 'mt-4' : ''}>
          {!sidebarCollapsed && (
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {group.label}
            </div>
          )}
          <div className="space-y-0.5">
            {renderNavItems(group.items, sidebarCollapsed)}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-screen relative" style={{ background: 'var(--bg-base)' }}>
      {/* Desktop Sidebar */}
      <aside
        className={`${sidebarCollapsed ? 'w-20' : 'w-64'} m-4 flex flex-col flex-shrink-0 transition-all duration-300 hidden md:flex z-10 rounded-3xl`}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)' }}
      >
        {/* Logo */}
        <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <img src="/madison-logo.png" alt="Madison 88" className="h-10 w-auto flex-shrink-0" />
          </div>
        </div>

        {sidebarNav}

        {/* Collapse Toggle */}
        <div className="p-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex items-center justify-center w-full p-2 rounded-lg transition-all duration-200"
            style={{ transition: 'all 200ms ease' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-card-hover)';
              const svg = e.currentTarget.querySelector('svg');
              if (svg) svg.style.transform = sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              const svg = e.currentTarget.querySelector('svg');
              if (svg) svg.style.transform = sidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
            }}
          >
            {sidebarCollapsed ? (
              <ChevronLeft className="h-5 w-5" style={{ transform: 'rotate(180deg)', transition: 'transform 200ms ease' }} />
            ) : (
              <ChevronLeft className="h-5 w-5" style={{ transform: 'rotate(0deg)', transition: 'transform 200ms ease' }} />
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setMobileSidebarOpen(false)} />
          <aside
            className="absolute left-0 top-0 bottom-0 w-64 flex flex-col animate-slide-in-left"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          >
            <div className="p-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <img src="/madison-logo.png" alt="Madison 88" className="h-10 w-auto flex-shrink-0" />
              <button onClick={() => setMobileSidebarOpen(false)} className="p-2 rounded-lg" style={{ color: 'var(--text-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-2 overflow-y-auto min-h-0">
              {visibleGroups.map((group, gIdx) => (
                <div key={group.label} className={gIdx > 0 ? 'mt-4' : ''}>
                  <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {renderNavItems(group.items, false)}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden z-10 my-4 mr-4 ml-0 md:ml-0">
        {/* Top Header */}
        <header className="px-4 md:px-6 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden p-2 rounded-xl transition-colors"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-card)' }}
              >
                <Menu className="h-5 w-5" strokeWidth={1.75} />
              </button>
              <div>
                <h1 className="text-lg md:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <NotificationBell />
              <ThemeToggle />
              {user && (
                <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-inverse)' }}>
                        {user.name.split(' ').map((n: string) => n[0]).join('')}
                      </span>
                    </div>
                    <div className="text-left hidden sm:block">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="p-2 rounded-xl transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto px-4 md:px-6 pt-2 pb-6 min-h-0">
          <div className="animate-page-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
