import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InvoiceStatus, InvoiceCategory, InvoiceType } from '@ap-invoice/shared';
import { invoiceApi } from '../lib/api';
import InvoiceTable from './InvoiceTable';
import UploadInvoiceModal from './UploadInvoiceModal';
import BottleneckView from './BottleneckView';
import { ThemeToggle } from './ThemeToggle';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { MockInvoice } from '../lib/mockData';
import { hasPermission, filterInvoicesByRole } from '../lib/roleAccess';
import { FileText, Clock, AlertTriangle, CheckCircle, Shield, CheckSquare, XCircle, Send, AlertCircle, Package, BarChart3, FileSearch, TrendingUp, Search, Bell, Settings, User, LayoutDashboard, Building2, ChevronLeft, LogOut } from 'lucide-react';

// Custom hook for number count-up animation
function useCountUp(end: number, duration: number = 1200, start: boolean = true) {
  const [count, setCount] = useState(0);
  const startTimeRef = useRef<number>(0);
  const endRef = useRef(end);
  const animationFrameRef = useRef<number>();
  const hasRunRef = useRef(false);

  useEffect(() => {
    endRef.current = end;
  }, [end]);

  useEffect(() => {
    if (!start || hasRunRef.current) return;
    hasRunRef.current = true;

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
        setCount(endRef.current);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, duration]);

  const startAnimation = () => {
    setCount(0);
    hasRunRef.current = false;
    startTimeRef.current = 0;
    // Trigger re-animation by temporarily setting start to false
    setTimeout(() => {
      hasRunRef.current = false;
      setCount(0);
      startTimeRef.current = 0;
      animationFrameRef.current = requestAnimationFrame((timestamp) => {
        startTimeRef.current = timestamp;
        const animate = (ts: number) => {
          const elapsed = ts - startTimeRef.current;
          const progress = Math.min(elapsed / duration, 1);
          const easeOutExpo = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
          setCount(Math.floor(easeOutExpo(progress) * endRef.current));
          if (progress < 1) {
            animationFrameRef.current = requestAnimationFrame(animate);
          } else {
            setCount(endRef.current);
          }
        };
        animate(timestamp);
      });
    }, 0);
  };

  return { count, startAnimation };
}

const canUserApproveStatus = (role: string | undefined, status: string): boolean => {
  if (!role) return false;
  const mapping: Record<string, string[]> = {
    'PURCHASING_COORDINATOR': ['PENDING_COORDINATOR'],
    'PURCHASING_MANAGER': ['PENDING_MANAGER'],
    'PLANNING_MANAGER': ['PENDING_MLO_PLANNING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER'],
    'SR_MANAGER_GLOBAL_PRODUCTION': ['PENDING_SR_MANAGER'],
    'MS_POLLY': ['PENDING_POLLY'],
    'ACCOUNTING_SUPERVISOR': ['PENDING_ACCOUNTING'],
    'ACCOUNTING_ASSOCIATE': ['PENDING_ACCOUNTING'],
    'CFO': ['PENDING_ACCOUNTING'],
    'PRESIDENT': ['PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY', 'PENDING_ACCOUNTING'],
    'IT_ADMIN': ['PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY', 'PENDING_ACCOUNTING'],
    'ADMIN': ['PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY', 'PENDING_ACCOUNTING'],
  };
  return (mapping[role] || []).includes(status);
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { invoices } = useMockData();
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
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
    brand: undefined as string | undefined,
    brand_code: undefined as string | undefined,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [progressAnimated, setProgressAnimated] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }[]>([]);
  const [countUpStarted, setCountUpStarted] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [poAuditSummary, setPoAuditSummary] = useState({
    matched: 0,
    warnings: 0,
    mismatches: 0,
    pending: 0,
    not_found: 0,
    skipped: 0,
    error: 0,
    total: 0,
  });
  const [poAuditLoading] = useState(false);

  // Use live invoice data from the API
  const allInvoices = invoices;

  // Filter invoices based on user role and permissions
  const getRoleFilteredInvoices = () => {
    if (!user) return allInvoices;

    const role = user.role;

    // Planning Manager brand scope filter
    if (role === 'PLANNING_MANAGER' && user.brand_scope) {
      const top10Brands = ['TNF', 'UA', 'VNS', 'ARC', 'CSC', 'HH', 'BUR', 'TM', 'FR', 'ON'];
      if (user.brand_scope === 'TOP_10') {
        return allInvoices.filter(i => top10Brands.includes(i.brand_code || ''));
      } else {
        return allInvoices.filter(i => !top10Brands.includes(i.brand_code || ''));
      }
    }

    // ACCOUNTING_ASSOCIATE - only their uploaded invoices
    if (role === 'ACCOUNTING_ASSOCIATE') {
      return allInvoices.filter(i => i.uploaded_by === user.email);
    }

    // SR_MANAGER_GLOBAL_PRODUCTION - only production invoices $2K+
    if (role === 'SR_MANAGER_GLOBAL_PRODUCTION') {
      return allInvoices.filter(i => i.total_amount > 2000);
    }

    // MS_POLLY - only high-value invoices (>$100K)
    if (role === 'MS_POLLY') {
      return allInvoices.filter(i => i.total_amount >= 100000);
    }

    // CFO - all invoices (financial overview)
    if (role === 'CFO') {
      return allInvoices;
    }

    // IT_ADMIN - all invoices (read-only for debugging)
    if (role === 'IT_ADMIN') {
      return allInvoices;
    }

    // SUPERADMIN - all invoices
    if (role === 'SUPERADMIN') {
      return allInvoices;
    }

    // PURCHASING_COORDINATOR - pending their approval, validation, or batch hold (they upload first)
    if (role === 'PURCHASING_COORDINATOR') {
      return allInvoices.filter(i =>
        i.status === 'PENDING_COORDINATOR' ||
        i.status === 'VALIDATION_PENDING' ||
        i.status === 'EXCEPTION_FLAGGED' ||
        i.status === 'ON_HOLD'
      );
    }

    // PURCHASING_MANAGER - pending their approval
    if (role === 'PURCHASING_MANAGER') {
      return allInvoices.filter(i => i.status === 'PENDING_MANAGER');
    }

    // ACCOUNTING_SUPERVISOR - all invoices
    if (role === 'ACCOUNTING_SUPERVISOR') {
      return allInvoices;
    }

    // Default: use existing role-based filter
    return filterInvoicesByRole(allInvoices, role);
  };

  const roleFilteredInvoices = getRoleFilteredInvoices();

  // Filter invoices based on filters
  const filteredInvoices = roleFilteredInvoices.filter(inv => {
    if (filters.status && inv.status !== filters.status) return false;
    if (filters.category && inv.category !== filters.category) return false;
    if (filters.type && inv.invoice_type !== filters.type) return false;
    if (filters.brand && inv.brand !== filters.brand) return false;
    return true;
  });

  // Sort invoices by invoice date (newest first) to show those approaching due dates first
  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    const dateA = new Date(a.invoice_date);
    const dateB = new Date(b.invoice_date);
    return dateA.getTime() - dateB.getTime(); // Ascending order (oldest first = closer to due)
  });

  // Pagination: show 4 invoices per page
  const [currentPage, setCurrentPage] = useState(1);
  const invoicesPerPage = 4;
  const totalPages = Math.ceil(sortedInvoices.length / invoicesPerPage);
  const startIndex = (currentPage - 1) * invoicesPerPage;
  const endIndex = startIndex + invoicesPerPage;
  const displayedInvoices = sortedInvoices.slice(startIndex, endIndex);

  // Update loading state
  useEffect(() => {
    setLoading(false);
    // Start count-up animations after loading is complete
    setTimeout(() => setCountUpStarted(true), 100);
  }, []);

  // DSRS v7.3 PO audit summary is disabled until a production PO audit endpoint is available.
  // The previous /api/test/po-audit/all route was removed with other test routes.
  useEffect(() => {
    setPoAuditSummary({
      matched: 0,
      warnings: 0,
      mismatches: 0,
      pending: 0,
      not_found: 0,
      skipped: 0,
      error: 0,
      total: 0,
    });
  }, []);

  // Count-up animations for each KPI - calculate from live invoice data
  const pendingValidationCount = useCountUp(allInvoices.filter(i => i.status === InvoiceStatus.VALIDATION_PENDING).length, 1200, countUpStarted);
  const awaitingApprovalCount = useCountUp(allInvoices.filter(i => i.status === InvoiceStatus.PENDING_MANAGER || i.status === InvoiceStatus.PENDING_MLO_PLANNING_MANAGER || i.status === InvoiceStatus.PENDING_SR_MANAGER || i.status === InvoiceStatus.PENDING_POLLY).length, 1200, countUpStarted);
  const urgentPaymentsCount = useCountUp(allInvoices.filter(i => {
    const currentStage = i.stage_timestamps.find(st => !st.exited_at);
    if (!currentStage) return false;
    const enteredAt = new Date(currentStage.entered_at);
    const now = new Date();
    const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
    const remainingHours = currentStage.sla_hours - elapsedHours;
    return remainingHours <= 24 && remainingHours > 0;
  }).length, 1200, countUpStarted);
  const totalAmountCount = useCountUp(Math.floor(allInvoices.reduce((sum, i) => sum + i.total_amount, 0)), 1200, countUpStarted);
  const exceptionsCount = useCountUp(allInvoices.filter(i => i.exceptions.length > 0).length, 1200, countUpStarted);

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


  const handleValidate = async () => {
    if (!selectedInvoice) return;

    try {
      setValidating(true);
      const response = await invoiceApi.validate(selectedInvoice.id);
      setValidationResult(response.data);
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
      if (!user) {
        showToast('You must be logged in to approve invoices', 'error');
        return;
      }
      
      // Signature attribution: pass user's name as signer
      // Backend will record full signature details (signer_name, signer_role, signed_at, is_digital)
      await invoiceApi.approve(invoiceId, user.name);
      showToast('Invoice approved successfully', 'success');
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
      setSelectedInvoice(null);
      setShowSchedulePaymentModal(false);
      setPaymentDate('');
    } catch (error) {
      console.error('Failed to schedule payment:', error);
      showToast('Failed to schedule payment', 'error');
    }
  };

  // Role-specific KPI cards
  const getRoleSpecificKPIs = () => {
    if (!user) return [];

    const role = user.role;

    switch (role) {
      case 'ACCOUNTING_ASSOCIATE':
        return [
          {
            label: 'My Invoices',
            value: allInvoices.filter(i => i.uploaded_by === user.email).length,
            icon: FileText,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'Pending Validation',
            value: pendingValidationCount.count,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Validated Today',
            value: allInvoices.filter(i => i.status === InvoiceStatus.APPROVED).length,
            icon: CheckCircle,
            color: '#059669',
            trend: '+22%',
            trendUp: true,
          },
          {
            label: 'Exceptions',
            value: exceptionsCount.count,
            icon: AlertCircle,
            color: '#DB2777',
            trend: '-7%',
            trendUp: false,
          },
        ];

      case 'PURCHASING_COORDINATOR':
        return [
          {
            label: 'Pending My Approval',
            value: allInvoices.filter(i => i.status === 'PENDING_COORDINATOR').length,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'PO Validation Results',
            value: allInvoices.filter(i => i.po_validation?.po_found).length,
            icon: CheckCircle,
            color: '#059669',
            trend: '+18%',
            trendUp: true,
          },
          {
            label: 'Vendor Mismatches',
            value: allInvoices.filter(i => i.po_validation?.comparison?.vendor_match === false).length,
            icon: AlertTriangle,
            color: '#DC2626',
            trend: '-3%',
            trendUp: false,
          },
          {
            label: 'Approved This Week',
            value: allInvoices.filter(i => i.status === 'APPROVED').length,
            icon: CheckSquare,
            color: '#059669',
            trend: '+22%',
            trendUp: true,
          },
        ];

      case 'PURCHASING_MANAGER':
        return [
          {
            label: 'Pending My Approval',
            value: allInvoices.filter(i => i.status === 'PENDING_MANAGER').length,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Team Performance',
            value: '92%',
            icon: TrendingUp,
            color: '#4F46E5',
            trend: '+8%',
            trendUp: true,
            subtitle: 'Coordinator approval rate',
          },
          {
            label: 'PO Validation Summary',
            value: allInvoices.filter(i => i.po_validation?.po_found).length,
            icon: CheckCircle,
            color: '#059669',
            trend: '+18%',
            trendUp: true,
          },
          {
            label: 'Escalated Items',
            value: allInvoices.filter(i => i.status === InvoiceStatus.ON_HOLD).length,
            icon: AlertTriangle,
            color: '#F59E0B',
            trend: '+2%',
            trendUp: true,
          },
        ];

      case 'ACCOUNTING_SUPERVISOR':
        return [
          {
            label: 'All Invoices Overview',
            value: allInvoices.length,
            icon: FileText,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'Pending from Associates',
            value: allInvoices.filter(i => i.status === 'VALIDATION_PENDING').length,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Exception Flags',
            value: exceptionsCount.count,
            icon: AlertCircle,
            color: '#DB2777',
            trend: '-7%',
            trendUp: false,
          },
          {
            label: 'Ready for Posting',
            value: allInvoices.filter(i => i.status === 'APPROVED').length,
            icon: CheckCircle,
            color: '#059669',
            trend: '+22%',
            trendUp: true,
          },
        ];

      case 'PLANNING_MANAGER':
        const brandScope = user.brand_scope;
        const filteredByBrand = brandScope === 'TOP_10'
          ? allInvoices.filter(i => ['TNF', 'UA', 'VNS', 'ARC', 'CSC', 'HH', 'BUR', 'TM', 'FR', 'ON'].includes(i.brand_code || ''))
          : allInvoices.filter(i => !['TNF', 'UA', 'VNS', 'ARC', 'CSC', 'HH', 'BUR', 'TM', 'FR', 'ON'].includes(i.brand_code || ''));

        return [
          {
            label: `${brandScope} Brand Invoices`,
            value: filteredByBrand.length,
            icon: Building2,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'Pending My Approval',
            value: filteredByBrand.filter(i => i.status === 'PENDING_MLO_PLANNING_MANAGER').length,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Brand-Filtered List',
            value: filteredByBrand.filter(i => i.status !== 'PAID').length,
            icon: FileSearch,
            color: '#4F46E5',
            trend: '+8%',
            trendUp: true,
          },
          {
            label: 'Approved This Month',
            value: filteredByBrand.filter(i => i.status === 'APPROVED').length,
            icon: CheckCircle,
            color: '#059669',
            trend: '+22%',
            trendUp: true,
          },
        ];

      case 'SR_MANAGER_GLOBAL_PRODUCTION':
        return [
          {
            label: 'Production Invoices $2K+',
            value: allInvoices.filter(i => i.total_amount > 2000).length,
            icon: Package,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'Pending My Approval',
            value: allInvoices.filter(i => i.status === 'PENDING_SR_MANAGER').length,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Global Production Costs',
            value: `$${allInvoices.filter(i => i.total_amount > 2000).reduce((sum, i) => sum + i.total_amount, 0).toLocaleString()}`,
            icon: TrendingUp,
            color: '#4F46E5',
            trend: '+18%',
            trendUp: true,
          },
          {
            label: 'Tier 3+ Approvals',
            value: allInvoices.filter(i => (i.approval_tier || 0) >= 3).length,
            icon: Shield,
            color: '#059669',
            trend: '+22%',
            trendUp: true,
          },
        ];

      case 'CFO':
        return [
          {
            label: 'Total AP Amount',
            value: `$${totalAmountCount.count.toLocaleString()}`,
            icon: TrendingUp,
            color: '#4F46E5',
            trend: '+18%',
            trendUp: true,
          },
          {
            label: 'Cash Flow',
            value: '$2.4M',
            icon: BarChart3,
            color: '#059669',
            trend: '+15%',
            trendUp: true,
          },
          {
            label: 'High-Value Alerts',
            value: allInvoices.filter(i => i.total_amount >= 50000).length,
            icon: AlertTriangle,
            color: '#DC2626',
            trend: '+2%',
            trendUp: true,
          },
          {
            label: 'Payment Batches',
            value: allInvoices.filter(i => i.status === 'PAYMENT_SCHEDULED').length,
            icon: Package,
            color: '#7C3AED',
            trend: '+8%',
            trendUp: true,
          },
        ];

      case 'MS_POLLY':
        return [
          {
            label: 'Total Invoices This Month',
            value: allInvoices.length,
            icon: FileText,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'Total AP Amount',
            value: `$${totalAmountCount.count.toLocaleString()}`,
            icon: TrendingUp,
            color: '#4F46E5',
            trend: '+18%',
            trendUp: true,
          },
          {
            label: 'Pending My Approval',
            value: allInvoices.filter(i => i.status === 'PENDING_POLLY').length,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Critical Exceptions',
            value: exceptionsCount.count,
            icon: AlertCircle,
            color: '#DC2626',
            trend: '-7%',
            trendUp: false,
          },
        ];

      case 'IT_ADMIN':
        return [
          {
            label: 'System Health',
            value: '98.5%',
            icon: CheckCircle,
            color: '#059669',
            trend: '+2%',
            trendUp: true,
          },
          {
            label: 'NextGen Integration',
            value: 'Active',
            icon: Shield,
            color: '#2563EB',
            trend: 'Stable',
            trendUp: true,
          },
          {
            label: 'Total Users',
            value: 14,
            icon: User,
            color: '#7C3AED',
            trend: '+2',
            trendUp: true,
          },
          {
            label: 'Error Logs',
            value: 3,
            icon: AlertCircle,
            color: '#DC2626',
            trend: '-5',
            trendUp: false,
          },
        ];

      case 'SUPERADMIN':
        return [
          {
            label: 'System Health',
            value: '98.5%',
            icon: CheckCircle,
            color: '#059669',
            trend: '+2%',
            trendUp: true,
          },
          {
            label: 'Total Users',
            value: 14,
            icon: User,
            color: '#7C3AED',
            trend: '+2',
            trendUp: true,
          },
          {
            label: 'All Invoices',
            value: allInvoices.length,
            icon: FileText,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'System Configuration',
            value: 'Active',
            icon: Settings,
            color: '#4F46E5',
            trend: 'Stable',
            trendUp: true,
          },
        ];

      default:
        return [
          {
            label: 'Pending Validation',
            value: pendingValidationCount.count,
            icon: FileText,
            color: '#2563EB',
            trend: '+12%',
            trendUp: true,
          },
          {
            label: 'Awaiting Approval',
            value: awaitingApprovalCount.count,
            icon: Clock,
            color: '#7C3AED',
            trend: '+5%',
            trendUp: true,
          },
          {
            label: 'Urgent Payments',
            value: urgentPaymentsCount.count,
            icon: AlertTriangle,
            color: '#DC2626',
            trend: '-3%',
            trendUp: false,
          },
          {
            label: 'Exceptions',
            value: exceptionsCount.count,
            icon: AlertCircle,
            color: '#DB2777',
            trend: '-7%',
            trendUp: false,
          },
        ];
    }
  };

  const kpis = getRoleSpecificKPIs();

  return (
    <div className="flex h-screen relative" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
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
          
          {/* Approvals - For approvers only (PURCHASING_COORDINATOR, PURCHASING_MANAGER, PLANNING_MANAGER, SR_MANAGER_GLOBAL_PRODUCTION, MS_POLLY, ACCOUNTING_SUPERVISOR) */}
          {user && [
            'PURCHASING_COORDINATOR', 
            'PURCHASING_MANAGER', 
            'PLANNING_MANAGER', 
            'SR_MANAGER_GLOBAL_PRODUCTION', 
            'MS_POLLY',
            'ACCOUNTING_SUPERVISOR'
          ].includes(user.role) && (
            <Link
              to="/approvals"
              onClick={(e) => {
                if (!user) {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
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
              {!sidebarCollapsed && (
                <div className="flex items-center justify-between flex-1">
                  <span className="font-medium">Approvals</span>
                  {awaitingApprovalCount.count > 0 && (
                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {awaitingApprovalCount.count}
                    </span>
                  )}
                </div>
              )}
            </Link>
          )}
          
          {/* Exceptions - For operational roles only (ACCOUNTING_ASSOCIATE, ACCOUNTING_SUPERVISOR, CFO) */}
          {user && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'CFO'].includes(user.role) && (
            <Link
              to="/exceptions"
              onClick={(e) => {
                if (!user) {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
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
              {!sidebarCollapsed && (
                <div className="flex items-center justify-between flex-1">
                  <span className="font-medium">Exceptions</span>
                  {exceptionsCount.count > 0 && (
                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {exceptionsCount.count}
                    </span>
                  )}
                </div>
              )}
            </Link>
          )}
          
          {/* Vendors - For roles that need vendor info (PURCHASING_COORDINATOR, PURCHASING_MANAGER, ACCOUNTING_SUPERVISOR, CFO) */}
          {user && ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR', 'CFO'].includes(user.role) && (
            <Link
              to="/vendors"
              onClick={(e) => {
                if (!user) {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
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
          )}
          
          {/* Batches - For financial roles only (CFO, ACCOUNTING_SUPERVISOR) */}
          {user && ['CFO', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
            <Link
              to="/payment-batches"
              onClick={(e) => {
                if (!user) {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
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
          )}
          
          {/* Reports - For financial and management roles (CFO, PURCHASING_MANAGER, ACCOUNTING_SUPERVISOR) */}
          {user && ['CFO', 'PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
            <Link
              to="/reports"
              onClick={(e) => {
                if (!user) {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
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
          )}
          
          {/* Review - For accounting roles only (ACCOUNTING_ASSOCIATE, ACCOUNTING_SUPERVISOR) */}
          {user && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
            <Link
              to="/accounting-review"
              onClick={(e) => {
                if (!user) {
                  e.preventDefault();
                  navigate('/login');
                }
              }}
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
          )}
          
          {/* System Configuration - Only for IT_ADMIN and SUPERADMIN */}
          {user && (user.role === 'IT_ADMIN' || user.role === 'SUPERADMIN') && (
            <Link
              to="/settings"
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
              <Settings className="h-5 w-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">System Configuration</span>}
            </Link>
          )}
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
              <h1 className="text-2xl font-bold text-white">
                {user ? `Welcome, ${user.name.split(' ')[0]}` : 'Dashboard'}
              </h1>
              {user && (
                <span className="inline-block mt-1 px-3 py-1 text-xs font-medium rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {user.role.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {/* Theme Toggle */}
              <ThemeToggle />
              {/* User Info */}
              {user && (
                <div className="flex items-center gap-3 px-4 py-2 bg-white/5 border border-white/10 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                      <span className="text-white text-sm font-medium">
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-white">{user.name}</p>
                      <p className="text-xs text-slate-400">{user.title || user.role.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              )}
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
                        {'subtitle' in kpi && kpi.subtitle && (
                          <p className="text-xs text-slate-400 mt-1">{kpi.subtitle}</p>
                        )}
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

          {/* DSRS v7.3 PO Audit Summary */}
          <div
            className="mb-6 p-5 rounded-2xl"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-200">PO Validation Audit</h3>
              </div>
              {poAuditLoading && (
                <span className="text-xs text-slate-500">Loading...</span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { label: 'Matched', value: poAuditSummary.matched, color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
                { label: 'Warnings', value: poAuditSummary.warnings, color: 'text-amber-400', bg: 'bg-amber-500/20' },
                { label: 'Mismatches', value: poAuditSummary.mismatches, color: 'text-red-400', bg: 'bg-red-500/20' },
                { label: 'Pending', value: poAuditSummary.pending, color: 'text-blue-400', bg: 'bg-blue-500/20' },
                { label: 'Not Found', value: poAuditSummary.not_found, color: 'text-orange-400', bg: 'bg-orange-500/20' },
                { label: 'Skipped', value: poAuditSummary.skipped, color: 'text-slate-400', bg: 'bg-slate-500/20' },
                { label: 'Error', value: poAuditSummary.error, color: 'text-red-400', bg: 'bg-red-500/20' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col items-center justify-center p-3 rounded-xl"
                  style={{ background: 'rgba(255, 255, 255, 0.03)' }}
                >
                  <span className={`text-lg font-bold ${item.color}`}>{item.value}</span>
                  <span className="text-xs text-slate-400 mt-1">{item.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              {poAuditSummary.total} invoice(s) audited against NextGen PO data. Audit is async and informational only.
            </p>
          </div>

          {/* Bottleneck View - Hide for IT_ADMIN and SUPERADMIN */}
          {user && user.role !== 'IT_ADMIN' && user.role !== 'SUPERADMIN' && (
            <BottleneckView />
          )}

          {/* Action Buttons - Glassmorphism - Role-specific */}
          <div className="flex items-center gap-4 mb-6">
            {user && (
              <>
                {/* Upload Invoice - Only for PURCHASING_COORDINATOR and IT_ADMIN */}
                {(user.role === 'PURCHASING_COORDINATOR' || user.role === 'IT_ADMIN') && (
                  <button
                    onClick={() => {
                      console.log('Upload button clicked, showUploadModal:', showUploadModal);
                      setShowUploadModal(true);
                    }}
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
                )}

                {/* Approve/Reject - For approvers */}
                {(user.role === 'PURCHASING_COORDINATOR' ||
                  user.role === 'PURCHASING_MANAGER' ||
                  user.role === 'PLANNING_MANAGER' ||
                  user.role === 'SR_MANAGER_GLOBAL_PRODUCTION' ||
                  user.role === 'MS_POLLY' ||
                  user.role === 'ACCOUNTING_SUPERVISOR' ||
                  user.role === 'CFO') && (
                  <>
                    <button
                      onClick={() => navigate('/approvals')}
                      className="px-4 py-2 text-white rounded-lg font-medium transition-all duration-200"
                      style={{
                        background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                        boxShadow: '0 0 20px rgba(5,150,105,0.45), 0 4px 15px rgba(0,0,0,0.3)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = '0 0 35px rgba(5,150,105,0.65), 0 4px 20px rgba(0,0,0,0.4)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 0 20px rgba(5,150,105,0.45), 0 4px 15px rgba(0,0,0,0.3)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      Review Approvals
                    </button>
                  </>
                )}

                {/* Route to CFO - Only for ACCOUNTING_SUPERVISOR */}
                {user.role === 'ACCOUNTING_SUPERVISOR' && (
                  <button
                    onClick={() => navigate('/approvals')}
                    className="px-4 py-2 text-white rounded-lg font-medium transition-all duration-200"
                    style={{
                      background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                      boxShadow: '0 0 20px rgba(245,158,11,0.45), 0 4px 15px rgba(0,0,0,0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 35px rgba(245,158,11,0.65), 0 4px 20px rgba(0,0,0,0.4)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 20px rgba(245,158,11,0.45), 0 4px 15px rgba(0,0,0,0.3)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    Route to CFO
                  </button>
                )}

                {/* Payment Batch Approval - Only for CFO */}
                {user.role === 'CFO' && (
                  <button
                    onClick={() => navigate('/payment-batches')}
                    className="px-4 py-2 text-white rounded-lg font-medium transition-all duration-200"
                    style={{
                      background: 'linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%)',
                      boxShadow: '0 0 20px rgba(124,58,237,0.45), 0 4px 15px rgba(0,0,0,0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 35px rgba(124,58,237,0.65), 0 4px 20px rgba(0,0,0,0.4)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 20px rgba(124,58,237,0.45), 0 4px 15px rgba(0,0,0,0.3)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    Batch Approve Payments
                  </button>
                )}

                {/* System Configuration - Only for IT_ADMIN and SUPERADMIN */}
                {(user.role === 'IT_ADMIN' || user.role === 'SUPERADMIN') && (
                  <button
                    onClick={() => navigate('/settings')}
                    className="px-4 py-2 text-white rounded-lg font-medium transition-all duration-200"
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                      boxShadow: '0 0 20px rgba(79,70,229,0.45), 0 4px 15px rgba(0,0,0,0.3)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 35px rgba(79,70,229,0.65), 0 4px 20px rgba(0,0,0,0.4)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 0 20px rgba(79,70,229,0.45), 0 4px 15px rgba(0,0,0,0.3)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    System Configuration
                  </button>
                )}
              </>
            )}
          </div>

          {/* Notifications */}
          <div className="relative">
            <button
                onClick={() => {
                  if (!user) {
                    navigate('/login');
                  } else {
                    setShowNotifications(!showNotifications);
                  }
                }}
                className="relative px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  <span>Notifications</span>
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                </div>
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

          {/* Filters - Glassmorphism - Role-specific visibility */}
          {user && user.role !== 'MS_POLLY' && user.role !== 'IT_ADMIN' && user.role !== 'SUPERADMIN' && (
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
                <select
                  value={filters.brand || ''}
                  onChange={(e) => setFilters({ ...filters, brand: e.target.value || undefined })}
                  className="w-full md:w-auto px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent text-white"
                >
                  <option value="" className="bg-[#0f172a]">All Brands</option>
                  <option value="Columbia Sportswear" className="bg-[#0f172a]">Columbia Sportswear</option>
                  <option value="The North Face" className="bg-[#0f172a]">The North Face</option>
                  <option value="Vans" className="bg-[#0f172a]">Vans</option>
                  <option value="Arc'teryx" className="bg-[#0f172a]">Arc'teryx</option>
                  <option value="Under Armour" className="bg-[#0f172a]">Under Armour</option>
                  <option value="Helly Hansen" className="bg-[#0f172a]">Helly Hansen</option>
                  <option value="Burton" className="bg-[#0f172a]">Burton</option>
                  <option value="Travis Mathew" className="bg-[#0f172a]">Travis Mathew</option>
                  <option value="Fjallraven" className="bg-[#0f172a]">Fjallraven</option>
                  <option value="On Running" className="bg-[#0f172a]">On Running</option>
                  <option value="Prana" className="bg-[#0f172a]">Prana</option>
                  <option value="Other" className="bg-[#0f172a]">Other brands</option>
                </select>
                <select
                  value={filters.brand_code || ''}
                  onChange={(e) => setFilters({ ...filters, brand_code: e.target.value as string | undefined })}
                  className="w-full md:w-auto px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent text-white"
                >
                  <option value="" className="bg-[#0f172a]">All Brand Codes</option>
                  <option value="CSC" className="bg-[#0f172a]">CSC</option>
                  <option value="TNF" className="bg-[#0f172a]">TNF</option>
                  <option value="VNS" className="bg-[#0f172a]">VNS</option>
                  <option value="ARC" className="bg-[#0f172a]">ARC</option>
                  <option value="UA" className="bg-[#0f172a]">UA</option>
                  <option value="HH" className="bg-[#0f172a]">HH</option>
                  <option value="BUR" className="bg-[#0f172a]">BUR</option>
                  <option value="TM" className="bg-[#0f172a]">TM</option>
                  <option value="FR" className="bg-[#0f172a]">FR</option>
                  <option value="ON" className="bg-[#0f172a]">ON</option>
                </select>
                <button
                  onClick={() => setFilters({ status: undefined, category: undefined, type: undefined, brand: undefined, brand_code: undefined })}
                  className="w-full md:w-auto px-4 py-2 border border-white/10 text-slate-300 rounded-lg hover:bg-white/10 transition-colors font-medium"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Invoice Table - Glassmorphism */}
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-white">Invoices</h2>
            </div>
            <InvoiceTable invoices={displayedInvoices} onInvoiceClick={setSelectedInvoice} loading={loading} />
            
            {/* Pagination */}
            {sortedInvoices.length > 0 && (
              <div className="flex items-center justify-between py-4 px-6">
                <div className="text-sm text-slate-400">
                  Showing {startIndex + 1}-{Math.min(endIndex, sortedInvoices.length)} of {sortedInvoices.length} invoices
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium border border-white/10"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-400">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-medium border border-white/10"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Supplier Balance Analysis - Only for CFO and ACCOUNTING_SUPERVISOR */}
          {user && (user.role === 'CFO' || user.role === 'ACCOUNTING_SUPERVISOR') && (
            <div className="mt-6" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Supplier balance</h2>
                  <p className="text-sm text-slate-400">Received vs recorded — real-time gap analysis</p>
                </div>
                <Link to="/vendors" className="text-sm text-[#6366f1] hover:text-[#818cf8]">View all vendors →</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/5">
                  <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
                        Vendor Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
                        Invoices Received
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
                        Invoices Recorded
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
                        Gap
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
                        Total Outstanding (USD)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {[
                      { name: 'Avery Dennison Paxar (China) Ltd', received: 12, recorded: 12, outstanding: 1956.17 },
                      { name: 'UPW Limited', received: 8, recorded: 7, outstanding: 174.87 },
                      { name: 'Avery Dennison Hong Kong B.V.', received: 15, recorded: 15, outstanding: 37.94 },
                      { name: 'Amass International Limited', received: 5, recorded: 5, outstanding: 422.25 },
                    ].map((vendor, i) => {
                      const gap = vendor.received - vendor.recorded;
                      return (
                        <tr key={i} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-200">{vendor.name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white">{vendor.received}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white">{vendor.recorded}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {gap > 0 ? (
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-red-500" />
                                <span className="text-sm font-semibold text-red-400">{gap}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <span className="text-sm text-green-400">0</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-medium">${vendor.outstanding.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Payables Aging - Only for CFO and ACCOUNTING_SUPERVISOR */}
          {user && (user.role === 'CFO' || user.role === 'ACCOUNTING_SUPERVISOR') && (
            <div className="mt-6" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
              <div className="px-6 py-4 border-b border-white/10">
                <h2 className="text-lg font-semibold text-white">Payables aging</h2>
                <p className="text-sm text-slate-400">Outstanding invoices by age bucket</p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Current (not yet due)', count: 5, amount: 3190.29, color: '#059669' },
                    { label: '1–30 days overdue', count: 2, amount: 752.07, color: '#F59E0B' },
                    { label: '31–60 days overdue', count: 0, amount: 0, color: '#F97316' },
                    { label: '60+ days overdue', count: 0, amount: 0, color: '#DC2626' },
                  ].map((bucket, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      <p className="text-xs font-medium text-slate-400 mb-2">{bucket.label}</p>
                      <p className="text-2xl font-bold text-white mb-1">{bucket.count}</p>
                      <p className="text-sm text-slate-300">${bucket.amount.toLocaleString()}</p>
                      <button
                        className="mt-3 text-xs text-[#6366f1] hover:text-[#818cf8]"
                        onClick={() => setFilters({ ...filters, status: undefined })}
                      >
                        View →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Processing Time per Stage - Only for ACCOUNTING_SUPERVISOR and PURCHASING_MANAGER */}
          {user && (user.role === 'ACCOUNTING_SUPERVISOR' || user.role === 'PURCHASING_MANAGER') && (
            <div className="mt-6" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Processing time per stage</h2>
                  <p className="text-sm text-slate-400">Average hours at each approval stage vs SLA target</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-400">SLA compliance</p>
                <p className="text-lg font-bold text-green-400">87%</p>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {[
                  { stage: 'Purchasing Coordinator', avg: 24, sla: 168 },
                  { stage: 'Purchasing Manager', avg: 48, sla: 168 },
                  { stage: 'Planning Manager', avg: 72, sla: 96 },
                  { stage: 'Lindsey Schindler', avg: 36, sla: 72 },
                  { stage: 'Accounting', avg: 96, sla: 168 },
                ].map((item, i) => {
                  const percentage = (item.avg / item.sla) * 100;
                  const status = percentage < 80 ? '✓' : percentage < 100 ? '⚠' : '✗';
                  const barColor = percentage < 80 ? '#059669' : percentage < 100 ? '#F59E0B' : '#DC2626';
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-slate-200">{item.stage}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-slate-400">{item.avg}h / {item.sla}h SLA</span>
                          <span className="text-lg font-bold" style={{ color: barColor }}>{status}</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          )}
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
                  {selectedInvoice.currency} {Number(selectedInvoice.total_amount).toFixed(2)}
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
                <p className="text-sm font-medium text-white">{selectedInvoice.bill_to_entity}</p>
              </div>
              
              {/* Validation Button */}
              {selectedInvoice.status === (InvoiceStatus.VALIDATION_PENDING as any) && (
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
              {selectedInvoice.status && user && canUserApproveStatus(user.role, String(selectedInvoice.status)) && (
                <div className="space-y-2">
                  {hasPermission(user.role, 'canApprove') && (
                    <button
                      onClick={() => handleApprove(selectedInvoice.id)}
                      className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Approve
                    </button>
                  )}
                  {hasPermission(user.role, 'canReject') && (
                    <button
                      onClick={() => setShowRejectModal(true)}
                      className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </button>
                  )}
                </div>
              )}

              {/* Posting Actions */}
              {selectedInvoice.status === InvoiceStatus.APPROVED && user && hasPermission(user.role, 'canPost') && (
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
              {selectedInvoice.status === (InvoiceStatus.POSTED_TO_QB as any) && user && hasPermission(user.role, 'canSchedulePayment') && (
                <button
                  onClick={() => setShowSchedulePaymentModal(true)}
                  className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Schedule Payment
                </button>
              )}

              {/* Validation Results - Detailed 17-Rule Display */}
              {validationResult && (
                <div className={`mt-4 p-4 rounded-lg ${validationResult.passed ? 'bg-green-500/10' : 'bg-red-500/10'} border ${validationResult.passed ? 'border-green-500/20' : 'border-red-500/20'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <p className={`text-sm font-semibold ${validationResult.passed ? 'text-green-400' : 'text-red-400'}`}>
                      {validationResult.passed ? '✓ Validation Passed' : '✗ Validation Failed'}
                    </p>
                    <span className="text-xs text-slate-400">
                      {validationResult.results.filter((r: any) => r.passed).length}/{validationResult.results.length} rules passed
                    </span>
                  </div>

                  {/* Rule Categories */}
                  <div className="space-y-3">
                    {/* Vendor Rules */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1">Vendor</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(0, 1).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>{result.passed ? '✓' : '✗'}</span>
                            <span className={result.passed ? 'text-green-300' : 'text-red-300'}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Invoice Data Rules */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1">Invoice Data</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(1, 8).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>{result.passed ? '✓' : '✗'}</span>
                            <span className={result.passed ? 'text-green-300' : 'text-red-300'}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bank Details */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1">Bank Details</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(8, 9).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>{result.passed ? '✓' : '✗'}</span>
                            <span className={result.passed ? 'text-green-300' : 'text-red-300'}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Signatures */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1">Signatures</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(9, 10).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>{result.passed ? '✓' : '✗'}</span>
                            <span className={result.passed ? 'text-green-300' : 'text-red-300'}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* NextGen PO Cross-Check - Highlighted */}
                    <div className={`p-2 rounded ${validationResult.results[16]?.passed ? 'bg-green-500/10' : 'bg-red-500/10'} border ${validationResult.results[16]?.passed ? 'border-green-500/20' : 'border-red-500/20'}`}>
                      <p className="text-xs font-medium text-slate-400 mb-1 flex items-center">
                        <span className="mr-1">🔗</span> NextGen PO Cross-Check
                      </p>
                      <div className="space-y-1">
                        {validationResult.results.slice(16, 17).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>{result.passed ? '✓' : '✗'}</span>
                            <span className={result.passed ? 'text-green-300' : 'text-red-300'}>{result.message}</span>
                          </div>
                        ))}
                        {validationResult.results[16]?.detail && (
                          <p className="text-xs text-slate-400 mt-1 pl-4">{validationResult.results[16].detail}</p>
                        )}
                      </div>
                    </div>

                    {/* Compliance Rules */}
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1">Compliance</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(10, 16).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className={`mr-2 ${result.passed ? 'text-green-400' : 'text-red-400'}`}>{result.passed ? '✓' : '✗'}</span>
                            <span className={result.passed ? 'text-green-300' : 'text-red-300'}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
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
