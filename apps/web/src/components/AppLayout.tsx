import { useState, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from './ThemeToggle';
import SidebarItem from './ui/SidebarItem';
import {
  LayoutDashboard, FileText, CheckSquare, AlertTriangle, Building2,
  Package, BarChart3, FileSearch, Users, Settings, ChevronLeft,
  Menu, X, LogOut,
} from 'lucide-react';

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  icon?: ReactNode;
}

export default function AppLayout({ children, title, icon }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const currentPath = location.pathname;

  const navItems: { icon: any; label: string; path: string; roles?: string[] }[] = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: FileText, label: 'Invoice Repository', path: '/repository' },
    { icon: CheckSquare, label: 'Approvals', path: '/approvals', roles: ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY', 'ACCOUNTING_SUPERVISOR'] },
    { icon: AlertTriangle, label: 'Exceptions', path: '/exceptions', roles: ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'IT_ADMIN'] },
    { icon: Building2, label: 'Vendors', path: '/vendors', roles: ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE'] },
    { icon: Package, label: 'Batches', path: '/payment-batches', roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'] },
    { icon: BarChart3, label: 'Reports', path: '/reports', roles: ['PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR'] },
    { icon: FileSearch, label: 'Review', path: '/accounting-review', roles: ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'] },
    { icon: Users, label: 'User Management', path: '/users', roles: ['IT_ADMIN', 'SUPERADMIN'] },
    { icon: Settings, label: 'System Configuration', path: '/settings', roles: ['IT_ADMIN', 'SUPERADMIN'] },
  ];

  const visibleNavItems = navItems.filter(item => !item.roles || (user && item.roles.includes(user.role)));

  const handleNavClick = (path: string) => {
    setMobileSidebarOpen(false);
    navigate(path);
  };

  const sidebarNav = (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {visibleNavItems.map((item) => (
        <SidebarItem
          key={item.path}
          icon={item.icon}
          label={item.label}
          active={currentPath === item.path}
          collapsed={sidebarCollapsed}
          onClick={() => handleNavClick(item.path)}
        />
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
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => (
                <SidebarItem
                  key={item.path}
                  icon={item.icon}
                  label={item.label}
                  active={currentPath === item.path}
                  collapsed={false}
                  onClick={() => handleNavClick(item.path)}
                />
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden z-10">
        {/* Top Header */}
        <header className="px-4 md:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden p-2 rounded-xl transition-colors"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-card)' }}
              >
                <Menu className="h-5 w-5" strokeWidth={1.75} />
              </button>
              {icon}
              <div>
                <h1 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </h1>
                {user && (
                  <span className="inline-block mt-1 px-3 py-1 text-xs font-medium rounded-full" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                    {user.role.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <ThemeToggle />
              {user && (
                <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-2 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}>
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-inverse)' }}>
                        {user.name.split(' ').map((n: string) => n[0]).join('')}
                      </span>
                    </div>
                    <div className="text-left hidden sm:block">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user.title || user.role.replace(/_/g, ' ')}</p>
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
        <main className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
          <div className="animate-page-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
