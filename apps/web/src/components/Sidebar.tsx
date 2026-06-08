import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { 
  LayoutDashboard, 
  CheckSquare, 
  AlertTriangle, 
  Building2, 
  Package, 
  BarChart3, 
  FileSearch,
  ChevronLeft,
  ChevronRight,
  Bell,
  Settings,
  User
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
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <aside 
        className={`${collapsed ? 'w-20' : 'w-64'} bg-[#0F1C2E] text-white transition-all duration-300 ease-in-out flex flex-col`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="bg-[#2563EB] p-2 rounded-lg">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-lg">Madison 88</h1>
                <p className="text-xs text-gray-400">Business Solutions</p>
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
                  isActive
                    ? 'bg-[#2563EB] text-white shadow-lg'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon className={`h-5 w-5 flex-shrink-0 ${collapsed ? 'mx-auto' : ''}`} />
                {!collapsed && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse Toggle */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-full p-2 rounded-lg hover:bg-white/10 transition-colors"
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
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{getGreeting()}</p>
              <p className="text-xs text-gray-400">{formatDate()}</p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                to="/upload"
                className="px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] transition-colors font-medium"
              >
                Upload Invoice
              </Link>
              <button className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>
              <button className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
                <Settings className="h-5 w-5" />
              </button>
              <div className="w-8 h-8 bg-[#2563EB] rounded-full flex items-center justify-center">
                <User className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>
        </header>

        {/* Content Area - This will be filled by the routed component */}
        <main className="flex-1 overflow-auto bg-gray-50">
          {/* Children will be rendered here by the routing */}
        </main>
      </div>
    </div>
  );
}
