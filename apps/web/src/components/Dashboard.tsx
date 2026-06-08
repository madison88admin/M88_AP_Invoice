import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Invoice, InvoiceStatus, InvoiceCategory, InvoiceType } from '@ap-invoice/shared';
import { invoiceApi } from '../lib/api';
import InvoiceTable from './InvoiceTable';
import UploadInvoiceModal from './UploadInvoiceModal';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useInvoices } from '../hooks/useInvoices';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Clock, AlertTriangle, CheckCircle, Shield, CheckSquare, XCircle, Send, AlertCircle, Package, BarChart3, FileSearch, PenTool, DollarSign, TrendingUp, Search, Bell, Settings, User, LayoutDashboard, Building2, ChevronLeft } from 'lucide-react';

// Custom hook for number count-up animation
function useCountUp(end: number, duration: number = 1200, start: boolean = true) {
  const [count, setCount] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const startTimeRef = useRef<number>(0);
  const endRef = useRef(end);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    endRef.current = end;
  }, [end]);

  useEffect(() => {
    if (!start || !isAnimating) return;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out expo function
      const easeOutExpo = (t: number) => {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      };
      
      const currentCount = Math.floor(easeOutExpo(progress) * endRef.current);
      setCount(currentCount);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        setCount(endRef.current);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isAnimating, duration, start]);

  const startAnimation = () => {
    setCount(0);
    setIsAnimating(true);
    startTimeRef.current = 0;
  };

  return { count, startAnimation };
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [posting, setPosting] = useState(false);
  const [showSchedulePaymentModal, setShowSchedulePaymentModal] = useState(false);
  const [paymentDate, setPaymentDate] = useState('');
  const [filters, setFilters] = useState({
    status: undefined as InvoiceStatus | undefined,
    category: undefined as InvoiceCategory | undefined,
    type: undefined as InvoiceType | undefined,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [progressAnimated, setProgressAnimated] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [countUpStarted, setCountUpStarted] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch dashboard stats from Supabase
  const { data: dashboardStats, isLoading: statsLoading } = useDashboardStats();

  // Fetch invoices from Supabase
  const { data: invoicesData, isLoading: invoicesLoading, refetch: refetchInvoices } = useInvoices(filters, page);

  // Convert Supabase data to Invoice format
  const invoices = invoicesData?.data || [];

  // Update loading state
  useEffect(() => {
    setLoading(invoicesLoading);
  }, [invoicesLoading]);

  // Update hasMore based on total count
  useEffect(() => {
    setHasMore(invoicesData ? invoicesData.total > page * 20 : true);
  }, [invoicesData, page]);

  // Real-time updates with Supabase subscription
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const channel = supabase
      .channel('invoices-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoices',
        },
        () => {
          // Invalidate queries when invoices change
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
        }
      )
      .subscribe();

    return () => {
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [queryClient]);

  // Count-up animations for each KPI - use Supabase data if available, otherwise fallback to local data
  const pendingValidationCount = useCountUp(dashboardStats?.pendingValidation || 0, 1200, countUpStarted && !statsLoading);
  const awaitingApprovalCount = useCountUp(dashboardStats?.awaitingApproval || 0, 1200, countUpStarted && !statsLoading);
  const urgentPaymentsCount = useCountUp(dashboardStats?.urgentPayments || 0, 1200, countUpStarted && !statsLoading);
  const handwrittenDocsCount = useCountUp(dashboardStats?.handwrittenDocs || 0, 1200, countUpStarted && !statsLoading);
  const nonUsdInvoicesCount = useCountUp(dashboardStats?.nonUsdInvoices || 0, 1200, countUpStarted && !statsLoading);
  const paidThisWeekCount = useCountUp(dashboardStats?.paidThisWeek || 0, 1200, countUpStarted && !statsLoading);
  const totalAmountCount = useCountUp(Math.floor(dashboardStats?.totalAmount || 0), 1200, countUpStarted && !statsLoading);
  const exceptionsCount = useCountUp(dashboardStats?.exceptions || 0, 1200, countUpStarted && !statsLoading);

  // Format trend percentage
  const formatTrend = (trend: number) => {
    const sign = trend >= 0 ? '+' : '';
    return `${sign}${trend.toFixed(1)}%`;
  };

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = Date.now().toString();
    const newToast = { id, message, type };
    setToasts(prev => [...prev, newToast]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    // Animate progress bars after component mounts
    setTimeout(() => setProgressAnimated(true), 100);
    // Trigger count-up animations
    setTimeout(() => setCountUpStarted(true), 200);
  }, []);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !invoicesLoading) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => {
      if (sentinelRef.current) {
        observer.unobserve(sentinelRef.current);
      }
    };
  }, [hasMore, invoicesLoading]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning ☀️';
    if (hour < 18) return 'Good afternoon 🌤';
    return 'Good evening 🌙';
  };

  const handleValidate = async () => {
    if (!selectedInvoice) return;

    try {
      setValidating(true);
      const response = await invoiceApi.validate(selectedInvoice.id);
      setValidationResult(response.data);
      // Reload invoices to get updated status and exceptions
      await refetchInvoices();
      // Reload selected invoice with updated data
      const updatedInvoice = await invoiceApi.getById(selectedInvoice.id);
      setSelectedInvoice(updatedInvoice.data);
    } catch (error) {
      console.error('Failed to validate invoice:', error);
    } finally {
      setValidating(false);
    }
  };

  const handleApprove = async (invoiceId: string) => {
    try {
      const signerName = 'Current User'; // In production, this would come from user context
      await invoiceApi.approve(invoiceId, signerName);
      showToast('Invoice approved successfully', 'success');
      await refetchInvoices();
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Failed to approve invoice:', error);
      showToast('Failed to approve invoice', 'error');
    }
  };

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim()) return;

    try {
      await invoiceApi.reject(selectedInvoice.id, rejectReason);
      showToast('Invoice rejected successfully', 'success');
      await refetchInvoices();
      setSelectedInvoice(null);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      console.error('Failed to reject invoice:', error);
      showToast('Failed to reject invoice', 'error');
    }
  };

  const handlePost = async () => {
    if (!selectedInvoice) return;

    try {
      setPosting(true);
      await invoiceApi.post(selectedInvoice.id);
      showToast('Invoice posted to accounting successfully', 'success');
      await refetchInvoices();
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Failed to post invoice:', error);
      showToast('Failed to post invoice', 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleSchedulePayment = async () => {
    if (!selectedInvoice || !paymentDate) return;

    try {
      await invoiceApi.schedulePayment(selectedInvoice.id, paymentDate);
      showToast('Payment scheduled successfully', 'success');
      await refetchInvoices();
      setSelectedInvoice(null);
      setShowSchedulePaymentModal(false);
      setPaymentDate('');
    } catch (error) {
      console.error('Failed to schedule payment:', error);
      showToast('Failed to schedule payment', 'error');
    }
  };

  const kpis = [
    {
      label: 'Pending Validation',
      value: pendingValidationCount.count,
      icon: FileText,
      color: '#2563EB',
      trend: dashboardStats ? formatTrend(dashboardStats.pendingValidationTrend) : '+12%',
      trendUp: dashboardStats ? dashboardStats.pendingValidationTrend >= 0 : true,
    },
    {
      label: 'Awaiting Approval',
      value: awaitingApprovalCount.count,
      icon: Clock,
      color: '#7C3AED',
      trend: dashboardStats ? formatTrend(dashboardStats.awaitingApprovalTrend) : '+5%',
      trendUp: dashboardStats ? dashboardStats.awaitingApprovalTrend >= 0 : true,
    },
    {
      label: 'Urgent Payments',
      value: urgentPaymentsCount.count,
      icon: AlertTriangle,
      color: '#DC2626',
      trend: dashboardStats ? formatTrend(dashboardStats.urgentPaymentsTrend) : '-3%',
      trendUp: dashboardStats ? dashboardStats.urgentPaymentsTrend >= 0 : false,
    },
    {
      label: 'Handwritten Docs',
      value: handwrittenDocsCount.count,
      icon: PenTool,
      color: '#F59E0B',
      trend: dashboardStats ? formatTrend(dashboardStats.handwrittenDocsTrend) : '+8%',
      trendUp: dashboardStats ? dashboardStats.handwrittenDocsTrend >= 0 : true,
    },
    {
      label: 'Non-USD Invoices',
      value: nonUsdInvoicesCount.count,
      icon: DollarSign,
      color: '#0891B2',
      trend: dashboardStats ? formatTrend(dashboardStats.nonUsdInvoicesTrend) : '+15%',
      trendUp: dashboardStats ? dashboardStats.nonUsdInvoicesTrend >= 0 : true,
    },
    {
      label: 'Paid This Week',
      value: paidThisWeekCount.count,
      icon: CheckCircle,
      color: '#059669',
      trend: dashboardStats ? formatTrend(dashboardStats.paidThisWeekTrend) : '+22%',
      trendUp: dashboardStats ? dashboardStats.paidThisWeekTrend >= 0 : true,
    },
    {
      label: 'Total Amount',
      value: `$${totalAmountCount.count.toLocaleString()}`,
      icon: TrendingUp,
      color: '#4F46E5',
      trend: dashboardStats ? formatTrend(dashboardStats.totalAmountTrend) : '+18%',
      trendUp: dashboardStats ? dashboardStats.totalAmountTrend >= 0 : true,
    },
    {
      label: 'Exceptions',
      value: exceptionsCount.count,
      icon: AlertCircle,
      color: '#DB2777',
      trend: dashboardStats ? formatTrend(dashboardStats.exceptionsTrend) : '-7%',
      trendUp: dashboardStats ? dashboardStats.exceptionsTrend >= 0 : false,
    },
  ];

  return (
    <div className="flex h-screen relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
      {/* Layered Background Atmosphere */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* Purple orb top-right */}
        <div 
          style={{ 
            position: 'absolute', 
            top: '-10%', 
            right: '-5%', 
            width: '500px', 
            height: '500px',
            background: 'radial-gradient(circle, rgba(139,92,246,0.25), transparent 70%)',
            filter: 'blur(60px)', 
            animation: 'drift1 10s ease-in-out infinite alternate'
          }}
        />
        {/* Blue orb bottom-left */}
        <div 
          style={{ 
            position: 'absolute', 
            bottom: '-10%', 
            left: '-5%', 
            width: '600px', 
            height: '600px',
            background: 'radial-gradient(circle, rgba(59,130,246,0.2), transparent 70%)',
            filter: 'blur(80px)', 
            animation: 'drift2 13s ease-in-out infinite alternate'
          }}
        />
        {/* Teal orb center */}
        <div 
          style={{ 
            position: 'absolute', 
            top: '40%', 
            left: '35%', 
            width: '400px', 
            height: '400px',
            background: 'radial-gradient(circle, rgba(20,184,166,0.12), transparent 70%)',
            filter: 'blur(70px)', 
            animation: 'drift3 9s ease-in-out infinite alternate'
          }}
        />
      </div>

      {/* Sidebar - Glassmorphism */}
      <aside className={`${sidebarCollapsed ? 'w-20' : 'w-64'} text-white flex flex-col flex-shrink-0 transition-all duration-300 hidden md:flex z-10`} style={{ background: 'rgba(10, 14, 30, 0.75)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderRight: '1px solid rgba(255, 255, 255, 0.06)' }}>
        {/* Logo */}
        <div className="p-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <div className="bg-[#2563EB] p-2 rounded-lg flex-shrink-0">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h1 className="font-bold text-lg">Madison 88</h1>
                <p className="text-xs text-gray-400">Business Solutions</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          <Link
            to="/"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-white"
            style={{ 
              background: 'rgba(99,102,241,0.2)', 
              borderLeft: '2px solid #6366f1',
              boxShadow: 'inset 0 0 20px rgba(99,102,241,0.1)'
            }}
          >
            <LayoutDashboard className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Dashboard</span>}
          </Link>
          <Link
            to="/approvals"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white"
            style={{ 
              borderLeft: '2px solid transparent', 
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderLeft = '2px solid rgba(99,102,241,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderLeft = '2px solid transparent';
            }}
          >
            <CheckSquare className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Approvals</span>}
          </Link>
          <Link
            to="/exceptions"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white"
            style={{ 
              borderLeft: '2px solid transparent', 
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderLeft = '2px solid rgba(99,102,241,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderLeft = '2px solid transparent';
            }}
          >
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Exceptions</span>}
          </Link>
          <Link
            to="/vendors"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white"
            style={{ 
              borderLeft: '2px solid transparent', 
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderLeft = '2px solid rgba(99,102,241,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderLeft = '2px solid transparent';
            }}
          >
            <Building2 className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Vendors</span>}
          </Link>
          <Link
            to="/payment-batches"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white"
            style={{ 
              borderLeft: '2px solid transparent', 
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderLeft = '2px solid rgba(99,102,241,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderLeft = '2px solid transparent';
            }}
          >
            <Package className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Batches</span>}
          </Link>
          <Link
            to="/reports"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white"
            style={{ 
              borderLeft: '2px solid transparent', 
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderLeft = '2px solid rgba(99,102,241,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderLeft = '2px solid transparent';
            }}
          >
            <BarChart3 className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Reports</span>}
          </Link>
          <Link
            to="/accounting-review"
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:text-white"
            style={{ 
              borderLeft: '2px solid transparent', 
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderLeft = '2px solid rgba(99,102,241,0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderLeft = '2px solid transparent';
            }}
          >
            <FileSearch className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="font-medium">Review</span>}
          </Link>
        </nav>

        {/* Collapse Toggle */}
        <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex items-center justify-center w-full p-2 rounded-lg transition-all duration-200"
            style={{ transition: 'all 200ms ease' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden z-10">
        {/* Top Header - Glassmorphism */}
        <header style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-sm text-slate-300">{getGreeting()}</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 text-white rounded-lg font-medium transition-all duration-200"
                style={{ 
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  boxShadow: '0 0 20px rgba(99,102,241,0.45), 0 4px 15px rgba(0,0,0,0.3)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 35px rgba(99,102,241,0.65), 0 4px 20px rgba(0,0,0,0.4)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(99,102,241,0.45), 0 4px 15px rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                Upload Invoice
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <Bell className="h-5 w-5" />
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                </button>
                {showNotifications && (
                  <div 
                    className="absolute right-0 z-50"
                    style={{ 
                      top: 'calc(100% + 8px)',
                      width: '320px',
                      background: 'rgba(15, 23, 42, 0.85)',
                      backdropFilter: 'blur(24px)',
                      WebkitBackdropFilter: 'blur(24px)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '16px',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                      transform: 'scale(0.95) translateY(-8px)',
                      opacity: 0,
                      animation: 'notificationOpen 200ms ease-out forwards',
                      transformOrigin: 'top right'
                    }}
                  >
                    <style>{`
                      @keyframes notificationOpen {
                        to {
                          transform: scale(1) translateY(0);
                          opacity: 1;
                        }
                      }
                    `}</style>
                    <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">Notifications</h3>
                        <button className="text-xs text-[#6366f1] hover:text-[#818cf8]">Mark all read</button>
                      </div>
                    </div>
                    <div className="p-2">
                      <div className="p-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: '#22c55e' }} />
                          <div className="flex-1">
                            <p className="text-sm text-white">Invoice #1041 approved</p>
                            <p className="text-xs text-slate-400 mt-1">Approved by John Doe</p>
                          </div>
                          <span className="text-xs text-slate-500">15m</span>
                        </div>
                      </div>
                      <div className="p-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: '#ef4444' }} />
                          <div className="flex-1">
                            <p className="text-sm text-white">Invoice #1042 flagged as exception</p>
                            <p className="text-xs text-slate-400 mt-1">Missing vendor information</p>
                          </div>
                          <span className="text-xs text-slate-500">2m</span>
                        </div>
                      </div>
                      <div className="p-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: '#f59e0b' }} />
                          <div className="flex-1">
                            <p className="text-sm text-white">Invoice #1043 pending approval</p>
                            <p className="text-xs text-slate-400 mt-1">Awaiting manager review</p>
                          </div>
                          <span className="text-xs text-slate-500">1h</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <button className="text-sm text-[#6366f1] hover:text-[#818cf8]">View all notifications →</button>
                    </div>
                  </div>
                )}
              </div>
              <button className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                <Settings className="h-5 w-5" />
              </button>
              <div className="w-8 h-8 bg-[#6366f1] rounded-full flex items-center justify-center">
                <User className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-6 pb-24 md:pb-6">
          {/* KPI Cards - Glassmorphism */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white/5 backdrop-blur-16 saturate-180 border border-white/10 rounded-16 shadow-lg"
                  style={{ 
                    borderRadius: '16px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
                  }}
                >
                  <div className="p-5">
                    <div className="w-32 h-3 bg-white/5 rounded animate-shimmer mb-4" style={{ animationDelay: `${i * 50}ms` }} />
                    <div className="w-16 h-8 bg-white/5 rounded animate-shimmer mb-4" style={{ animationDelay: `${i * 50 + 100}ms` }} />
                    <div className="w-24 h-3 bg-white/5 rounded animate-shimmer mb-4" style={{ animationDelay: `${i * 50 + 200}ms` }} />
                    <div className="w-full h-1 bg-white/5 rounded animate-shimmer" style={{ animationDelay: `${i * 50 + 300}ms` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {kpis.map((kpi, index) => (
                <div
                  key={kpi.label}
                  className="hover:shadow-xl transition-all duration-200 hover:-translate-y-1 card-shimmer relative overflow-hidden"
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1), inset 0 -1px 0 rgba(0, 0, 0, 0.2)',
                    borderRadius: '16px',
                    animationDelay: `${index * 60}ms`,
                    opacity: 0,
                    animation: `fadeInUp 0.5s ease-out ${index * 60}ms forwards`
                  }}
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-300 mb-1">{kpi.label}</p>
                        <p className="text-2xl font-bold text-white">{kpi.value}</p>
                        <div className="flex items-center gap-1 mt-2">
                          {kpi.trend && (
                            <>
                              <span className={`text-xs font-medium ${kpi.trendUp ? 'text-green-400' : 'text-red-400'}`}>
                                {kpi.trendUp ? '↑' : '↓'} {kpi.trend}
                              </span>
                              <span className="text-xs text-slate-400">vs last week</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="ml-4 p-2 rounded-lg bg-white/8" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                        <kpi.icon className="h-5 w-5" style={{ color: kpi.color }} />
                      </div>
                    </div>
                    <div className="mt-3 h-1 rounded-full relative" style={{ backgroundColor: `${kpi.color}20` }}>
                      <div
                        className="h-1 rounded-full transition-all duration-800 ease-out relative"
                        style={{ 
                          width: progressAnimated ? `${Math.random() * 60 + 40}%` : '0%',
                          backgroundColor: kpi.color,
                          boxShadow: '2px 0 8px currentColor'
                        }}
                      >
                        {/* Glow tip */}
                        {progressAnimated && (
                          <div
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: kpi.color,
                              boxShadow: `0 0 8px ${kpi.color}, 0 0 16px ${kpi.color}`,
                              position: 'absolute',
                              right: 0,
                              top: '50%',
                              transform: 'translateY(-50%)'
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filters - Glassmorphism */}
          <div className="p-4 mb-6" style={{ background: 'rgba(255, 255, 255, 0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '16px' }}>
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
              <div className="relative w-full md:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search invoices..."
                  className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent text-white placeholder-slate-400"
                />
              </div>
              <select
                value={filters.status || ''}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus | undefined })}
                className="w-full md:w-auto px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent text-white"
              >
                <option value="" className="bg-[#0f172a]">All Statuses</option>
                {Object.values(InvoiceStatus).map((status) => (
                  <option key={status} value={status} className="bg-[#0f172a]">
                    {status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <select
                value={filters.category || ''}
                onChange={(e) => setFilters({ ...filters, category: e.target.value as InvoiceCategory | undefined })}
                className="w-full md:w-auto px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent text-white"
              >
                <option value="" className="bg-[#0f172a]">All Categories</option>
                {Object.values(InvoiceCategory).map((category) => (
                  <option key={category} value={category} className="bg-[#0f172a]">
                    {category.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <select
                value={filters.type || ''}
                onChange={(e) => setFilters({ ...filters, type: e.target.value as InvoiceType | undefined })}
                className="w-full md:w-auto px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent text-white"
              >
                <option value="" className="bg-[#0f172a]">All Types</option>
                {Object.values(InvoiceType).map((type) => (
                  <option key={type} value={type} className="bg-[#0f172a]">{type}</option>
                ))}
              </select>
              <button
                onClick={() => setFilters({ status: undefined, category: undefined, type: undefined })}
                className="w-full md:w-auto px-4 py-2 border border-white/10 text-slate-300 rounded-lg hover:bg-white/10 transition-colors font-medium"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Invoice Table - Glassmorphism */}
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">Invoices</h2>
            </div>
            <InvoiceTable invoices={invoices} onInvoiceClick={setSelectedInvoice} loading={loading} />
            
            {/* Loading more spinner */}
            {invoicesLoading && page > 1 && (
              <div className="flex items-center justify-center py-4">
                <div className="w-6 h-6 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            
            {/* End of list message */}
            {!hasMore && invoices.length > 0 && (
              <div className="text-center py-4 text-slate-400 text-sm">
                You've reached the end · {invoices.length} invoices total
              </div>
            )}
            
            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="h-1" />
          </div>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar - Glassmorphism */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0f172a]/80 backdrop-blur-20 border-t border-white/10 z-50">
        <div className="flex items-center justify-around py-2">
          <Link
            to="/"
            className="flex flex-col items-center px-4 py-2 text-[#6366f1]"
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="text-xs mt-1">Dashboard</span>
          </Link>
          <Link
            to="/approvals"
            className="flex flex-col items-center px-4 py-2 text-slate-400 hover:text-white"
          >
            <CheckSquare className="h-5 w-5" />
            <span className="text-xs mt-1">Approvals</span>
          </Link>
          <Link
            to="/exceptions"
            className="flex flex-col items-center px-4 py-2 text-slate-400 hover:text-white"
          >
            <AlertTriangle className="h-5 w-5" />
            <span className="text-xs mt-1">Exceptions</span>
          </Link>
          <Link
            to="/vendors"
            className="flex flex-col items-center px-4 py-2 text-slate-400 hover:text-white"
          >
            <Building2 className="h-5 w-5" />
            <span className="text-xs mt-1">Vendors</span>
          </Link>
          <button className="flex flex-col items-center px-4 py-2 text-slate-400 hover:text-white">
            <Package className="h-5 w-5" />
            <span className="text-xs mt-1">More</span>
          </button>
        </div>
      </div>

      {/* Invoice Detail Panel - Glassmorphism */}
      {selectedInvoice && (
        <div className="fixed right-0 top-0 h-full w-96 bg-[#0f172a]/85 backdrop-blur-20 border-l border-white/10 overflow-y-auto z-50 shadow-2xl" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Invoice Details</h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-slate-400 hover:text-white"
              >
                ×
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-400">Invoice Number</p>
                <p className="text-sm font-medium text-white">{selectedInvoice.invoice_number}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Vendor</p>
                <p className="text-sm font-medium text-white">{selectedInvoice.vendor?.name}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Amount</p>
                <p className="text-sm font-medium text-white">
                  {selectedInvoice.currency} {Number(selectedInvoice.amount).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Status</p>
                <p className="text-sm font-medium text-white">{selectedInvoice.status}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Payment Terms</p>
                <p className="text-sm font-medium text-white">{selectedInvoice.payment_terms}</p>
              </div>
              {selectedInvoice.incoterm && (
                <div>
                  <p className="text-sm text-slate-400">Incoterm</p>
                  <p className="text-sm font-medium text-white">{selectedInvoice.incoterm}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-slate-400">Bill To</p>
                <p className="text-sm font-medium text-white">{selectedInvoice.bill_to_name}</p>
                <p className="text-xs text-slate-500">{selectedInvoice.bill_to_address}</p>
              </div>
              
              {/* Validation Button */}
              {selectedInvoice.status === InvoiceStatus.PENDING_VALIDATION && (
                <button
                  onClick={handleValidate}
                  disabled={validating}
                  className="w-full flex items-center justify-center px-4 py-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-lg hover:scale-102 transition-all duration-200 disabled:bg-slate-600 disabled:cursor-not-allowed"
                  style={{ boxShadow: '0 0 20px rgba(99,102,241,0.4)' }}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  {validating ? 'Validating...' : 'Run Validation'}
                </button>
              )}

              {/* Approval Actions */}
              {selectedInvoice.status === InvoiceStatus.PENDING_APPROVAL && (
                <div className="space-y-2">
                  <button
                    onClick={() => handleApprove(selectedInvoice.id)}
                    className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </button>
                </div>
              )}

              {/* Posting Actions */}
              {selectedInvoice.status === InvoiceStatus.APPROVED && (
                <button
                  onClick={handlePost}
                  disabled={posting}
                  className="w-full flex items-center justify-center px-4 py-2 bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white rounded-lg hover:scale-102 transition-all duration-200 disabled:bg-slate-600 disabled:cursor-not-allowed"
                  style={{ boxShadow: '0 0 20px rgba(99,102,241,0.4)' }}
                >
                  <Send className="h-4 w-4 mr-2" />
                  {posting ? 'Posting...' : 'Post to Accounting'}
                </button>
              )}

              {/* Payment Scheduling */}
              {selectedInvoice.status === InvoiceStatus.POSTED && (
                <button
                  onClick={() => setShowSchedulePaymentModal(true)}
                  className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Schedule Payment
                </button>
              )}

              {/* Validation Results */}
              {validationResult && (
                <div className={`mt-4 p-4 rounded-lg ${validationResult.passed ? 'bg-green-500/10' : 'bg-red-500/10'} border ${validationResult.passed ? 'border-green-500/20' : 'border-red-500/20'}`}>
                  <p className={`text-sm font-semibold mb-2 ${validationResult.passed ? 'text-green-400' : 'text-red-400'}`}>
                    {validationResult.passed ? 'Validation Passed' : 'Validation Failed'}
                  </p>
                  <div className="space-y-1">
                    {validationResult.results.map((result: any, idx: number) => (
                      <div key={idx} className="flex items-start text-xs">
                        <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>
                          {result.passed ? '✓' : '✗'}
                        </span>
                        <span className={result.passed ? 'text-green-300' : 'text-red-300'}>
                          {result.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedInvoice.exceptions && selectedInvoice.exceptions.length > 0 && (
                <div className="mt-4 p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                  <p className="text-sm font-semibold text-red-400 mb-2">Exceptions</p>
                  {selectedInvoice.exceptions.map((exc) => (
                    <p key={exc.id} className="text-xs text-red-300">
                      {exc.reason}: {exc.detail}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal - Glassmorphism */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#0f172a]/85 backdrop-blur-20 rounded-16 border border-white/10 shadow-2xl max-w-md w-full mx-4" style={{ borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Reject Invoice
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-white placeholder-slate-400"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Payment Modal - Glassmorphism */}
      {showSchedulePaymentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#0f172a]/85 backdrop-blur-20 rounded-16 border border-white/10 shadow-2xl max-w-md w-full mx-4" style={{ borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Schedule Payment
              </h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-white"
                />
              </div>
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowSchedulePaymentModal(false);
                    setPaymentDate('');
                  }}
                  className="px-4 py-2 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSchedulePayment}
                  disabled={!paymentDate}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
                >
                  Schedule Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Glass Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div 
            key={toast.id}
            className="bg-white/8 backdrop-blur-16 border border-white/10 rounded-lg shadow-2xl"
            style={{ 
              borderLeft: toast.type === 'success' ? '3px solid #22c55e' : toast.type === 'error' ? '3px solid #ef4444' : toast.type === 'warning' ? '3px solid #f59e0b' : '3px solid #6366f1',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              padding: '12px 16px',
              minWidth: '280px',
              borderRadius: '12px',
              transform: 'translateX(100%)',
              opacity: 0,
              animation: `toastSlideIn 250ms ease-out forwards`
            }}
          >
            <style>{`
              @keyframes toastSlideIn {
                to {
                  transform: translateX(0);
                  opacity: 1;
                }
              }
            `}</style>
            <div className="flex items-center gap-3">
              {toast.type === 'success' ? (
                <CheckCircle className="h-5 w-5 text-green-400" />
              ) : toast.type === 'error' ? (
                <XCircle className="h-5 w-5 text-red-400" />
              ) : toast.type === 'warning' ? (
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              ) : (
                <Bell className="h-5 w-5 text-indigo-400" />
              )}
              <span className="text-sm text-white">{toast.message}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Upload Invoice Modal */}
      <UploadInvoiceModal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} />
    </div>
  );
}
