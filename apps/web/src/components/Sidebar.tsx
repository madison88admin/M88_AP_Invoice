import { Link, useLocation } from 'react-router-dom';
import { useState, MouseEvent } from 'react';
import { 
  LayoutDashboard, 
  CheckSquare, 
  AlertTriangle, 
  Building2, 
  Package, 
  BarChart3, 
  FileSearch,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Bell,
  Settings,
  User,
  Activity,
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: any;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Approvals', path: '/approvals', icon: CheckSquare },
  { label: 'Exceptions', path: '/exceptions', icon: AlertTriangle },
  { label: 'Vendors', path: '/vendors', icon: Building2 },
  { label: 'Batches', path: '/payment-batches', icon: Package },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
  { label: 'Review', path: '/accounting-review', icon: FileSearch },
  { label: 'Audit Logs', path: '/audit-logs', icon: ClipboardList },
  { label: 'Extraction Analytics', path: '/extraction-analytics', icon: Activity },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const formatDate = () => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-elevated)' }}>
      {/* Sidebar */}
      <aside 
        className={`${collapsed ? 'w-20' : 'w-64'} text-white transition-all duration-300 ease-in-out flex flex-col`}
        style={{ background: 'var(--bg-card)' }}
      >
        {/* Logo */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: 'var(--accent-blue)' }}>
              <LayoutDashboard className="h-6 w-6 text-white" />
            </div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>Madison 88</h1>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Business Solutions</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive ? 'text-white shadow-lg' : ''
                }`}
                style={
                  isActive
                    ? { background: 'var(--accent-blue)' }
                    : { color: 'var(--text-secondary)' }
                }
                onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-card-hover)';
                  }
                }}
                onMouseLeave={(e: MouseEvent<HTMLAnchorElement>) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLAnchorElement).style.background = '';
                  }
                }}
              >
                <item.icon className={`h-5 w-5 flex-shrink-0 ${collapsed ? 'mx-auto' : ''}`} />
                {!collapsed && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse Toggle */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full p-2 rounded-lg transition-colors"
            onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)';
            }}
            onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
              (e.currentTarget as HTMLButtonElement).style.background = '';
            }}
          >
            {collapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="px-6 py-4 border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{getGreeting()}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate()}</p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                to="/upload"
                className="px-4 py-2 text-white rounded-lg transition-colors font-medium"
                style={{ background: 'var(--accent-blue)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-blue-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-blue)'; }}
              >
                Upload Invoice
              </Link>
              <button className="relative p-2 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = ''; }}
              >
                <Bell className="h-5 w-5" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'var(--accent-red)' }} />
              </button>
              <button className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = ''; }}
              >
                <Settings className="h-5 w-5" />
              </button>
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-blue)' }}>
                <User className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>
        </header>

        {/* Content Area - This will be filled by the routed component */}
        <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-base)' }}>
          {/* Children will be rendered here by the routing */}
        </main>
      </div>
    </div>
  );
}
