import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { InvoiceStatus, InvoiceCategory, InvoiceType, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { invoiceApi, notificationApi, vendorApi, exceptionApi } from '../lib/api';
import InvoiceTable from './InvoiceTable';
import UploadInvoiceModal from './UploadInvoiceModal';
import BottleneckView from './BottleneckView';
import AuditLogViewer from './AuditLogViewer';
import PipelineTracker from './PipelineTracker';
import MyTasksWidget from './MyTasksWidget';
import StatusGuide from './StatusGuide';
import StatCard from './ui/StatCard';
import { ThemeToggle } from './ThemeToggle';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { MockInvoice } from '../lib/mockData';
import { hasPermission, filterInvoicesByRole, canUserApproveStatus, isWithinRoleThreshold } from '../lib/roleAccess';
import { cn } from '../lib/utils';
import { getAuditActorDisplay } from '../lib/auditActor';
import { FileText, Clock, AlertTriangle, CheckCircle, Shield, CheckSquare, XCircle, Send, AlertCircle, Package, BarChart3, FileSearch, TrendingUp, Search, Bell, Settings, LayoutDashboard, Building2, ChevronLeft, ChevronRight, LogOut, Edit, Unlock, Pause, Users, Loader2, Menu, X, Trash2, Landmark, Paperclip, Upload, Download, Eye, Copy } from 'lucide-react';
import { Skeleton, SkeletonBar } from './ui/Skeleton';

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

// Calculate week-over-week trend for a set of invoices.
// Compares count in the last 7 days vs the previous 7 days.
function calcTrend(invoiceList: { created_at?: string }[]): { trend: string; trendUp: boolean } {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = invoiceList.filter(inv => {
    if (!inv.created_at) return false;
    const d = new Date(inv.created_at).getTime();
    return d > now - sevenDays && d <= now;
  }).length;
  const lastWeek = invoiceList.filter(inv => {
    if (!inv.created_at) return false;
    const d = new Date(inv.created_at).getTime();
    return d > now - 2 * sevenDays && d <= now - sevenDays;
  }).length;

  if (lastWeek === 0 && thisWeek === 0) return { trend: '—', trendUp: false };
  if (lastWeek === 0) return { trend: `+${thisWeek}`, trendUp: true };
  const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  if (pct === 0) return { trend: '0%', trendUp: false };
  return { trend: `${pct > 0 ? '+' : ''}${pct}%`, trendUp: pct > 0 };
}

function deriveBaseMpo(value?: string | null): string {
  const match = String(value || '').toUpperCase().match(/MPO\d{5,8}/);
  return match?.[0] || '';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { invoices, vendors, paymentBatches, refresh, loading: ctxLoading } = useMockData();
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [validating, setValidating] = useState(false);
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [nextgenResults, setNextgenResults] = useState<Record<string, any>>({});
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [posting, setPosting] = useState(false);
  const [filters, setFilters] = useState({
    status: undefined as InvoiceStatus | undefined,
    category: undefined as InvoiceCategory | undefined,
    type: undefined as InvoiceType | undefined,
    brand: undefined as string | undefined,
    brand_code: undefined as string | undefined,
    vendorId: undefined as string | undefined,
    search: undefined as string | undefined,
    dateFrom: undefined as string | undefined,
    dateTo: undefined as string | undefined,
    agingBucket: undefined as 'current' | '1-30' | '31-60' | '60+' | undefined,
    urgentDue: undefined as boolean | undefined,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }[]>([]);
  const [countUpStarted, setCountUpStarted] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showBankChangeModal, setShowBankChangeModal] = useState(false);
  const [bankChangeField, setBankChangeField] = useState('');
  const [bankChangeValue, setBankChangeValue] = useState('');
  const [bankChangeReason, setBankChangeReason] = useState('');
  const [bankChangeAttachment, setBankChangeAttachment] = useState<File | null>(null);
  const [submittingBankChange, setSubmittingBankChange] = useState(false);
  const [invoiceBankRequests, setInvoiceBankRequests] = useState<any[]>([]);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdReason, setHoldReason] = useState('Vendor cumulative amount below $100 batch threshold');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bypassVarianceCheck, setBypassVarianceCheck] = useState(false);
  const [sendingConfirmation, setSendingConfirmation] = useState(false);
  const [showConfirmSendModal, setShowConfirmSendModal] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'pipeline' | 'validation' | 'actions' | 'audit'>('overview');
  const [openingDocument, setOpeningDocument] = useState(false);
  const [replacingPdf, setReplacingPdf] = useState(false);
  const replacePdfInputRef = useRef<HTMLInputElement>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [editCollapsed, setEditCollapsed] = useState<Record<string, boolean>>({});
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [quickFilter, setQuickFilter] = useState<'all' | 'returned' | 'urgent' | 'duplicates'>('all');
  const [duplicateGroups, setDuplicateGroups] = useState<any[]>([]);
  const [paymentTermsOptions, setPaymentTermsOptions] = useState<string[]>([]);
  const [vendorList, setVendorList] = useState<{ id: string; name: string }[]>([]);

  // Use live invoice data from the API
  const allInvoices = invoices;

  // Filter invoices based on user role and permissions
  const getRoleFilteredInvoices = () => {
    if (!user) return allInvoices;

    const role = user.role;

    // Planning Manager brand scope filter + Tier 2+ threshold
    if (role === 'PLANNING_MANAGER') {
      let filtered = allInvoices.filter(i => isWithinRoleThreshold(role, Number(i.total_amount)));
      if (user.brand_scope) {
        const top10Brands = ['TNF', 'UA', 'VNS', 'ARC', 'CSC', 'HH', 'BUR', 'TM', 'FR', 'ON'];
        if (user.brand_scope === 'TOP_10') {
          filtered = filtered.filter(i => top10Brands.includes(i.brand_code || ''));
        } else {
          filtered = filtered.filter(i => !top10Brands.includes(i.brand_code || ''));
        }
      }
      return filterInvoicesByRole(filtered, role);
    }

    // MLO_ACCOUNT_HOLDER - Tier 2+ only
    if (role === 'MLO_ACCOUNT_HOLDER') {
      const tierFiltered = allInvoices.filter(i => isWithinRoleThreshold(role, Number(i.total_amount)));
      return filterInvoicesByRole(tierFiltered, role);
    }

    // SR_MANAGER_GLOBAL_PRODUCTION - only Tier 2+ invoices
    if (role === 'SR_MANAGER_GLOBAL_PRODUCTION') {
      const tierFiltered = allInvoices.filter(i => isWithinRoleThreshold(role, Number(i.total_amount)));
      return filterInvoicesByRole(tierFiltered, role);
    }

    // MS_POLLY - only Tier 3 invoices (≥$100K)
    if (role === 'MS_POLLY') {
      const tierFiltered = allInvoices.filter(i => isWithinRoleThreshold(role, Number(i.total_amount)));
      return filterInvoicesByRole(tierFiltered, role);
    }

    // IT_ADMIN - all invoices (read-only for debugging)
    if (role === 'IT_ADMIN') {
      return allInvoices;
    }

    // SUPERADMIN - no invoice visibility (system maintenance only)
    if (role === 'SUPERADMIN') {
      return [];
    }

    // Purchasing retains read visibility through accounting and payment stages.
    if (role === 'PURCHASING_COORDINATOR') {
      return allInvoices;
    }

    // Managers can follow every invoice through payment; action buttons remain stage-controlled.
    if (role === 'PURCHASING_MANAGER') {
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
    if (filters.brand_code && inv.brand_code !== filters.brand_code) return false;
    if (filters.vendorId && inv.vendor_id !== filters.vendorId) return false;
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const searchable = [
        inv.invoice_number,
        inv.vendor_name,
        inv.vendor?.name,
        inv.brand,
        inv.brand_code,
        inv.po_number,
        inv.mpo_number,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(term)) return false;
    }
    if (filters.dateFrom || filters.dateTo) {
      const invDate = new Date(inv.invoice_date);
      if (filters.dateFrom && invDate < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && invDate > new Date(filters.dateTo)) return false;
    }
    if (filters.agingBucket) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const unpaidStatuses: InvoiceStatus[] = [
        InvoiceStatus.PENDING_COORDINATOR, InvoiceStatus.PENDING_MANAGER,
        InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER, InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
        InvoiceStatus.PENDING_SR_MANAGER, InvoiceStatus.PENDING_POLLY,
        InvoiceStatus.PENDING_ACCOUNTING, InvoiceStatus.APPROVED,
        InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED,
        InvoiceStatus.VALIDATION_PENDING, InvoiceStatus.ON_HOLD, InvoiceStatus.EXCEPTION_FLAGGED,
      ];
      if (!unpaidStatuses.includes(inv.status as InvoiceStatus)) return false;
      if (!inv.due_date) {
        if (filters.agingBucket !== 'current') return false;
      } else {
        const dueDate = new Date(inv.due_date);
        dueDate.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (filters.agingBucket === 'current' && diffDays > 0) return false;
        if (filters.agingBucket === '1-30' && (diffDays <= 0 || diffDays > 30)) return false;
        if (filters.agingBucket === '31-60' && (diffDays <= 30 || diffDays > 60)) return false;
        if (filters.agingBucket === '60+' && diffDays <= 60) return false;
      }
    }
    if (filters.urgentDue) {
      if (!inv.due_date) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) return false; // only due within 7 days or overdue
    }
    return true;
  });

  // Apply quick filter (returned / urgent)
  const quickFilteredInvoices = filteredInvoices.filter(inv => {
    if (quickFilter === 'all') return true;
    if (quickFilter === 'returned') {
      const sigs = (inv as any).signatures || [];
      const returnedOwner = sigs.find((s: any) =>
        !s.ocr_detected &&
        !s.signed_at &&
        s.approval_status === 'RECONFIRMATION_REQUIRED' &&
        (!inv.current_stage || s.signatory_role === inv.current_stage)
      );
      return Boolean(
        returnedOwner?.signatory_name &&
        user?.name &&
        returnedOwner.signatory_name.trim().toLowerCase() === user.name.trim().toLowerCase()
      );
    }
    if (quickFilter === 'urgent') {
      const timestamps = (inv as any).stage_timestamps || [];
      const current = timestamps.find((t: any) => t.stage === inv.status && !t.exited_at);
      if (!current || !current.sla_hours) return false;
      const elapsed = calcWorkingHoursElapsed(new Date(current.entered_at), new Date());
      return (current.sla_hours - elapsed) <= 24;
    }
    if (quickFilter === 'duplicates') {
      const num = String((inv as any).invoice_number || '').trim().toLowerCase();
      if (!num) return false;
      return duplicateGroups.some((g: any) =>
        String(g.invoice_number || '').trim().toLowerCase() === num
      );
    }
    return true;
  });

  const returnedToMeCount = filteredInvoices.filter(inv => {
    const returnedOwner = ((inv as any).signatures || []).find((s: any) =>
      !s.ocr_detected &&
      !s.signed_at &&
      s.approval_status === 'RECONFIRMATION_REQUIRED' &&
      (!inv.current_stage || s.signatory_role === inv.current_stage)
    );
    return Boolean(returnedOwner?.signatory_name && user?.name &&
      returnedOwner.signatory_name.trim().toLowerCase() === user.name.trim().toLowerCase());
  }).length;

  // Count how many filters are currently active (for the "Clear" affordance)
  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;

  // Sort invoices by created_at/received date (newest first)
  const sortedInvoices = [...quickFilteredInvoices].sort((a, b) => {
    const dateA = new Date(a.created_at || a.invoice_received_date || a.invoice_date);
    const dateB = new Date(b.created_at || b.invoice_received_date || b.invoice_date);
    return dateB.getTime() - dateA.getTime(); // Descending order (newest first)
  });

  // Pagination: show 4 invoices per page
  const [currentPage, setCurrentPage] = useState(1);
  const invoicesPerPage = 4;
  const totalPages = Math.max(1, Math.ceil(sortedInvoices.length / invoicesPerPage));

  // Reset to page 1 whenever the active filters change, so a narrowed result set
  // never leaves the user stranded on a now-empty page.
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Fetch vendor list for filter dropdown
  useEffect(() => {
    if (vendorList.length === 0) {
      vendorApi.getAll()
        .then((res) => setVendorList((res.data || []).map((v: any) => ({ id: v.id, name: v.name }))))
        .catch(() => {});
    }
  }, []);

  // Duplicate-invoice report — refresh whenever the invoice list changes so
  // duplicates (e.g. PI169580) are caught before approval.
  useEffect(() => {
    invoiceApi.getDuplicateInvoices()
      .then((res) => setDuplicateGroups((res.data?.duplicates) || []))
      .catch(() => {});
  }, [invoices]);

  // Clamp the current page so it can never exceed the available pages.
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * invoicesPerPage;
  const endIndex = startIndex + invoicesPerPage;
  const displayedInvoices = sortedInvoices.slice(startIndex, endIndex);

  // Sync loading state with context and trigger count-up animations
  useEffect(() => {
    setLoading(ctxLoading);
    if (!ctxLoading) {
      setTimeout(() => setCountUpStarted(true), 100);
    }
  }, [ctxLoading]);

  // Auto-select invoice when navigated from Exception Manager with selectedInvoiceId
  useEffect(() => {
    const state = location.state as { selectedInvoiceId?: string } | null;
    const queryId = new URLSearchParams(location.search).get('invoiceId');
    const targetId = state?.selectedInvoiceId || queryId;
    if (targetId && invoices.length > 0) {
      const target = invoices.find(inv => inv.id === targetId);
      if (target) {
        setDetailTab('overview');
        setSelectedInvoice(target);
        // Clear the state so it doesn't re-trigger on refresh
        navigate('/', { replace: true, state: {} });
      }
    }
  }, [location.state, location.search, invoices, navigate]);

  // Keep an open invoice detail panel synchronized with background refreshes.
  useEffect(() => {
    if (!selectedInvoice) return;
    const latest = invoices.find(invoice => invoice.id === selectedInvoice.id);
    if (latest && latest !== selectedInvoice) setSelectedInvoice(latest);
    if (!latest) setSelectedInvoice(null);
  }, [invoices, selectedInvoice]);


  // Count-up animations for each KPI - calculate from live invoice data
  const pendingValidationCount = useCountUp(allInvoices.filter(i => i.status === InvoiceStatus.VALIDATION_PENDING).length, 1200, countUpStarted);
  const awaitingApprovalCount = useCountUp(allInvoices.filter(i => i.status === InvoiceStatus.PENDING_MANAGER || i.status === InvoiceStatus.PENDING_MLO_PLANNING_MANAGER || i.status === InvoiceStatus.PENDING_SR_MANAGER || i.status === InvoiceStatus.PENDING_POLLY).length, 1200, countUpStarted);
  const urgentPaymentsCount = useCountUp(allInvoices.filter(i => {
    const currentStage = i.stage_timestamps.find(st => !st.exited_at);
    if (!currentStage) return false;
    const enteredAt = new Date(currentStage.entered_at);
    const now = new Date();
    const elapsedHours = calcWorkingHoursElapsed(enteredAt, now);
    const remainingHours = currentStage.sla_hours - elapsedHours;
    return remainingHours <= 24 && remainingHours > 0;
  }).length, 1200, countUpStarted);
  const totalAmountCount = useCountUp(Math.floor(allInvoices.reduce((sum, i) => sum + i.total_amount, 0)), 1200, countUpStarted);
  const exceptionsCount = useCountUp(allInvoices.filter(i => i.exceptions.some(e => e.status === 'OPEN')).length, 1200, countUpStarted);

  // Sidebar badge counts
  const draftBatchCount = paymentBatches.filter(b => b.status === 'DRAFT').length;
  const reviewPendingCount = allInvoices.filter(i => ['PENDING_ACCOUNTING', 'APPROVED', 'POSTED_TO_QB', 'PAID'].includes(i.status)).length;
  const vendorsPendingVerification = vendors.filter(v => !v.bank_verified_at).length;

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = Date.now().toString();
    const newToast = { id, message, type };
    setToasts(prev => [...prev, newToast]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    // Trigger count-up animations after component mounts
    setTimeout(() => setCountUpStarted(true), 200);
  }, []);

  // Fetch notifications and unread count
  const fetchNotifications = async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        notificationApi.getAll(20).catch(() => ({ data: [] })),
        notificationApi.getUnreadCount().catch(() => ({ data: { count: 0 } })),
      ]);
      setNotifications(notifRes.data || []);
      setUnreadCount(countRes.data?.count || 0);
    } catch {
      // silent fail
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch bank change requests for the selected invoice
  useEffect(() => {
    if (!selectedInvoice) {
      setInvoiceBankRequests([]);
      return;
    }
    invoiceApi.getBankChangeRequests()
      .then((res) => {
        const all = res.data || [];
        setInvoiceBankRequests(all.filter((r: any) => r.invoice_id === selectedInvoice.id));
      })
      .catch(() => setInvoiceBankRequests([]));
  }, [selectedInvoice?.id]);

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


  const handleResolveException = async (exceptionId: string) => {
    try {
      const res = await exceptionApi.resolve(exceptionId, 'Resolved by coordinator');
      if (res.data?.revalidation) {
        showToast(res.data.revalidation.message, res.data.revalidation.passed ? 'success' : 'warning');
      } else {
        showToast('Exception resolved', 'success');
      }
      // Optimistic update — immediately remove resolved exception from UI
      if (selectedInvoice && selectedInvoice.exceptions) {
        setSelectedInvoice({
          ...selectedInvoice,
          exceptions: selectedInvoice.exceptions.map((exc: any) =>
            exc.id === exceptionId ? { ...exc, status: 'RESOLVED' } : exc
          ),
          status: res.data?.invoice_status || selectedInvoice.status,
        });
      }
      // Then refresh from server to get full updated data
      await refresh();
      if (selectedInvoice) {
        try {
          const updated = await invoiceApi.getById(selectedInvoice.id);
          setSelectedInvoice(updated.data);
        } catch (e) {
          // getById failed — optimistic update is already applied
        }
      }
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to resolve exception';
      showToast(msg, 'error');
    }
  };

  const handleWaiveException = async (exceptionId: string) => {
    try {
      const res = await exceptionApi.waive(exceptionId, 'Waived by coordinator');
      if (res.data?.revalidation) {
        showToast(res.data.revalidation.message, res.data.revalidation.passed ? 'success' : 'warning');
      } else {
        showToast('Exception waived', 'success');
      }
      // Optimistic update — immediately remove waived exception from UI
      if (selectedInvoice && selectedInvoice.exceptions) {
        setSelectedInvoice({
          ...selectedInvoice,
          exceptions: selectedInvoice.exceptions.map((exc: any) =>
            exc.id === exceptionId ? { ...exc, status: 'WAIVED' } : exc
          ),
          status: res.data?.invoice_status || selectedInvoice.status,
        });
      }
      // Then refresh from server to get full updated data
      await refresh();
      if (selectedInvoice) {
        try {
          const updated = await invoiceApi.getById(selectedInvoice.id);
          setSelectedInvoice(updated.data);
        } catch (e) {
          // getById failed — optimistic update is already applied
        }
      }
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to waive exception';
      showToast(msg, 'error');
    }
  };

  const handleValidate = async () => {
    if (!selectedInvoice) return;

    try {
      setValidating(true);
      const response = await invoiceApi.validate(selectedInvoice.id);
      setValidationResult(response.data);
      setDetailTab('validation');
      await refresh();
      const updatedInvoice = await invoiceApi.getById(selectedInvoice.id);
      setSelectedInvoice(updatedInvoice.data);
      if (response.data?.allExceptionsHandled) {
        showToast('Validation complete — all exceptions resolved/waived, invoice advanced to approval', 'success');
      } else if (response.data?.passed) {
        showToast('Validation passed — invoice advanced to approval', 'success');
      } else {
        showToast('Validation failed — please resolve exceptions', 'warning');
      }
    } catch (error: any) {
      console.error('Failed to validate invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to validate invoice';
      showToast(msg, 'error');
    } finally {
      setValidating(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!selectedInvoice) return;

    const requiredFields = [
      { field: 'vendor_id', label: 'Vendor' },
      { field: 'invoice_number', label: 'Invoice Number' },
      { field: 'invoice_date', label: 'Invoice Date' },
      { field: 'due_date', label: 'Due Date' },
      { field: 'total_amount', label: 'Amount' },
      { field: 'currency', label: 'Currency' },
      { field: 'brand', label: 'Brand' },
      { field: 'season', label: 'Season' },
      { field: 'customer_po_number', label: 'PO Number' },
      { field: 'mpo_base_number', label: 'Base MPO' },
    ];
    const invoice = selectedInvoice as any;
    const missing = requiredFields.filter(({ field }) => {
      const value = invoice[field];
      if (field === 'total_amount') return !Number.isFinite(Number(value)) || Number(value) <= 0;
      return value === null || value === undefined || String(value).trim() === '';
    });
    if (missing.length > 0) {
      showToast(`Complete required fields before requesting approval: ${missing.map(({ label }) => label).join(', ')}`, 'error');
      return;
    }

    try {
      setRequestingApproval(true);
      await invoiceApi.requestApproval(selectedInvoice.id);
      showToast('Approval requested successfully', 'success');
      await refresh();
      const updated = await invoiceApi.getById(selectedInvoice.id);
      setSelectedInvoice(updated.data);
    } catch (error: any) {
      console.error('Failed to request approval:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to request approval';
      showToast(msg, 'error');
    } finally {
      setRequestingApproval(false);
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
      await refresh();
      setSelectedInvoice(null);
    } catch (error: any) {
      console.error('Failed to approve invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to approve invoice';
      showToast(msg, 'error');
    }
  };

  const openInvoicePdf = async (invoice: MockInvoice) => {
    const previewWindow = window.open('', '_blank');
    try {
      setOpeningDocument(true);
      if (previewWindow) {
        previewWindow.document.title = 'Loading invoice...';
        previewWindow.document.body.textContent = 'Loading invoice PDF...';
      }
      const response = await invoiceApi.getDocument(invoice.id);
      const contentType = String(response.headers['content-type'] || 'application/pdf');
      const verificationWarning = response.headers['x-pdf-verification'];
      if (verificationWarning) {
        try {
          showToast(decodeURIComponent(verificationWarning), 'warning');
        } catch {
          showToast(String(verificationWarning), 'warning');
        }
      }
      const url = URL.createObjectURL(new Blob([response.data], { type: contentType }));
      if (previewWindow) {
        previewWindow.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      previewWindow?.close();
      const blob = error?.response?.data;
      let message = 'The actual invoice PDF is not available for this record.';
      if (blob instanceof Blob) {
        try {
          const parsed = JSON.parse(await blob.text());
          message = parsed?.error?.message || parsed?.message || message;
        } catch {
          // Keep the user-friendly fallback for non-JSON failures.
        }
      }
      showToast(message, 'error');
    } finally {
      setOpeningDocument(false);
    }
  };

  const handleReplacePdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedInvoice) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Please select a PDF file', 'error');
      event.target.value = '';
      return;
    }

    try {
      setReplacingPdf(true);
      await invoiceApi.uploadPdf(selectedInvoice.id, file);
      showToast('Invoice PDF replaced successfully', 'success');
      await refresh();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to replace PDF';
      showToast(msg, 'error');
    } finally {
      setReplacingPdf(false);
      event.target.value = '';
    }
  };

  const handleOpenEdit = async () => {
    if (!selectedInvoice) return;
    const invoice = selectedInvoice as any;
    // Fetch payment terms for dropdown (always refresh in case new terms were added)
    try {
      const res = await invoiceApi.getPaymentTerms();
      setPaymentTermsOptions(res.data || []);
    } catch { /* ignore — fallback to empty options */ }
    setEditFormData({
      invoice_number: invoice.invoice_number || '',
      invoice_date: invoice.invoice_date ? new Date(invoice.invoice_date).toISOString().split('T')[0] : '',
      due_date: invoice.due_date ? new Date(invoice.due_date).toISOString().split('T')[0] : '',
      total_amount: invoice.total_amount || '',
      currency: invoice.currency || 'USD',
      payment_terms: invoice.payment_terms || '',
      incoterm: invoice.incoterm || '',
      brand: invoice.brand || '',
      brand_code: invoice.brand_code || '',
      brand_tier: invoice.brand_tier || '',
      mpo_number: invoice.mpo_number || invoice.mpo_base_number || '',
      mpo_base_number: invoice.mpo_base_number || deriveBaseMpo(invoice.mpo_number),
      mpo_order_sequence: invoice.mpo_order_sequence || '',
      material_code: invoice.material_code || '',
      material_name: invoice.material_name || '',
      edit_reason: '',
      customer_po_number: invoice.customer_po_number || '',
      season: invoice.season || '',
      order_type: invoice.order_type || '',
      invoice_type: invoice.invoice_type || '',
      category: invoice.category || '',
      bill_to_entity: invoice.bill_to_entity || '',
      vendor_name_raw: invoice.vendor_name_raw || '',
      vendor_id: invoice.vendor_id || '',
      new_vendor_name: '',
      ship_to: invoice.ship_to || '',
      sold_to: invoice.sold_to || '',
      bank_name: invoice.bank_name || '',
      swift_code: invoice.swift_code || '',
      account_number: invoice.account_number || '',
      beneficiary_name: (invoice as any).beneficiary_name || '',
      subtotal: invoice.subtotal || '',
      tax_amount: invoice.tax_amount || '',
      discount_amount: invoice.discount_amount || '',
      bank_charges: invoice.bank_charges || '',
      freight_charges: invoice.freight_charges || '',
      additional_charges: invoice.additional_charges || '',
      payment_penalty_rate: invoice.payment_penalty_rate || '',
      exchange_rate_to_usd: invoice.exchange_rate_to_usd || '',
      invoice_currency_original: invoice.invoice_currency_original || '',
      qty_shipped: invoice.qty_shipped || '',
      priority_flag: invoice.priority_flag || false,
      is_urgent: invoice.is_urgent || false,
      is_handwritten: invoice.is_handwritten || false,
      priority_pay_date: invoice.priority_pay_date ? new Date(invoice.priority_pay_date).toISOString().split('T')[0] : '',
      date_range_start: invoice.date_range_start ? new Date(invoice.date_range_start).toISOString().split('T')[0] : '',
      date_range_end: invoice.date_range_end ? new Date(invoice.date_range_end).toISOString().split('T')[0] : '',
    });
    setShowEditModal(true);
  };

  const handleEditChange = (field: string, value: string | boolean) => {
    setEditFormData((prev: any) => {
      if (field !== 'mpo_number' || typeof value !== 'string') return { ...prev, [field]: value };
      const previousDerivedBase = deriveBaseMpo(prev.mpo_number);
      const nextDerivedBase = deriveBaseMpo(value);
      const baseWasBlankOrDerived = !prev.mpo_base_number || prev.mpo_base_number === previousDerivedBase;
      return {
        ...prev,
        mpo_number: value.toUpperCase(),
        ...(baseWasBlankOrDerived ? { mpo_base_number: nextDerivedBase } : {}),
      };
    });
  };

  const handleSaveEdit = async () => {
    if (!selectedInvoice) return;
    
    // Validate required fields (only for users who can edit invoice fields)
    const canEditAll = user ? hasPermission(user.role, 'canEditInvoice') : false;
    const canEditVendor = user ? ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role) : false;
    if (canEditAll) {
      const requiredFields: { field: string; label: string }[] = [
        { field: editFormData.new_vendor_name?.trim() ? 'new_vendor_name' : 'vendor_id', label: 'Vendor' },
        { field: 'invoice_number', label: 'Invoice Number' },
        { field: 'invoice_date', label: 'Invoice Date' },
        { field: 'due_date', label: 'Due Date' },
        { field: 'total_amount', label: 'Amount' },
        { field: 'currency', label: 'Currency' },
        { field: 'brand', label: 'Brand' },
        { field: 'season', label: 'Season' },
        { field: 'customer_po_number', label: 'PO Number' },
        { field: 'mpo_base_number', label: 'Base MPO' },
      ];
      const missing = requiredFields.filter(({ field }) => {
        const value = editFormData[field];
        if (field === 'total_amount') return !Number.isFinite(Number(value)) || Number(value) <= 0;
        return value === null || value === undefined || String(value).trim() === '';
      });
      if (missing.length > 0) {
        showToast(`Please fill in required fields: ${missing.map(f => f.label).join(', ')}`, 'error');
        return;
      }
    }
    
    setSavingEdit(true);
    try {
      const parseNum = (val: string) => (val === '' || val === undefined || val === null) ? null : parseFloat(val);
      const parseString = (val: string) => (val === '' || val === undefined || val === null) ? null : val;

      // Remove bank fields from payload if user can't edit them — backend will reject anyway
      const canEditBank = user ? hasPermission(user.role, 'canEditBankDetails') : false;

      const payload = {
        // Non-bank fields: only send if user can edit invoice
        vendor_id: canEditVendor ? parseString(editFormData.vendor_id) : undefined,
        vendor_name_raw: canEditVendor ? parseString(editFormData.vendor_name_raw) : undefined,
        new_vendor_name: canEditVendor ? parseString(editFormData.new_vendor_name?.trim()) : undefined,
        invoice_number: canEditAll ? parseString(editFormData.invoice_number) : undefined,
        invoice_date: canEditAll ? parseString(editFormData.invoice_date) : undefined,
        due_date: canEditAll ? parseString(editFormData.due_date) : undefined,
        total_amount: canEditAll ? parseNum(editFormData.total_amount) : undefined,
        currency: canEditAll ? parseString(editFormData.currency) : undefined,
        invoice_type: canEditAll ? parseString(editFormData.invoice_type) : undefined,
        brand: canEditAll ? parseString(editFormData.brand) : undefined,
        brand_tier: canEditAll ? parseString(editFormData.brand_tier) : undefined,
        season: canEditAll ? parseString(editFormData.season) : undefined,
        order_type: canEditAll ? parseString(editFormData.order_type) : undefined,
        customer_po_number: canEditAll ? parseString(editFormData.customer_po_number) : undefined,
        mpo_number: canEditAll ? parseString(editFormData.mpo_number) : undefined,
        mpo_base_number: canEditAll ? parseString(editFormData.mpo_base_number) : undefined,
        mpo_order_sequence: canEditAll ? parseString(editFormData.mpo_order_sequence) : undefined,
        material_code: canEditAll ? parseString(editFormData.material_code) : undefined,
        material_name: canEditAll ? parseString(editFormData.material_name) : undefined,
        edit_reason: parseString(editFormData.edit_reason),
        qty_shipped: canEditAll ? parseNum(editFormData.qty_shipped) : undefined,
        payment_terms: canEditAll ? parseString(editFormData.payment_terms) : undefined,
        // Bank fields: only send if user can edit bank details
        beneficiary_name: canEditBank ? parseString(editFormData.beneficiary_name) : undefined,
        bank_name: canEditBank ? parseString(editFormData.bank_name) : undefined,
        swift_code: canEditBank ? parseString(editFormData.swift_code) : undefined,
        account_number: canEditBank ? parseString(editFormData.account_number) : undefined,
        ship_to: canEditAll ? parseString(editFormData.ship_to) : undefined,
        sold_to: canEditAll ? parseString(editFormData.sold_to) : undefined,
        subtotal: canEditAll ? parseNum(editFormData.subtotal) : undefined,
        tax_amount: canEditAll ? parseNum(editFormData.tax_amount) : undefined,
        discount_amount: canEditAll ? parseNum(editFormData.discount_amount) : undefined,
        bank_charges: canEditAll ? parseNum(editFormData.bank_charges) : undefined,
        freight_charges: canEditAll ? parseNum(editFormData.freight_charges) : undefined,
        additional_charges: canEditAll ? parseNum(editFormData.additional_charges) : undefined,
        payment_penalty_rate: canEditAll ? parseNum(editFormData.payment_penalty_rate) : undefined,
        exchange_rate_to_usd: canEditAll ? parseNum(editFormData.exchange_rate_to_usd) : undefined,
        invoice_currency_original: canEditAll ? parseString(editFormData.invoice_currency_original) : undefined,
        incoterm: canEditAll ? parseString(editFormData.incoterm) : undefined,
        category: canEditAll ? parseString(editFormData.category) : undefined,
        bill_to_entity: canEditAll ? parseString(editFormData.bill_to_entity) : undefined,
        is_handwritten: canEditAll ? (editFormData.is_handwritten === true ? true : editFormData.is_handwritten === false ? false : undefined) : undefined,
        is_urgent: canEditAll ? (editFormData.is_urgent === true ? true : editFormData.is_urgent === false ? false : undefined) : undefined,
        priority_flag: canEditAll ? (editFormData.priority_flag === true ? true : editFormData.priority_flag === false ? false : undefined) : undefined,
        priority_pay_date: canEditAll ? parseString(editFormData.priority_pay_date) : undefined,
        date_range_start: canEditAll ? parseString(editFormData.date_range_start) : undefined,
        date_range_end: canEditAll ? parseString(editFormData.date_range_end) : undefined,
      };
      const response = await invoiceApi.update(selectedInvoice.id, payload);
      const mismatches = Object.entries(payload).filter(([field, expected]) => {
        if (expected === undefined || field === 'edit_reason') return false;
        if ((field === 'vendor_name_raw' || field === 'new_vendor_name') && (payload as any).vendor_id) return false;
        const persistedValues = (response.data as any)._persisted_values || response.data;
        const actual = persistedValues[field];
        if (expected === null) return actual !== null && actual !== undefined;
        if (typeof expected === 'number') return Number(actual) !== expected;
        if (field.endsWith('_date') || field === 'invoice_date' || field === 'due_date') {
          return !String(actual || '').startsWith(String(expected));
        }
        return String(actual ?? '') !== String(expected);
      });
      if (mismatches.length > 0) {
        throw new Error(`Save verification failed for: ${mismatches.map(([field]) => field).join(', ')}`);
      }
      await refresh();
      setSelectedInvoice(response.data);
      setShowEditModal(false);
      showToast('Invoice updated successfully', 'success');
    } catch (error: any) {
      console.error('Failed to update invoice:', error);
      showToast(error?.response?.data?.message || error?.response?.data?.error?.message || 'Failed to update invoice', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRequestBankChange = async () => {
    if (!selectedInvoice || !bankChangeField || !bankChangeValue.trim() || !bankChangeReason.trim()) return;
    setSubmittingBankChange(true);
    try {
      const currentValue = String((editFormData as any)[bankChangeField] || '');
      const response = await invoiceApi.requestBankChange(selectedInvoice.id, {
        field: bankChangeField,
        current_value: currentValue,
        requested_value: bankChangeValue,
        reason: bankChangeReason,
        attachment: bankChangeAttachment || undefined,
      });
      showToast(response.data?.message || 'Bank details change request submitted', 'success');
      setShowBankChangeModal(false);
      setBankChangeField('');
      setBankChangeValue('');
      setBankChangeReason('');
      setBankChangeAttachment(null);
    } catch (error: any) {
      console.error('Failed to submit bank change request:', error);
      showToast(error?.response?.data?.message || error?.response?.data?.error?.message || 'Failed to submit request', 'error');
    } finally {
      setSubmittingBankChange(false);
    }
  };

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim()) return;

    try {
      await invoiceApi.reject(selectedInvoice.id, rejectReason);
      showToast('Invoice rejected successfully', 'success');
      await refresh();
      setSelectedInvoice(null);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error: any) {
      console.error('Failed to reject invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to reject invoice';
      showToast(msg, 'error');
    }
  };

  const handleReturnForCorrection = async () => {
    if (!selectedInvoice) return;
    if (!returnReason.trim()) return;
    try {
      await invoiceApi.returnForCorrection(selectedInvoice.id, returnReason.trim());
      showToast('Invoice returned to the previous approver', 'success');
      await refresh();
      setSelectedInvoice(null);
    } catch (error: any) {
      showToast(error?.response?.data?.error?.message || 'Failed to return invoice', 'error');
    } finally {
      setShowReturnModal(false);
      setReturnReason('');
    }
  };

  const handleDeleteInvoice = async () => {
    if (!selectedInvoice) return;
    try {
      await invoiceApi.delete(selectedInvoice.id);
      showToast(`Invoice ${selectedInvoice.invoice_number} deleted successfully`, 'success');
      await refresh();
      setSelectedInvoice(null);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to delete invoice';
      showToast(msg, 'error');
    } finally {
      setShowDeleteModal(false);
    }
  };

  const handlePost = async (bypassVarianceCheck: boolean = false) => {
    if (!selectedInvoice) return;

    try {
      setPosting(true);
      await invoiceApi.post(selectedInvoice.id, bypassVarianceCheck);
      showToast('Invoice posted to accounting successfully', 'success');
      await refresh();
      setSelectedInvoice(null);
    } catch (error: any) {
      console.error('Failed to post invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to post invoice';
      showToast(msg, 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleReleaseHold = async () => {
    if (!selectedInvoice) return;

    try {
      setPosting(true);
      await invoiceApi.releaseHold(selectedInvoice.id);
      showToast('Invoice released from hold', 'success');
      await refresh();
      setSelectedInvoice(null);
    } catch (error: any) {
      console.error('Failed to release invoice from hold:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to release invoice from hold';
      showToast(msg, 'error');
    } finally {
      setPosting(false);
    }
  };

  const [holdingInvoice, setHoldingInvoice] = useState(false);

  const handleHoldForBatchThreshold = () => {
    setHoldReason('Vendor cumulative amount below $100 batch threshold');
    setShowHoldModal(true);
  };

  const confirmHoldForBatchThreshold = async () => {
    if (!selectedInvoice) return;
    try {
      setHoldingInvoice(true);
      await invoiceApi.holdForBatchThreshold(selectedInvoice.id, holdReason || undefined);
      showToast('Invoice put on hold for batch threshold', 'success');
      setShowHoldModal(false);
      await refresh();
      setSelectedInvoice(null);
    } catch (error: any) {
      console.error('Failed to hold invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to hold invoice';
      showToast(msg, 'error');
    } finally {
      setHoldingInvoice(false);
    }
  };

  // Auto-validate selected invoice against NextGen in real-time
  useEffect(() => {
    if (!selectedInvoice) return;
    if (nextgenResults[selectedInvoice.id]) return;
    const validate = async () => {
      setNextgenResults(prev => ({ ...prev, [selectedInvoice.id]: { status: 'loading' } }));
      try {
        const res = await invoiceApi.checkNextGenSync(selectedInvoice.id);
        const data = res.data;
        if (!data || (!data.hasChanges && !data.hasCriticalChanges && !data.changes?.length)) {
          if (!selectedInvoice.mpo_number) {
            setNextgenResults(prev => ({ ...prev, [selectedInvoice.id]: { status: 'no-mpo' } }));
          } else {
            setNextgenResults(prev => ({ ...prev, [selectedInvoice.id]: { status: 'matched', data } }));
          }
        } else if (data.hasCriticalChanges) {
          setNextgenResults(prev => ({ ...prev, [selectedInvoice.id]: { status: 'mismatch', changes: data.changes, criticalChanges: data.criticalChanges, data } }));
        } else {
          setNextgenResults(prev => ({ ...prev, [selectedInvoice.id]: { status: 'matched', changes: data.changes, data } }));
        }
      } catch (err) {
        setNextgenResults(prev => ({ ...prev, [selectedInvoice.id]: { status: 'error' } }));
      }
    };
    validate();
  }, [selectedInvoice]);

  const handleCheckNextGen = async () => {
    if (!selectedInvoice) return;

    try {
      setPosting(true);
      const result = await invoiceApi.checkNextGen(selectedInvoice.id);
      if (result.data.hasCriticalChanges) {
        showToast(`Critical NextGen changes detected: ${result.data.criticalChanges.map((c: any) => c.field).join(', ')}`, 'warning');
      } else if (result.data.hasChanges) {
        showToast(`NextGen changes detected (informational): ${result.data.changes.map((c: any) => c.field).join(', ')}`, 'info');
      } else {
        showToast('No NextGen changes detected', 'success');
      }
      await refresh();
    } catch (error: any) {
      console.error('Failed to check NextGen changes:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to check NextGen changes';
      showToast(msg, 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleSendPaymentConfirmation = async () => {
    if (!selectedInvoice) return;
    setSendingConfirmation(true);
    try {
      const res = await invoiceApi.sendPaymentConfirmation(selectedInvoice.id);
      showToast(res.data.sent_to ? `Payment confirmation sent to ${res.data.sent_to}` : 'Payment confirmation marked as sent (no vendor email)', 'success');
      await refresh();
      setShowConfirmSendModal(false);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'Failed to send payment confirmation';
      showToast(msg, 'error');
    } finally {
      setSendingConfirmation(false);
    }
  };

  // Payables aging — compute from real invoice data
  const payablesAging = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const unpaidStatuses: InvoiceStatus[] = [
      InvoiceStatus.PENDING_COORDINATOR, InvoiceStatus.PENDING_MANAGER,
      InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER, InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
      InvoiceStatus.PENDING_SR_MANAGER, InvoiceStatus.PENDING_POLLY,
      InvoiceStatus.PENDING_ACCOUNTING, InvoiceStatus.APPROVED,
      InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED,
      InvoiceStatus.VALIDATION_PENDING, InvoiceStatus.ON_HOLD, InvoiceStatus.EXCEPTION_FLAGGED,
    ];
    const unpaidInvoices = allInvoices.filter(inv => unpaidStatuses.includes(inv.status as InvoiceStatus));

    const buckets = [
      { label: 'Current (not yet due)', count: 0, amount: 0, color: 'var(--accent-lime)' },
      { label: '1\u201330 days overdue', count: 0, amount: 0, color: 'var(--accent-amber)' },
      { label: '31\u201360 days overdue', count: 0, amount: 0, color: 'var(--accent-orange)' },
      { label: '60+ days overdue', count: 0, amount: 0, color: 'var(--accent-red)' },
    ];

    for (const inv of unpaidInvoices) {
      const amount = Number(inv.total_amount || 0);
      if (!inv.due_date) {
        buckets[0].count++;
        buckets[0].amount += amount;
        continue;
      }
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        buckets[0].count++;
        buckets[0].amount += amount;
      } else if (diffDays <= 30) {
        buckets[1].count++;
        buckets[1].amount += amount;
      } else if (diffDays <= 60) {
        buckets[2].count++;
        buckets[2].amount += amount;
      } else {
        buckets[3].count++;
        buckets[3].amount += amount;
      }
    }

    return buckets;
  }, [allInvoices]);

  // Supplier balance — compute from real invoice data
  const supplierBalance = useMemo(() => {
    const receivedStatuses: InvoiceStatus[] = [
      InvoiceStatus.RECEIVED, InvoiceStatus.OCR_PROCESSING, InvoiceStatus.VALIDATION_PENDING,
      InvoiceStatus.EXCEPTION_FLAGGED, InvoiceStatus.ON_HOLD,
      InvoiceStatus.PENDING_COORDINATOR, InvoiceStatus.PENDING_MANAGER,
      InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER, InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
      InvoiceStatus.PENDING_SR_MANAGER, InvoiceStatus.PENDING_POLLY,
      InvoiceStatus.PENDING_ACCOUNTING, InvoiceStatus.APPROVED,
      InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID,
    ];
    const recordedStatuses: InvoiceStatus[] = receivedStatuses.filter(s => s !== InvoiceStatus.RECEIVED && s !== InvoiceStatus.OCR_PROCESSING);
    const unpaidStatuses: InvoiceStatus[] = receivedStatuses.filter(s => s !== InvoiceStatus.PAID && s !== InvoiceStatus.REJECTED);

    const vendorMap = new Map<string, { name: string; received: number; recorded: number; outstanding: number }>();

    for (const inv of allInvoices) {
      const vendorName = inv.vendor_name || inv.vendor_name_raw || inv.vendor?.name || 'Unknown Vendor';
      const existing = vendorMap.get(vendorName) || { name: vendorName, received: 0, recorded: 0, outstanding: 0 };
      if (receivedStatuses.includes(inv.status as InvoiceStatus)) {
        existing.received++;
      }
      if (recordedStatuses.includes(inv.status as InvoiceStatus)) {
        existing.recorded++;
      }
      if (unpaidStatuses.includes(inv.status as InvoiceStatus)) {
        existing.outstanding += Number(inv.total_amount || 0);
      }
      vendorMap.set(vendorName, existing);
    }

    return Array.from(vendorMap.values())
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10);
  }, [allInvoices]);

  // Urgent payments — invoices due within 7 days or already overdue (not yet paid)
  // Uses roleFilteredInvoices so the card count matches what the user can actually see
  const urgentPayments = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const unpaidStatuses: InvoiceStatus[] = [
      InvoiceStatus.PENDING_ACCOUNTING, InvoiceStatus.APPROVED,
      InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED,
      InvoiceStatus.PENDING_COORDINATOR, InvoiceStatus.PENDING_MANAGER,
      InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER, InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
      InvoiceStatus.PENDING_SR_MANAGER, InvoiceStatus.PENDING_POLLY,
      InvoiceStatus.VALIDATION_PENDING, InvoiceStatus.ON_HOLD,
    ];
    return roleFilteredInvoices.filter(inv => {
      if (!unpaidStatuses.includes(inv.status as InvoiceStatus)) return false;
      if (!inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays <= 7; // due within 7 days or overdue
    });
  }, [roleFilteredInvoices]);

  // Accounting KPIs are intentionally scoped to work that Accounting can act on.
  const accountingQueue = useMemo(() => allInvoices.filter(inv =>
    inv.status === InvoiceStatus.PENDING_ACCOUNTING || inv.status === InvoiceStatus.APPROVED
  ), [allInvoices]);

  const accountingOnHold = useMemo(() => allInvoices.filter(inv =>
    inv.status === InvoiceStatus.ON_HOLD
  ), [allInvoices]);

  const accountingUrgentPayments = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const actionableStatuses: InvoiceStatus[] = [
      InvoiceStatus.PENDING_ACCOUNTING,
      InvoiceStatus.APPROVED,
      InvoiceStatus.POSTED_TO_QB,
      InvoiceStatus.PAYMENT_SCHEDULED,
    ];
    return allInvoices.filter(inv => {
      if (!actionableStatuses.includes(inv.status as InvoiceStatus) || !inv.due_date) return false;
      const dueDate = new Date(inv.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    });
  }, [allInvoices]);

  const paidPendingConfirmation = useMemo(() => allInvoices.filter(inv =>
    inv.status === InvoiceStatus.PAID &&
    !inv.confirmation_sent_at &&
    !inv.payment_confirmations?.some(confirmation => confirmation.email_sent)
  ), [allInvoices]);

  // Processing time per stage — compute from real stage_timestamps data
  const processingTimePerStage = useMemo(() => {
    const stageLabels: Record<string, { label: string; sla: number }> = {
      PENDING_COORDINATOR: { label: 'Purchasing Coordinator', sla: 7 * 24 },
      PENDING_MANAGER: { label: 'Purchasing Manager', sla: 7 * 24 },
      PENDING_MLO_ACCOUNT_HOLDER: { label: 'MLO Account Holder', sla: 3 * 24 },
      PENDING_MLO_PLANNING_MANAGER: { label: 'Planning Manager', sla: 4 * 24 },
      PENDING_SR_MANAGER: { label: 'Sr. Manager GPO', sla: 7 * 24 },
      PENDING_POLLY: { label: 'Ms. Polly', sla: 7 * 24 },
      PENDING_ACCOUNTING: { label: 'Accounting', sla: 7 * 24 },
      POSTED_TO_QB: { label: 'Posted to QB', sla: 5 * 24 },
    };

    const stageData = new Map<string, { totalHours: number; count: number; breached: number; sla: number }>();

    for (const inv of allInvoices) {
      for (const st of inv.stage_timestamps) {
        const config = stageLabels[st.stage];
        if (!config) continue;

        const entered = new Date(st.entered_at);
        const exited = st.exited_at ? new Date(st.exited_at) : new Date();
        const hours = calcWorkingHoursElapsed(entered, exited);

        const existing = stageData.get(st.stage) || { totalHours: 0, count: 0, breached: 0, sla: config.sla };
        existing.totalHours += hours;
        existing.count++;
        if (st.is_breached) existing.breached++;
        stageData.set(st.stage, existing);
      }
    }

    const result = Array.from(stageData.entries()).map(([stage, data]) => ({
      stage,
      label: stageLabels[stage].label,
      avg: data.count > 0 ? Math.round(data.totalHours / data.count) : 0,
      sla: data.sla,
      breached: data.breached,
      total: data.count,
    }));

    return result;
  }, [allInvoices]);

  const slaCompliance = useMemo(() => {
    if (processingTimePerStage.length === 0) return 0;
    const totalStages = processingTimePerStage.reduce((sum, s) => sum + s.total, 0);
    const totalBreached = processingTimePerStage.reduce((sum, s) => sum + s.breached, 0);
    if (totalStages === 0) return 0;
    return Math.round(((totalStages - totalBreached) / totalStages) * 100);
  }, [processingTimePerStage]);

  // Role-specific KPI cards
  const getRoleSpecificKPIs = () => {
    if (!user) return [];

    const role = user.role;

    switch (role) {
      case 'ACCOUNTING_ASSOCIATE': {
        return [
          {
            label: 'Accounting Queue',
            value: accountingQueue.length,
            icon: FileText,
            accent: 'info',
            ...calcTrend(accountingQueue),
            subtitle: 'Ready for accounting review',
          },
          {
            label: 'Accounting On Hold',
            value: accountingOnHold.length,
            icon: Clock,
            accent: 'warning',
            ...calcTrend(accountingOnHold),
            subtitle: 'Requires accounting action',
          },
          {
            label: 'Urgent Payments',
            value: accountingUrgentPayments.length,
            icon: AlertTriangle,
            accent: 'danger',
            ...calcTrend(accountingUrgentPayments),
            subtitle: 'Due within 7 days / overdue',
          },
          {
            label: 'PAID — Confirmation Pending',
            value: paidPendingConfirmation.length,
            icon: Send,
            accent: 'success',
            ...calcTrend(paidPendingConfirmation),
            subtitle: 'Send payment confirmations',
          },
        ];
      }

      case 'PURCHASING_COORDINATOR': {
        const pendCoord = allInvoices.filter(i => i.status === 'PENDING_COORDINATOR');
        const poFound = allInvoices.filter(i => i.po_validation?.po_found);
        const vendorMismatch = allInvoices.filter(i => i.po_validation?.comparison?.vendor_match === false);
        const approvedWk = allInvoices.filter(i => i.status === 'APPROVED');
        return [
          {
            label: 'Pending My Approval',
            value: pendCoord.length,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendCoord),
          },
          {
            label: 'NextGen Validation Results',
            value: poFound.length,
            icon: CheckCircle,
            accent: 'success',
            ...calcTrend(poFound),
          },
          {
            label: 'Vendor Mismatches',
            value: vendorMismatch.length,
            icon: AlertTriangle,
            accent: 'danger',
            ...calcTrend(vendorMismatch),
          },
          {
            label: 'Approved This Week',
            value: approvedWk.length,
            icon: CheckSquare,
            accent: 'success',
            ...calcTrend(approvedWk),
          },
        ];
      }

      case 'PURCHASING_MANAGER': {
        const pendMgr = allInvoices.filter(i => i.status === 'PENDING_MANAGER');
        const poSum = allInvoices.filter(i => i.po_validation?.po_found);
        const escalated = allInvoices.filter(i => i.status === InvoiceStatus.ON_HOLD);
        const approvedMgr = allInvoices.filter(i => i.status === 'APPROVED');
        const approvalRate = approvedMgr.length + pendMgr.length > 0
          ? Math.round((approvedMgr.length / (approvedMgr.length + pendMgr.length)) * 100)
          : 0;
        return [
          {
            label: 'Pending My Approval',
            value: pendMgr.length,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendMgr),
          },
          {
            label: 'Team Performance',
            value: approvalRate + '%',
            icon: TrendingUp,
            accent: 'default',
            ...calcTrend(approvedMgr),
            subtitle: 'Coordinator approval rate',
          },
          {
            label: 'NextGen Validation Summary',
            value: poSum.length,
            icon: CheckCircle,
            accent: 'success',
            ...calcTrend(poSum),
          },
          {
            label: 'Escalated Items',
            value: escalated.length,
            icon: AlertTriangle,
            accent: 'warning',
            ...calcTrend(escalated),
          },
        ];
      }

      case 'ACCOUNTING_SUPERVISOR': {
        return [
          {
            label: 'Accounting Queue',
            value: accountingQueue.length,
            icon: FileText,
            accent: 'info',
            ...calcTrend(accountingQueue),
            subtitle: 'Ready for accounting review',
          },
          {
            label: 'Accounting On Hold',
            value: accountingOnHold.length,
            icon: Clock,
            accent: 'warning',
            ...calcTrend(accountingOnHold),
            subtitle: 'Requires accounting action',
          },
          {
            label: 'Urgent Payments',
            value: accountingUrgentPayments.length,
            icon: AlertTriangle,
            accent: 'danger',
            ...calcTrend(accountingUrgentPayments),
            subtitle: 'Due within 7 days / overdue',
          },
          {
            label: 'PAID — Confirmation Pending',
            value: paidPendingConfirmation.length,
            icon: Send,
            accent: 'success',
            ...calcTrend(paidPendingConfirmation),
            subtitle: 'Send payment confirmations',
          },
        ];
      }

      case 'PLANNING_MANAGER': {
        const brandScope = user.brand_scope;
        const filteredByBrand = brandScope === 'TOP_10'
          ? allInvoices.filter(i => ['TNF', 'UA', 'VNS', 'ARC', 'CSC', 'HH', 'BUR', 'TM', 'FR', 'ON'].includes(i.brand_code || ''))
          : allInvoices.filter(i => !['TNF', 'UA', 'VNS', 'ARC', 'CSC', 'HH', 'BUR', 'TM', 'FR', 'ON'].includes(i.brand_code || ''));
        const pendPlan = filteredByBrand.filter(i => i.status === 'PENDING_MLO_PLANNING_MANAGER');
        const brandNotPaid = filteredByBrand.filter(i => i.status !== 'PAID');
        const brandApproved = filteredByBrand.filter(i => i.status === 'APPROVED');
        return [
          {
            label: `${brandScope} Brand Invoices`,
            value: filteredByBrand.length,
            icon: Building2,
            accent: 'info',
            ...calcTrend(filteredByBrand),
          },
          {
            label: 'Pending My Approval',
            value: pendPlan.length,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendPlan),
          },
          {
            label: 'Brand-Filtered List',
            value: brandNotPaid.length,
            icon: FileSearch,
            accent: 'default',
            ...calcTrend(brandNotPaid),
          },
          {
            label: 'Approved This Month',
            value: brandApproved.length,
            icon: CheckCircle,
            accent: 'success',
            ...calcTrend(brandApproved),
          },
        ];
      }

      case 'SR_MANAGER_GLOBAL_PRODUCTION': {
        const prodInvs = allInvoices.filter(i => i.total_amount > 2000);
        const pendSr = allInvoices.filter(i => i.status === 'PENDING_SR_MANAGER');
        const tier3 = allInvoices.filter(i => (i.approval_tier || 0) >= 3);
        return [
          {
            label: 'Production Invoices $2K+',
            value: prodInvs.length,
            icon: Package,
            accent: 'info',
            ...calcTrend(prodInvs),
          },
          {
            label: 'Pending My Approval',
            value: pendSr.length,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendSr),
          },
          {
            label: 'Global Production Costs',
            value: `$${prodInvs.reduce((sum, i) => sum + i.total_amount, 0).toLocaleString()}`,
            icon: TrendingUp,
            accent: 'default',
            ...calcTrend(prodInvs),
          },
          {
            label: 'Tier 3+ Approvals',
            value: tier3.length,
            icon: Shield,
            accent: 'success',
            ...calcTrend(tier3),
          },
        ];
      }

      case 'MS_POLLY': {
        const pendPolly = allInvoices.filter(i => i.status === 'PENDING_POLLY');
        const criticalExc = allInvoices.filter(i => i.status === InvoiceStatus.EXCEPTION_FLAGGED);
        return [
          {
            label: 'Total Invoices This Month',
            value: allInvoices.length,
            icon: FileText,
            accent: 'info',
            ...calcTrend(allInvoices),
          },
          {
            label: 'Total AP Amount',
            value: `$${totalAmountCount.count.toLocaleString()}`,
            icon: TrendingUp,
            accent: 'default',
            ...calcTrend(allInvoices),
          },
          {
            label: 'Pending My Approval',
            value: pendPolly.length,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendPolly),
          },
          {
            label: 'Critical Exceptions',
            value: exceptionsCount.count,
            icon: AlertCircle,
            accent: 'danger',
            ...calcTrend(criticalExc),
          },
        ];
      }

      case 'IT_ADMIN':
        return [
          {
            label: 'System Health',
            value: '98.5%',
            icon: CheckCircle,
            accent: 'success',
            trend: '—',
            trendUp: false,
          },
          {
            label: 'NextGen Integration',
            value: 'Active',
            icon: Shield,
            accent: 'info',
            trend: '—',
            trendUp: false,
          },
          {
            label: 'Total Invoices',
            value: allInvoices.length,
            icon: FileText,
            accent: 'default',
            ...calcTrend(allInvoices),
          },
          {
            label: 'Exceptions',
            value: exceptionsCount.count,
            icon: AlertCircle,
            accent: 'danger',
            ...calcTrend(allInvoices.filter(i => i.status === InvoiceStatus.EXCEPTION_FLAGGED)),
          },
        ];

      case 'SUPERADMIN':
        return [
          {
            label: 'System Health',
            value: '98.5%',
            icon: CheckCircle,
            accent: 'success',
            trend: '—',
            trendUp: false,
          },
          {
            label: 'Active Users',
            value: '12',
            icon: Users,
            accent: 'info',
            trend: '—',
            trendUp: false,
          },
          {
            label: 'System Configuration',
            value: 'Active',
            icon: Settings,
            accent: 'default',
            trend: '—',
            trendUp: false,
          },
          {
            label: 'Error Logs',
            value: '0',
            icon: AlertCircle,
            accent: 'danger',
            trend: '—',
            trendUp: false,
          },
        ];

      default: {
        const pendValDefault = allInvoices.filter(i => i.status === InvoiceStatus.VALIDATION_PENDING);
        const awaitAppr = allInvoices.filter(i => Object.values(InvoiceStatus).some(s => s.startsWith('PENDING_') && s !== 'PENDING_ACCOUNTING' && i.status === s));
        const urgentPay = allInvoices.filter(i => i.is_urgent && i.status !== 'PAID');
        const excDefault = allInvoices.filter(i => i.status === InvoiceStatus.EXCEPTION_FLAGGED);
        return [
          {
            label: 'Pending Validation',
            value: pendingValidationCount.count,
            icon: FileText,
            accent: 'info',
            ...calcTrend(pendValDefault),
          },
          {
            label: 'Awaiting Approval',
            value: awaitingApprovalCount.count,
            icon: Clock,
            accent: 'default',
            ...calcTrend(awaitAppr),
          },
          {
            label: 'Urgent Payments',
            value: urgentPaymentsCount.count,
            icon: AlertTriangle,
            accent: 'danger',
            ...calcTrend(urgentPay),
          },
          {
            label: 'Exceptions',
            value: exceptionsCount.count,
            icon: AlertCircle,
            accent: 'danger',
            ...calcTrend(excDefault),
          },
        ];
      }
    }
  };

  const kpis = getRoleSpecificKPIs();

  // Excel export for filtered invoices — generates a formatted .xls file
  const exportFilteredCSV = () => {
    const rows = sortedInvoices;
    if (rows.length === 0) return;

    const statusLabel = filters.status ? filters.status.replace(/_/g, ' ') : 'All Invoices';
    const exportDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const fileName = `AP-Invoice-Report-${filters.status || 'all'}-${new Date().toISOString().split('T')[0]}.xls`;

    const columns = [
      { header: '#', width: 40 },
      { header: 'Invoice Number', width: 160 },
      { header: 'Vendor Name', width: 220 },
      { header: 'Status', width: 140 },
      { header: 'Amount', width: 100 },
      { header: 'Currency', width: 70 },
      { header: 'Invoice Date', width: 100 },
      { header: 'Due Date', width: 100 },
      { header: 'Brand', width: 100 },
      { header: 'PO Number', width: 120 },
      { header: 'MPO Number', width: 120 },
      { header: 'Payment Terms', width: 100 },
      { header: 'Bank Name', width: 180 },
      { header: 'SWIFT Code', width: 120 },
      { header: 'Account Number', width: 160 },
    ];

    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const headerRow = columns.map(c =>
      `<td style="background:#1F2937;color:#FFFFFF;font-weight:bold;text-align:center;border:1px solid #374151;padding:6px 8px;white-space:nowrap;">${esc(c.header)}</td>`
    ).join('');

    const dataRows = rows.map((inv: any, idx: number) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F3F4F6';
      const style = `style="background:${bg};border:1px solid #D1D5DB;padding:5px 8px;white-space:nowrap;mso-number-format:'\\@';"`;
      const amountStyle = `style="background:${bg};border:1px solid #D1D5DB;padding:5px 8px;text-align:right;white-space:nowrap;mso-number-format:'#,##0.00';"`;
      const centerStyle = `style="background:${bg};border:1px solid #D1D5DB;padding:5px 8px;text-align:center;white-space:nowrap;"`;
      return `<tr>` +
        `<td ${centerStyle}>${idx + 1}</td>` +
        `<td ${style}>${esc(inv.invoice_number || '')}</td>` +
        `<td ${style}>${esc(inv.vendor_name_raw || inv.vendor?.name || '')}</td>` +
        `<td ${centerStyle}>${esc((inv.status || '').replace(/_/g, ' '))}</td>` +
        `<td ${amountStyle}>${esc(inv.total_amount || 0)}</td>` +
        `<td ${centerStyle}>${esc(inv.currency || '')}</td>` +
        `<td ${centerStyle}>${esc(inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('en-US') : '')}</td>` +
        `<td ${centerStyle}>${esc(inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-US') : '')}</td>` +
        `<td ${style}>${esc(inv.brand || '')}</td>` +
        `<td ${style}>${esc(inv.po_number || inv.customer_po_number || '')}</td>` +
        `<td ${style}>${esc(inv.mpo_number || inv.mpo_base_number || '')}</td>` +
        `<td ${centerStyle}>${esc(inv.payment_terms || '')}</td>` +
        `<td ${style}>${esc(inv.bank_name || '')}</td>` +
        `<td ${style}>${esc(inv.swift_code || '')}</td>` +
        `<td ${style}>${esc(inv.account_number || '')}</td>` +
        `</tr>`;
    }).join('');

    const totalAmount = rows.reduce((sum: number, inv: any) => sum + (Number(inv.total_amount) || 0), 0);

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>AP Invoice Report</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table>
<tr><td colspan="${columns.length}" style="font-size:18px;font-weight:bold;color:#1F2937;padding:4px 0;">Madison 88 — AP Invoice Report</td></tr>
<tr><td colspan="${columns.length}" style="font-size:12px;color:#6B7280;padding:2px 0;">Filter: ${esc(statusLabel)} &nbsp;|&nbsp; Generated: ${esc(exportDate)} &nbsp;|&nbsp; Total Records: ${rows.length}</td></tr>
<tr><td colspan="${columns.length}" style="font-size:12px;color:#6B7280;padding:2px 0 10px 0;">Total Amount: ${esc(rows[0]?.currency || 'USD')} ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
<tr></tr>
<tr>${headerRow}</tr>
${dataRows}
</table>
</body>
</html>`;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  // KPI click — filter invoice list by relevant status
  const handleKpiClick = (kpiLabel: string) => {
    const label = kpiLabel.toLowerCase();
    // Map KPI labels to status filters
    if (label.includes('validation')) {
      setFilters({ ...filters, status: InvoiceStatus.VALIDATION_PENDING });
    } else if (label.includes('awaiting approval') || label.includes('pending my approval')) {
      // Pending approvals — clear status filter to show all pending stages
      setFilters({ ...filters, status: undefined });
    } else if (label.includes('exception')) {
      setFilters({ ...filters, status: InvoiceStatus.EXCEPTION_FLAGGED });
    } else if (label.includes('scheduled payment')) {
      setFilters({ ...filters, status: InvoiceStatus.PAYMENT_SCHEDULED });
    } else if (label.includes('pending accounting') || label.includes('accounting review')) {
      setFilters({ ...filters, status: InvoiceStatus.PENDING_ACCOUNTING });
    } else if (label.includes('approved')) {
      setFilters({ ...filters, status: InvoiceStatus.APPROVED });
    } else if (label.includes('on-hold') || label.includes('hold') || label.includes('escalated')) {
      setFilters({ ...filters, status: InvoiceStatus.ON_HOLD });
    } else if (label.includes('paid')) {
      setFilters({ ...filters, status: InvoiceStatus.PAID });
    } else if (label.includes('posted')) {
      setFilters({ ...filters, status: InvoiceStatus.POSTED_TO_QB });
    } else if (label.includes('urgent')) {
      setFilters({ ...filters, status: undefined, urgentDue: true });
    } else {
      setFilters({ ...filters, status: undefined });
    }
    // Scroll to invoice table
    setTimeout(() => {
      const section = document.getElementById('invoice-list-section');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else {
        const table = document.querySelector('[data-invoice-table]');
        if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 150);
  };

  return (
    <div>
      {/* Primary Action Bar */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Dashboard</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user?.role === 'SUPERADMIN' ? 'System maintenance, user and role management' : 'Manage invoices, approvals, and validations'}</p>
            </div>
            <div className="flex items-center gap-3">
              {user && (user.role === 'PURCHASING_COORDINATOR' || user.role === 'IT_ADMIN') && (
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all"
                  style={{ background: 'var(--accent-lime)', color: 'var(--text-inverse)', boxShadow: '0 0 16px var(--accent-lime-glow)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-lime-hover)'; e.currentTarget.style.boxShadow = '0 0 24px var(--accent-lime-glow)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-lime)'; e.currentTarget.style.boxShadow = '0 0 16px var(--accent-lime-glow)'; }}
                >
                  <FileText className="h-4 w-4" strokeWidth={1.75} />
                  Upload Invoice
                </button>
              )}
              {user && hasPermission(user.role, 'canApprove') && (
                <button
                  onClick={() => navigate('/approvals')}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all"
                  style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <CheckCircle className="h-4 w-4" strokeWidth={1.75} />
                  Review Approvals
                </button>
              )}
            </div>
          </div>

          {/* KPI Cards */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                >
                  <div className="p-5">
                    <div className="w-32 h-3 rounded animate-shimmer mb-4" style={{ animationDelay: `${i * 50}ms`, background: 'var(--bg-card-hover)' }} />
                    <div className="w-16 h-8 rounded animate-shimmer mb-4" style={{ animationDelay: `${i * 50 + 100}ms`, background: 'var(--bg-card-hover)' }} />
                    <div className="w-24 h-3 rounded animate-shimmer mb-4" style={{ animationDelay: `${i * 50 + 200}ms`, background: 'var(--bg-card-hover)' }} />
                    <div className="w-full h-1 rounded animate-shimmer" style={{ animationDelay: `${i * 50 + 300}ms`, background: 'var(--bg-card-hover)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {kpis.map((kpi, idx) => {
                const accent: any = kpi.accent || 'default';
                return (
                  <div key={kpi.label} className="animate-fade-in-up card-lift" style={{ animationDelay: `${idx * 50}ms` }}>
                    <StatCard
                      title={kpi.label}
                      value={kpi.value}
                      icon={kpi.icon}
                      accent={accent}
                      trend={kpi.trend ? { value: kpi.trend, direction: kpi.trendUp ? 'up' : 'down' } : undefined}
                      subtitle={(kpi as any).subtitle}
                      onClick={() => handleKpiClick(kpi.label)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottleneck View - Hide for IT_ADMIN and SUPERADMIN */}
          {user && user.role !== 'IT_ADMIN' && user.role !== 'SUPERADMIN' && (
            <BottleneckView />
          )}

          {/* Secondary Role-Specific Actions */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {user && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
              <button
                onClick={() => navigate('/payment-batches')}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ border: '1px solid color-mix(in srgb, var(--accent-lime) 30%, transparent)', background: 'color-mix(in srgb, var(--accent-lime) 10%, transparent)', color: 'var(--accent-lime)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-lime) 20%, transparent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-lime) 10%, transparent)'; }}
              >
                Manage Payment Batches
              </button>
            )}
            {user && (user.role === 'IT_ADMIN' || user.role === 'SUPERADMIN') && (
              <button
                onClick={() => navigate('/settings')}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ border: '1px solid var(--border-color)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <Settings className="h-3.5 w-3.5" />
                System Configuration
              </button>
            )}
          </div>

          {/* My Tasks Widget */}
          {user && user.role !== 'MS_POLLY' && user.role !== 'IT_ADMIN' && user.role !== 'SUPERADMIN' && (
            <MyTasksWidget
              user={user}
              invoices={allInvoices}
              onFilterClick={(status) => setFilters({ ...filters, status })}
            />
          )}

          {/* Duplicate-invoice report banner — surface duplicates before approval */}
          {duplicateGroups.length > 0 && (
            <div className="p-4 mb-6 rounded-2xl" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Copy className="h-5 w-5 mt-0.5 shrink-0" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--accent-red)' }}>
                      {duplicateGroups.length} duplicate invoice number{duplicateGroups.length > 1 ? 's' : ''} detected
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      The same invoice number appears on {duplicateGroups.map((g: any) => g.count).join(', ')} records — resolve before approving to avoid double payment:
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {duplicateGroups.map((g: any) => (
                        <span key={g.invoice_number} className="px-2 py-0.5 rounded-md text-xs font-mono" style={{ background: 'color-mix(in srgb, var(--accent-red) 15%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)' }}>
                          {g.invoice_number} ×{g.count}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFilters((f: any) => ({ ...f, status: undefined }));
                    setQuickFilter('duplicates');
                  }}
                  className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ background: 'var(--accent-red)', color: 'var(--text-inverse)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  View duplicates
                </button>
              </div>
            </div>
          )}

          {/* Filters — pill selectors */}
          {user && user.role !== 'MS_POLLY' && user.role !== 'IT_ADMIN' && user.role !== 'SUPERADMIN' && (
            <div className="p-4 mb-6 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Filter Invoices</h3>
                <div className="flex items-center gap-3">
                  <StatusGuide />
                </div>
              </div>
              {/* Quick filters — pill buttons */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setQuickFilter('all')}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={quickFilter === 'all'
                    ? { background: 'var(--accent-purple)', color: 'var(--text-inverse)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  All Invoices
                </button>
                <button
                  onClick={() => setQuickFilter('returned')}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5"
                  style={quickFilter === 'returned'
                    ? { background: 'var(--accent-amber)', color: 'var(--text-inverse)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                  Returned to Me
                  {returnedToMeCount > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.2)' }}>
                      {returnedToMeCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setQuickFilter('urgent')}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5"
                  style={quickFilter === 'urgent'
                    ? { background: 'var(--accent-red)', color: 'var(--text-inverse)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  Urgent (SLA ≤24h)
                  {quickFilteredInvoices.length > 0 && quickFilter === 'urgent' && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.2)' }}>
                      {quickFilteredInvoices.length}
                    </span>
                  )}
                </button>
                {duplicateGroups.length > 0 && (
                  <button
                    onClick={() => setQuickFilter('duplicates')}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5"
                    style={quickFilter === 'duplicates'
                      ? { background: 'var(--accent-red)', color: 'var(--text-inverse)' }
                      : { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)' }}
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    Duplicates ({duplicateGroups.length})
                  </button>
                )}
              </div>
              {/* Primary filters — always visible */}
              <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                <div className="relative w-full md:flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search invoice #, vendor, brand, PO, or MPO..."
                    value={filters.search || ''}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
                    className="w-full h-9 pl-9 pr-4 rounded-full focus:outline-none text-sm transition-all"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <select
                  value={filters.status || ''}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus | undefined })}
                  className="h-9 w-full md:w-auto px-4 rounded-full focus:outline-none text-sm appearance-none cursor-pointer transition-all" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                >
                  <option value="" style={{ background: 'var(--input-bg)' }}>All Statuses</option>
                  {Object.values(InvoiceStatus).map((status) => (
                    <option key={status} value={status} style={{ background: 'var(--input-bg)' }}>
                      {status.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="h-9 w-full md:w-auto px-4 rounded-full transition-colors text-sm font-medium flex items-center justify-center gap-1.5"
                  style={showAdvancedFilters
                    ? { color: 'var(--accent-purple)', background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' }
                    : { color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                >
                  <ChevronRight className="h-3.5 w-3.5 transition-transform" style={{ transform: showAdvancedFilters ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                  Advanced
                </button>
                <button
                  onClick={() => setFilters({ status: undefined, category: undefined, type: undefined, brand: undefined, brand_code: undefined, vendorId: undefined, search: undefined, dateFrom: undefined, dateTo: undefined, agingBucket: undefined, urgentDue: undefined })}
                  disabled={activeFilterCount === 0}
                  className="h-9 w-full md:w-auto px-4 rounded-full transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  style={activeFilterCount > 0
                    ? { color: 'var(--accent-violet)', background: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)' }
                    : { color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { if (activeFilterCount > 0) { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-violet) 18%, transparent)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = activeFilterCount > 0 ? 'color-mix(in srgb, var(--accent-violet) 10%, transparent)' : 'transparent'; }}
                >
                  Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </button>
                <button
                  onClick={exportFilteredCSV}
                  disabled={sortedInvoices.length === 0}
                  className="h-9 w-full md:w-auto px-4 rounded-full transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  style={{ color: 'var(--accent-green)', background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-green) 18%, transparent)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-green) 10%, transparent)'; }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Excel{sortedInvoices.length > 0 ? ` (${sortedInvoices.length})` : ''}
                </button>
              </div>

              {/* Advanced filters — collapsible */}
              {showAdvancedFilters && (
                <div className="flex flex-col md:flex-row items-start md:items-center gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <select
                    value={filters.category || ''}
                    onChange={(e) => setFilters({ ...filters, category: e.target.value as InvoiceCategory | undefined })}
                    className="h-9 w-full md:w-auto px-4 rounded-full focus:outline-none text-sm appearance-none cursor-pointer transition-all" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>All Categories</option>
                    {Object.values(InvoiceCategory).map((category) => (
                      <option key={category} value={category} style={{ background: 'var(--input-bg)' }}>
                        {category.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filters.type || ''}
                    onChange={(e) => setFilters({ ...filters, type: e.target.value as InvoiceType | undefined })}
                    className="h-9 w-full md:w-auto px-4 rounded-full focus:outline-none text-sm appearance-none cursor-pointer transition-all" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>All Types</option>
                    {Object.values(InvoiceType).map((type) => (
                      <option key={type} value={type} style={{ background: 'var(--input-bg)' }}>{type}</option>
                    ))}
                  </select>
                  <select
                    value={filters.brand || ''}
                    onChange={(e) => setFilters({ ...filters, brand: e.target.value || undefined })}
                    className="h-9 w-full md:w-auto px-4 rounded-full focus:outline-none text-sm appearance-none cursor-pointer transition-all" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>All Brands</option>
                    <option value="Columbia Sportswear" style={{ background: 'var(--input-bg)' }}>Columbia Sportswear</option>
                    <option value="The North Face" style={{ background: 'var(--input-bg)' }}>The North Face</option>
                    <option value="Vans" style={{ background: 'var(--input-bg)' }}>Vans</option>
                    <option value="Arc'teryx" style={{ background: 'var(--input-bg)' }}>Arc'teryx</option>
                    <option value="Under Armour" style={{ background: 'var(--input-bg)' }}>Under Armour</option>
                    <option value="Helly Hansen" style={{ background: 'var(--input-bg)' }}>Helly Hansen</option>
                    <option value="Burton" style={{ background: 'var(--input-bg)' }}>Burton</option>
                    <option value="Travis Mathew" style={{ background: 'var(--input-bg)' }}>Travis Mathew</option>
                    <option value="Fjallraven" style={{ background: 'var(--input-bg)' }}>Fjallraven</option>
                    <option value="On Running" style={{ background: 'var(--input-bg)' }}>On Running</option>
                    <option value="Prana" style={{ background: 'var(--input-bg)' }}>Prana</option>
                    <option value="Other" style={{ background: 'var(--input-bg)' }}>Other brands</option>
                  </select>
                  <select
                    value={filters.vendorId || ''}
                    onChange={(e) => setFilters({ ...filters, vendorId: e.target.value || undefined })}
                    className="h-9 w-full md:w-auto px-4 rounded-full focus:outline-none text-sm appearance-none cursor-pointer transition-all"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', maxWidth: '220px' }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>All Vendors</option>
                    {vendorList.map((v) => (
                      <option key={v.id} value={v.id} style={{ background: 'var(--input-bg)' }}>{v.name}</option>
                    ))}
                  </select>
                  <select
                    value={filters.brand_code || ''}
                    onChange={(e) => setFilters({ ...filters, brand_code: e.target.value as string | undefined })}
                    className="h-9 w-full md:w-auto px-4 rounded-full focus:outline-none text-sm appearance-none cursor-pointer transition-all" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>All Brand Codes</option>
                    <option value="CSC" style={{ background: 'var(--input-bg)' }}>CSC</option>
                    <option value="TNF" style={{ background: 'var(--input-bg)' }}>TNF</option>
                    <option value="VNS" style={{ background: 'var(--input-bg)' }}>VNS</option>
                    <option value="ARC" style={{ background: 'var(--input-bg)' }}>ARC</option>
                    <option value="UA" style={{ background: 'var(--input-bg)' }}>UA</option>
                    <option value="HH" style={{ background: 'var(--input-bg)' }}>HH</option>
                    <option value="BUR" style={{ background: 'var(--input-bg)' }}>BUR</option>
                    <option value="TM" style={{ background: 'var(--input-bg)' }}>TM</option>
                    <option value="FR" style={{ background: 'var(--input-bg)' }}>FR</option>
                    <option value="ON" style={{ background: 'var(--input-bg)' }}>ON</option>
                  </select>
                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <input
                      type="date"
                      value={filters.dateFrom || ''}
                      onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value || undefined })}
                      className="h-9 px-3 rounded-full text-sm focus:outline-none"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      placeholder="From"
                    />
                    <span style={{ color: 'var(--text-subtle)' }}>-</span>
                    <input
                      type="date"
                      value={filters.dateTo || ''}
                      onChange={(e) => setFilters({ ...filters, dateTo: e.target.value || undefined })}
                      className="h-9 px-3 rounded-full text-sm focus:outline-none"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      placeholder="To"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Invoice Table — hidden from SUPERADMIN (system maintenance only) */}
          {user?.role !== 'SUPERADMIN' && (
          <div id="invoice-list-section" className="rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Invoice Repository
                {filters.agingBucket && (
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--accent-purple)' }}>
                    · {filters.agingBucket === 'current' ? 'Current (not yet due)' : filters.agingBucket === '1-30' ? '1–30 days overdue' : filters.agingBucket === '31-60' ? '31–60 days overdue' : '60+ days overdue'}
                  </span>
                )}
                {filters.urgentDue && (
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--accent-red)' }}>
                    · Urgent: Due within 7 days / overdue
                  </span>
                )}
              </h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{displayedInvoices.length} records</span>
            </div>
            <div data-invoice-table>
            <InvoiceTable
              invoices={displayedInvoices}
              onInvoiceClick={(inv) => { setDetailTab('overview'); setSelectedInvoice(inv); }}
              loading={loading}
              emptyHint={activeFilterCount > 0 ? 'filters' : 'default'}
            />
            
            {/* Pagination */}
            {sortedInvoices.length > 0 && (
              <div className="flex items-center justify-between py-4 px-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Showing {startIndex + 1}-{Math.min(endIndex, sortedInvoices.length)} of {sortedInvoices.length} invoices
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={safePage <= 1}
                    className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors text-sm font-medium"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    Previous
                  </button>
                  <span className="text-sm px-2" style={{ color: 'var(--text-muted)' }}>
                    Page {safePage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={safePage >= totalPages}
                    className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors text-sm font-medium"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
          )}

          {/* Supplier Balance Analysis - For ACCOUNTING roles */}
          {user && (user.role === 'ACCOUNTING_SUPERVISOR' || user.role === 'ACCOUNTING_ASSOCIATE') && (
            <div className="mt-6 rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Supplier balance</h2>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Received vs recorded — real-time gap analysis</p>
                </div>
                <Link to="/vendors" className="text-sm" style={{ color: 'var(--accent-purple)' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-lime)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}>View all vendors →</Link>
              </div>
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-6 space-y-4">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    ))}
                  </div>
                ) : (
                <table className="min-w-full animate-fade-in">
                  <thead style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <tr>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Vendor Name
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Invoices Received
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Invoices Recorded
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Gap
                      </th>
                      <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Total Outstanding (USD)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierBalance.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No vendor data available</td>
                      </tr>
                    ) : supplierBalance.map((vendor, i) => {
                      const gap = vendor.received - vendor.recorded;
                      return (
                        <tr key={i} className="transition-colors"
                          style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{vendor.name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{vendor.received}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{vendor.recorded}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {gap > 0 ? (
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                                <span className="text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent-red)' }}>{gap}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
                                <span className="text-sm" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent-lime)' }}>0</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>${vendor.outstanding.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          )}

          {/* Payables Aging - For ACCOUNTING roles */}
          {user && (user.role === 'ACCOUNTING_SUPERVISOR' || user.role === 'ACCOUNTING_ASSOCIATE') && (
            <div className="mt-6 rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Payables aging</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Outstanding invoices by age bucket</p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {loading ? (
                    [...Array(4)].map((_, i) => (
                      <div key={i} className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                        <Skeleton className="h-3 w-28 mb-3" />
                        <Skeleton className="h-7 w-12 mb-2" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))
                  ) : payablesAging.map((bucket, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl animate-fade-in-up"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', animationDelay: `${i * 60}ms` }}
                    >
                      <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>{bucket.label}</p>
                      <p className="text-2xl font-bold mb-1" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{bucket.count}</p>
                      <p className="text-sm" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>${bucket.amount.toLocaleString()}</p>
                      <button
                        className="mt-3 text-xs"
                        style={{ color: 'var(--accent-purple)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-lime)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}
                        onClick={() => {
                          const bucketMap = ['current', '1-30', '31-60', '60+'] as const;
                          setFilters({ ...filters, agingBucket: bucketMap[i] });
                          document.getElementById('invoice-list-section')?.scrollIntoView({ behavior: 'smooth' });
                        }}
                      >
                        View →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Processing Time per Stage - For ACCOUNTING and PURCHASING_MANAGER roles */}
          {user && (user.role === 'ACCOUNTING_SUPERVISOR' || user.role === 'ACCOUNTING_ASSOCIATE' || user.role === 'PURCHASING_MANAGER') && (
            <div className="mt-6 rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Processing time per stage</h2>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Average hours at each approval stage vs SLA target</p>
                </div>
                <div className="text-right">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>SLA compliance</p>
                  <p className="text-lg font-bold" style={{ color: slaCompliance >= 80 ? 'var(--accent-lime)' : slaCompliance >= 60 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>{slaCompliance}%</p>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {loading ? (
                    [...Array(5)].map((_, i) => <SkeletonBar key={i} />)
                  ) : processingTimePerStage.length === 0 ? (
                    <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>No stage data available yet</p>
                  ) : processingTimePerStage.map((item, i) => {
                    const percentage = item.sla > 0 ? (item.avg / item.sla) * 100 : 0;
                    const status = percentage < 80 ? '✓' : percentage < 100 ? '⚠' : '✗';
                    const barColor = percentage < 80 ? 'var(--accent-lime)' : percentage < 100 ? 'var(--accent-amber)' : 'var(--accent-red)';
                    return (
                      <div key={i} className="animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                          <div className="flex items-center gap-4">
                            <span className="text-sm" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{item.avg}h / {item.sla}h SLA</span>
                            <span className="text-lg font-bold" style={{ color: barColor }}>{status}</span>
                          </div>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
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

      {/* Mobile Bottom Tab Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 backdrop-blur-xl border-t z-50" style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-around py-2">
          <Link
            to="/"
            className="flex flex-col items-center px-4 py-2"
            style={{ color: 'var(--accent-purple)' }}
          >
            <LayoutDashboard className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs mt-1">Dashboard</span>
          </Link>
          <Link
            to="/approvals"
            className="flex flex-col items-center px-4 py-2"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <CheckSquare className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs mt-1">Approvals</span>
          </Link>
          <Link
            to="/exceptions"
            className="flex flex-col items-center px-4 py-2"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs mt-1">Exceptions</span>
          </Link>
          <Link
            to="/vendors"
            className="flex flex-col items-center px-4 py-2"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <Building2 className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs mt-1">Vendors</span>
          </Link>
          <button className="flex flex-col items-center px-4 py-2" style={{ color: 'var(--text-muted)' }}
            onClick={() => setMobileSidebarOpen(true)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
            <Menu className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs mt-1">More</span>
          </button>
        </div>
      </div>

      {/* Invoice Detail Panel */}
      {selectedInvoice && (
        <div className="fixed right-0 top-0 h-full w-full sm:w-[560px] lg:w-[640px] flex flex-col z-50 animate-slide-in-right" style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          {/* Panel Header — Invoice number + status + close */}
          <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}>
                  <FileText className="h-5 w-5 text-white" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</h3>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{selectedInvoice.vendor?.name} · {selectedInvoice.currency} {Number(selectedInvoice.total_amount).toFixed(2)}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="p-2 rounded-xl transition-colors flex-shrink-0"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            {/* Status badge + Tab navigation */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
                {selectedInvoice.status.replace(/_/g, ' ')}
              </span>
              <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                {(['overview', 'pipeline', 'validation', 'actions', 'audit'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize"
                    style={detailTab === tab
                      ? { background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                      : { color: 'var(--text-muted)' }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tab Content — scrollable */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Overview Tab */}
            {detailTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Number</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.vendor?.name}</p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Amount</p>
                  <p className="text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                    {selectedInvoice.currency} {Number(selectedInvoice.total_amount).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Status</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.status.replace(/_/g, ' ')}</p>
                </div>
              </div>

              {(selectedInvoice as any).ocr_confidence_score !== undefined && (selectedInvoice as any).ocr_confidence_score !== null && (
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>OCR Confidence</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.round(Number((selectedInvoice as any).ocr_confidence_score) * 100)}%`, backgroundColor: Number((selectedInvoice as any).ocr_confidence_score) >= 0.9 ? 'var(--accent-lime)' : 'var(--accent-amber)' }}
                      />
                    </div>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {Math.round(Number((selectedInvoice as any).ocr_confidence_score) * 100)}%
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Payment Terms</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.payment_terms}</p>
                </div>
                {selectedInvoice.incoterm && (
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Incoterm</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.incoterm}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Bill To</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.bill_to_entity}</p>
                </div>
              </div>

              {/* Scheduled Payment Date — visible to all users */}
              {(() => {
                const payments = (selectedInvoice as any).payments;
                const scheduledPayment = Array.isArray(payments) ? payments.find((p: any) => p.status === 'SCHEDULED' || p.status === 'PAID') : null;
                if (!scheduledPayment) return null;
                const payDate = new Date(scheduledPayment.payment_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                const isPaid = scheduledPayment.status === 'PAID';
                return (
                  <div
                    className="p-3 rounded-xl"
                    style={{
                      background: isPaid
                        ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)'
                        : 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
                      border: `1px solid color-mix(in srgb, ${isPaid ? 'var(--accent-lime)' : 'var(--accent-purple)'} 20%, transparent)`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold" style={{ color: isPaid ? 'var(--accent-lime)' : 'var(--accent-purple)' }}>
                          {isPaid ? '✓ Payment Executed' : '🗓 Payment Scheduled'}
                        </p>
                        <p className="text-sm mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                          {isPaid ? 'Paid on' : 'Scheduled for'}: {payDate}
                        </p>
                        {scheduledPayment.reference && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Ref: {scheduledPayment.reference}</p>
                        )}
                        {scheduledPayment.bank_used && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Bank: {scheduledPayment.bank_used}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold" style={{ color: isPaid ? 'var(--accent-lime)' : 'var(--accent-purple)' }}>
                          {scheduledPayment.currency} {Number(scheduledPayment.amount).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Batch Threshold Indicator */}
              {selectedInvoice.status === (InvoiceStatus.ON_HOLD as any) && (
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)',
                  }}
                >
                  <p className="text-xs font-medium" style={{ color: 'var(--accent-amber)' }}>On Hold — Batch Threshold</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Held until vendor cumulative reaches $100. Another invoice for this vendor will release this batch.
                  </p>
                </div>
              )}

              {/* MPO & Line Validation */}
              {selectedInvoice.mpo_number && (
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <FileSearch className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />
                    MPO & Line Validation
                  </p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>MPO Number</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.mpo_number}</p>
                    </div>
                    {selectedInvoice.qty_shipped !== undefined && (
                      <div>
                        <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Qty Shipped</p>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.qty_shipped}</p>
                      </div>
                    )}
                  </div>
                  {selectedInvoice.po_validation && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>PO Found:</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={selectedInvoice.po_validation.po_found
                          ? { background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)', color: 'var(--accent-lime)' }
                          : { background: 'color-mix(in srgb, var(--accent-red) 15%, transparent)', color: 'var(--accent-red)' }}>
                          {selectedInvoice.po_validation.po_found ? 'Yes' : 'No'}
                        </span>
                        {selectedInvoice.po_validation.skipped && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-amber) 15%, transparent)', color: 'var(--accent-amber)' }}>Skipped</span>
                        )}
                      </div>
                      {selectedInvoice.po_validation.comparison && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {[
                            { label: 'Vendor', key: 'vendor_match' },
                            { label: 'Amount', key: 'amount_match' },
                            { label: 'Brand', key: 'brand_match' },
                            { label: 'Season', key: 'season_match' },
                            { label: 'Order Type', key: 'order_type_match' },
                            { label: 'Currency', key: 'currency_match' },
                          ].map(({ label, key }) => {
                            const val = (selectedInvoice.po_validation!.comparison as any)[key];
                            if (val === undefined || val === null) return null;
                            return (
                              <div key={key} className="flex items-center gap-1.5 text-xs">
                                <span style={{ color: val ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{val ? '✓' : '✗'}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {selectedInvoice.po_validation.comparison?.amount_variance_percent !== undefined && (
                        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          Amount Variance: <span style={{ color: Math.abs(selectedInvoice.po_validation.comparison.amount_variance_percent) > 5 ? 'var(--accent-red)' : 'var(--accent-lime)', fontWeight: 600 }}>
                            {selectedInvoice.po_validation.comparison.amount_variance_percent.toFixed(1)}%
                          </span>
                        </div>
                      )}
                      {selectedInvoice.po_validation.comparison?.differences && selectedInvoice.po_validation.comparison.differences.length > 0 && (
                        <div className="mt-2 p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)' }}>
                          {selectedInvoice.po_validation.comparison.differences.map((diff: string, i: number) => (
                            <p key={i} className="text-xs" style={{ color: 'var(--accent-red)' }}>• {diff}</p>
                          ))}
                        </div>
                      )}
                      {selectedInvoice.po_validation.message && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{selectedInvoice.po_validation.message}</p>
                      )}
                    </div>
                  )}
                  {/* OCR Line Items */}
                  {selectedInvoice.ocr_raw_data?.extraction?.line_items && Array.isArray(selectedInvoice.ocr_raw_data.extraction.line_items) && selectedInvoice.ocr_raw_data.extraction.line_items.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Extracted Line Items ({selectedInvoice.ocr_raw_data.extraction.line_items.length})</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {selectedInvoice.ocr_raw_data.extraction.line_items.map((line: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                            <div className="flex-1 min-w-0">
                              <span style={{ color: 'var(--text-primary)' }}>{line.material_name || line.description || line.item_code || `Line ${i + 1}`}</span>
                              {line.material_code && <span className="ml-2" style={{ color: 'var(--text-muted)' }}>({line.material_code})</span>}
                            </div>
                            <div className="flex items-center gap-3 ml-2">
                              <span style={{ color: 'var(--text-muted)' }}>Qty: {line.quantity || '—'}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>${Number(line.total_amount || line.extended_price || 0).toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* NextGen Real-time Validation */}
              {(() => {
                const ng = nextgenResults[selectedInvoice.id];
                if (!ng || ng.status === 'loading') return (
                  <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                      Validating against NextGen in real-time...
                    </div>
                  </div>
                );
                if (ng.status === 'no-mpo') return (
                  <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--text-muted) 8%, transparent)', border: '1px solid var(--border-color)' }}>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>No MPO reference — NextGen real-time validation skipped</span>
                  </div>
                );
                if (ng.status === 'error') return (
                  <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                    <span className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>NextGen unavailable — real-time check skipped</span>
                  </div>
                );
                if (ng.status === 'matched') return (
                  <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }}>
                    <div className="flex items-center">
                      <CheckCircle className="h-5 w-5 mr-2" style={{ color: 'var(--accent-green)' }} strokeWidth={1.75} />
                      <span className="text-sm font-medium" style={{ color: 'var(--accent-green)' }}>Invoice matches NextGen PO data (real-time check)</span>
                    </div>
                  </div>
                );
                if (ng.status === 'mismatch') return (
                  <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                    <div className="flex items-center mb-2">
                      <XCircle className="h-5 w-5 mr-2" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                      <span className="text-sm font-medium" style={{ color: 'var(--accent-red)' }}>NextGen mismatches detected (real-time check)</span>
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {(ng.criticalChanges || []).map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.field.replace(/_/g, ' ')}</span>
                          <span>Invoice: {String(c.old)} → NextGen: {String(c.new)}</span>
                        </div>
                      ))}
                      {(ng.changes || []).filter((c: any) => !(ng.criticalChanges || []).some((cc: any) => cc.field === c.field)).map((c: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span>{c.field.replace(/_/g, ' ')}</span>
                          <span>{String(c.old)} → {String(c.new)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
                return null;
              })()}

              {/* Bank Details Change Requests */}
              {invoiceBankRequests.length > 0 && (
                <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-blue) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}>
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Landmark className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />
                    Bank Details Change Requests ({invoiceBankRequests.length})
                  </p>
                  <div className="space-y-2">
                    {invoiceBankRequests.map((req: any) => (
                      <div key={req.id} className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }}>
                            {req.field === 'beneficiary_name' ? 'Beneficiary Name' : req.field === 'bank_name' ? 'Bank Name' : req.field === 'swift_code' ? 'SWIFT Code' : req.field === 'account_number' ? 'Account Number' : req.field}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {new Date(req.created_at).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div>
                            <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Current</p>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{req.current_value || '—'}</p>
                          </div>
                          <div>
                            <p className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Requested</p>
                            <p className="text-xs font-medium" style={{ color: 'var(--accent-lime)' }}>{req.requested_value || '—'}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span style={{ color: 'var(--text-muted)' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{req.reason}</span>
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>by {req.requested_by}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Edit History — quick access */}
              {selectedInvoice.audit_logs && selectedInvoice.audit_logs.filter((log: any) => log.action === 'INVOICE_UPDATED').length > 0 && (
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      <Edit className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
                      Edit History
                    </p>
                    <button
                      onClick={() => setDetailTab('audit')}
                      className="text-xs font-medium transition-colors"
                      style={{ color: 'var(--accent-blue)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      View Full Audit →
                    </button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedInvoice.audit_logs
                      .filter((log: any) => log.action === 'INVOICE_UPDATED')
                      .slice(-5)
                      .reverse()
                      .map((log: any) => (
                        <div key={log.id} className="p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{getAuditActorDisplay(log.performed_by, log.note)}</span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {log.note && (
                            <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                              {log.note.split('\n').map((line: string, i: number) => (
                                <span key={i}>{i === 0 ? line : <><br />{line}</>}</span>
                              ))}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Exceptions summary in overview */}
              {selectedInvoice.exceptions && selectedInvoice.exceptions.length > 0 && (() => {
                const activeExcs = selectedInvoice.exceptions.filter((exc) => exc.status === 'OPEN' || exc.status === 'PENDING');
                const resolvedExcs = selectedInvoice.exceptions.filter((exc) => exc.status === 'RESOLVED' || exc.status === 'WAIVED');
                const hasActive = activeExcs.length > 0;
                const accentVar = hasActive ? 'var(--accent-red)' : 'var(--accent-lime)';
                return (
                <div className="p-4 rounded-xl" style={{ background: `color-mix(in srgb, ${accentVar} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${accentVar} 20%, transparent)` }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: accentVar }}>Exceptions</p>
                  {activeExcs.map((exc) => (
                    <p key={exc.id} className="text-xs" style={{ color: 'var(--accent-red)' }}>
                      {exc.reason}: {exc.detail}
                    </p>
                  ))}
                  {resolvedExcs.map((exc) => (
                    <p key={exc.id} className="text-xs flex items-center gap-1" style={{ color: 'var(--accent-lime)' }}>
                      <CheckCircle className="h-3 w-3" strokeWidth={1.75} />
                      <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{exc.reason}: {exc.detail}</span>
                      <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)' }}>{exc.status}</span>
                    </p>
                  ))}
                </div>
                );
              })()}

              

              

              {/* Payment Confirmation Sent — read-only label */}
              {selectedInvoice.status === (InvoiceStatus.PAYMENT_CONFIRMATION_SENT as any) && (selectedInvoice as any).confirmation_sent_at && (
                <div className="p-3 rounded-xl text-xs" style={{ background: 'color-mix(in srgb, var(--accent-lime) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-lime) 20%, transparent)' }}>
                  <div className="flex items-center gap-2" style={{ color: 'var(--accent-lime)' }}>
                    <CheckCircle className="h-4 w-4" strokeWidth={1.75} />
                    <span className="font-medium">Confirmation Sent</span>
                  </div>
                  <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Sent on {new Date((selectedInvoice as any).confirmation_sent_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })} to {selectedInvoice.vendor?.name}
                    <br />CC: PURCHASINGTEAM@madison88.com
                  </p>
                </div>
              )}
            </div>
            )}

            {/* Pipeline Tab */}
            {detailTab === 'pipeline' && (
            <PipelineTracker invoice={selectedInvoice} />
            )}

            {/* Actions Tab */}
            {detailTab === 'actions' && (
            <div className="space-y-3">
              {/* View Actual Invoice PDF — always available when an invoice is selected */}
              <button
                onClick={() => void openInvoicePdf(selectedInvoice)}
                disabled={openingDocument}
                className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                style={openingDocument ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
              >
                {openingDocument ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Eye className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                {openingDocument ? 'Opening PDF...' : 'View Actual Invoice PDF'}
              </button>

              {/* Replace / Re-link PDF — lets users fix wrong PDF associations */}
              <input
                ref={replacePdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => void handleReplacePdf(e)}
                className="hidden"
              />
              <button
                onClick={() => replacePdfInputRef.current?.click()}
                disabled={replacingPdf}
                className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                style={replacingPdf ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                {replacingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Upload className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                {replacingPdf ? 'Replacing PDF...' : 'Replace / Re-link PDF'}
              </button>

              {/* Edit Invoice Button — shown if user can edit invoice OR edit bank details */}
              {user && (hasPermission(user.role, 'canEditInvoice') || hasPermission(user.role, 'canEditBankDetails')) && (
                <button
                  onClick={handleOpenEdit}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-purple)'; }}
                >
                  <Edit className="h-4 w-4 mr-2" strokeWidth={1.75} />
                  {hasPermission(user.role, 'canEditInvoice') ? 'Edit Invoice' : 'Invoice Details'}
                </button>
              )}

              {/* Check NextGen Changes Button */}
              {selectedInvoice.mpo_number && user && ['PURCHASING_COORDINATOR', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role) && (
                <button
                  onClick={handleCheckNextGen}
                  disabled={posting}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={posting ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
                >
                  {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <FileSearch className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {posting ? 'Checking...' : 'Check NextGen Changes'}
                </button>
              )}

              {/* Validation Button */}
              {(selectedInvoice.status === (InvoiceStatus.RECEIVED as any) ||
                selectedInvoice.status === (InvoiceStatus.VALIDATION_PENDING as any) ||
                selectedInvoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any)) && user && hasPermission(user.role, 'canValidate') && (
                <button
                  onClick={handleValidate}
                  disabled={validating}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={validating ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-purple)', color: 'var(--text-inverse)', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}
                >
                  {validating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Shield className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {validating ? 'Validating...' : (selectedInvoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any) || selectedInvoice.status === (InvoiceStatus.ON_HOLD as any) ? 'Re-Validate' : selectedInvoice.status === (InvoiceStatus.RECEIVED as any) ? 'Process & Validate' : 'Run Validation')}
                </button>
              )}

              {/* Resolve Exceptions Button */}
              {selectedInvoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any) && user && ['PURCHASING_COORDINATOR', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role) && (
                <button
                  onClick={() => navigate('/exceptions', { state: { selectedInvoiceId: selectedInvoice.id } })}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl hover:opacity-80 transition-all font-medium text-sm"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
                    color: 'var(--accent-amber)',
                    border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)',
                  }}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                  Resolve Exceptions
                </button>
              )}

              {/* Request Approval Button — for invoices in VALIDATION_PENDING that need manual approval trigger */}
              {selectedInvoice.status === (InvoiceStatus.VALIDATION_PENDING as any) && user && hasPermission(user.role, 'canRequestApproval') && (
                <button
                  onClick={handleRequestApproval}
                  disabled={requestingApproval}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={requestingApproval ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-violet)', color: 'var(--text-inverse)', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-violet) 25%, transparent)' }}
                >
                  {requestingApproval ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Send className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {requestingApproval ? 'Requesting...' : 'Request Approval'}
                </button>
              )}

              {/* Approval Actions — only for invoices in a pending approval stage (not PENDING_ACCOUNTING which is a posting stage) */}
              {selectedInvoice.status && user && canUserApproveStatus(user.role, String(selectedInvoice.status)) &&
                String(selectedInvoice.status).startsWith('PENDING_') &&
                String(selectedInvoice.status) !== 'PENDING_ACCOUNTING' &&
                (!selectedInvoice.current_stage ||
                  selectedInvoice.current_stage === user.role ||
                  (selectedInvoice.current_stage === 'COORDINATOR' && user.role === 'PURCHASING_COORDINATOR') ||
                  (selectedInvoice.current_stage === 'MLO_PLANNING_MANAGER' && (user.role === 'PLANNING_MANAGER' || user.role === 'MLO_ACCOUNT_HOLDER' || user.role === 'MLO_PLANNING_MANAGER')) ||
                  (selectedInvoice.current_stage === 'ACCOUNTING_REVIEWER' && (user.role === 'ACCOUNTING_ASSOCIATE' || user.role === 'ACCOUNTING_SUPERVISOR' || user.role === 'PRESIDENT'))
                ) && (
                <div className="space-y-2">
                  {hasPermission(user.role, 'canApprove') && (
                    <button
                      onClick={() => handleApprove(selectedInvoice.id)}
                      className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-semibold text-sm"
                      style={{
                        background: 'var(--accent-lime)',
                        color: 'var(--text-inverse)',
                        boxShadow: '0 0 16px color-mix(in srgb, var(--accent-lime) 25%, transparent)',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-lime-hover)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-lime)'; }}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                      Approve
                    </button>
                  )}
                  {hasPermission(user.role, 'canReject') && (
                    <button
                      onClick={() => setShowRejectModal(true)}
                      className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                      style={{
                        background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                        color: 'var(--accent-red)',
                        border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                    >
                      <XCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                      Reject
                    </button>
                  )}
                  {user.role !== 'PURCHASING_COORDINATOR' && (
                    <button onClick={() => setShowReturnModal(true)} className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl font-medium text-sm" style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)' }}>
                      Return to Previous Approver
                    </button>
                  )}
                  {['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'SUPERADMIN', 'ADMIN'].includes(user?.role || '') && (
                    <button
                      onClick={() => setShowDeleteModal(true)}
                      className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                      style={{
                        background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)',
                        color: 'var(--accent-red)',
                        border: '1px solid color-mix(in srgb, var(--accent-red) 15%, transparent)',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-red) 15%, transparent)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-red) 8%, transparent)'; }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" strokeWidth={1.75} />
                      Delete Invoice
                    </button>
                  )}
                </div>
              )}

              {/* Reject from Accounting — Accounting can reject invoice from PENDING_ACCOUNTING stage */}
              {selectedInvoice.status === InvoiceStatus.PENDING_ACCOUNTING && user &&
                ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'].includes(user.role) &&
                hasPermission(user.role, 'canReject') && (
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                    color: 'var(--accent-red)',
                    border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                >
                  <XCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                  Reject & Return to Approver
                </button>
              )}

              {/* Posting Actions */}
              {(selectedInvoice.status === InvoiceStatus.APPROVED || selectedInvoice.status === InvoiceStatus.PENDING_ACCOUNTING) && user && hasPermission(user.role, 'canPost') && (
                <>
                  {user.role === 'ACCOUNTING_SUPERVISOR' && (
                    <label className="flex items-center gap-2 px-4 py-2 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                      <input
                        type="checkbox"
                        checked={bypassVarianceCheck}
                        onChange={(e) => setBypassVarianceCheck(e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      Bypass variance check (override PO amount mismatch)
                    </label>
                  )}
                  <button
                    onClick={() => handlePost(bypassVarianceCheck)}
                    disabled={posting}
                    className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                    style={posting ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-purple)', color: 'var(--text-inverse)', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}
                  >
                  {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Send className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {posting ? 'Posting...' : 'Post to Accounting'}
                  </button>
                </>
              )}

              {/* Release Hold — for invoices held at pre-post check (have signatures, held during posting) */}
              {selectedInvoice.status === (InvoiceStatus.ON_HOLD as any) && user && hasPermission(user.role, 'canPost') && selectedInvoice.signatures && selectedInvoice.signatures.some(s => s.signed_at) && (
                <button
                  onClick={handleReleaseHold}
                  disabled={posting}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={posting ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-amber)', color: 'var(--text-inverse)' }}
                >
                  {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Unlock className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {posting ? 'Releasing...' : 'Release from Hold'}
                </button>
              )}

              {/* Hold for Batch Threshold — Accounting can manually hold invoices below $100 vendor cumulative */}
              {selectedInvoice.status === (InvoiceStatus.PENDING_ACCOUNTING as any) &&
                user && hasPermission(user.role, 'canHoldInvoice') && (
                <button
                  onClick={handleHoldForBatchThreshold}
                  disabled={holdingInvoice}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={holdingInvoice ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'color-mix(in srgb, var(--accent-amber) 15%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 25%, transparent)' }}
                >
                  {holdingInvoice ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Pause className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {holdingInvoice ? 'Holding...' : 'Hold for Batch Threshold'}
                </button>
              )}

              {/* Send Payment Confirmation — only for PAID invoices, only Accounting roles */}
              {selectedInvoice.status === (InvoiceStatus.PAID as any) && user && user.role === 'ACCOUNTING_SUPERVISOR' && (
                <button
                  onClick={() => setShowConfirmSendModal(true)}
                  disabled={sendingConfirmation}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={sendingConfirmation
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-lime)', color: 'var(--text-inverse)', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-lime) 25%, transparent)' }
                  }
                >
                  {sendingConfirmation ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Send className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                  {sendingConfirmation ? 'Sending...' : 'Send Payment Confirmation'}
                </button>
              )}

              {/* No actions available */}
              {!user?.role || (user.role === 'MS_POLLY') && (
                <div className="text-center py-8">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No actions available for your role</p>
                </div>
              )}
            </div>
            )}

            {/* Validation Tab */}
            {detailTab === 'validation' && (
            <div className="space-y-4">
              {validationResult && (
                <div className={`mt-4 p-4 rounded-lg border`} style={{ background: (validationResult.passed || validationResult.allExceptionsHandled) ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)' : 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: `1px solid ${(validationResult.passed || validationResult.allExceptionsHandled) ? 'color-mix(in srgb, var(--accent-lime) 20%, transparent)' : 'color-mix(in srgb, var(--accent-red) 20%, transparent)'}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold" style={{ color: (validationResult.passed || validationResult.allExceptionsHandled) ? 'var(--accent-lime)' : 'var(--accent-red)' }}>
                      {validationResult.passed ? '✓ Validation Passed' : validationResult.allExceptionsHandled ? '✓ Validation Passed — All Exceptions Resolved/Waived' : '✗ Validation Failed'}
                    </p>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {validationResult.results.filter((r: any) => r.passed).length}/{validationResult.results.length} rules passed
                    </span>
                  </div>
                  {validationResult.allExceptionsHandled && !validationResult.passed && (
                    <div className="mb-3 p-2 rounded-lg text-xs" style={{ background: 'color-mix(in srgb, var(--accent-lime) 8%, transparent)', color: 'var(--accent-lime)' }}>
                      All failing rules were previously resolved or waived by a coordinator. The invoice has been advanced to the approval workflow.
                    </div>
                  )}

                  {/* Rule Categories */}
                  <div className="space-y-3">
                    {/* Vendor Rules */}
                    <div>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(0, 1).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className="mr-2" style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.passed ? '✓' : '✗'}</span>
                            <span style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Invoice Data Rules */}
                    <div>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Data</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(1, 8).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className="mr-2" style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.passed ? '✓' : '✗'}</span>
                            <span style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bank Details */}
                    <div>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bank Details</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(8, 9).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className="mr-2" style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.passed ? '✓' : '✗'}</span>
                            <span style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Signatures */}
                    <div>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Signatures</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(9, 10).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className="mr-2" style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.passed ? '✓' : '✗'}</span>
                            <span style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* NextGen MPO Cross-Check - Highlighted */}
                    <div className={`p-2 rounded border`} style={{ background: validationResult.results[16]?.passed ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)' : 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: `1px solid ${validationResult.results[16]?.passed ? 'color-mix(in srgb, var(--accent-lime) 20%, transparent)' : 'color-mix(in srgb, var(--accent-red) 20%, transparent)'}` }}>
                      <p className="text-xs font-medium mb-1 flex items-center" style={{ color: 'var(--text-muted)' }}>
                        <span className="mr-1">🔗</span> NextGen MPO Cross-Check
                      </p>
                      <div className="space-y-1">
                        {validationResult.results.slice(16, 17).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className="mr-2" style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.passed ? '✓' : '✗'}</span>
                            <span style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.message}</span>
                          </div>
                        ))}
                        {validationResult.results[16]?.detail && (
                          <p className="text-xs mt-1 pl-4" style={{ color: 'var(--text-muted)' }}>{validationResult.results[16].detail}</p>
                        )}
                      </div>
                    </div>

                    {/* Compliance Rules */}
                    <div>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Compliance</p>
                      <div className="space-y-1">
                        {validationResult.results.slice(10, 16).map((result: any, idx: number) => (
                          <div key={idx} className="flex items-start text-xs">
                            <span className="mr-2" style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.passed ? '✓' : '✗'}</span>
                            <span style={{ color: result.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{result.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedInvoice.exceptions && selectedInvoice.exceptions.length > 0 && (() => {
                const activeExcs = selectedInvoice.exceptions.filter((exc) => exc.status === 'OPEN' || exc.status === 'PENDING');
                const resolvedExcs = selectedInvoice.exceptions.filter((exc) => exc.status === 'RESOLVED' || exc.status === 'WAIVED');
                const hasActive = activeExcs.length > 0;
                const accentVar = hasActive ? 'var(--accent-red)' : 'var(--accent-lime)';
                const canHandleException = user && ['PURCHASING_COORDINATOR', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role);
                return (
                <div className="mt-4 p-4 rounded-lg" style={{ background: `color-mix(in srgb, ${accentVar} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${accentVar} 20%, transparent)` }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: accentVar }}>Exceptions</p>
                  {activeExcs.map((exc) => (
                    <div key={exc.id} className="mb-2 last:mb-0">
                      <p className="text-xs" style={{ color: 'var(--accent-red)' }}>
                        {exc.reason}: {exc.detail}
                      </p>
                      {canHandleException && (
                        <div className="flex gap-2 mt-1">
                          <button
                            onClick={() => handleResolveException(exc.id)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                            style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                          >
                            <CheckCircle className="h-3 w-3" strokeWidth={2} />
                            Resolve
                          </button>
                          <button
                            onClick={() => handleWaiveException(exc.id)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                            style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}
                          >
                            <XCircle className="h-3 w-3" strokeWidth={2} />
                            Waive
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {resolvedExcs.map((exc) => (
                    <p key={exc.id} className="text-xs flex items-center gap-1" style={{ color: 'var(--accent-lime)' }}>
                      <CheckCircle className="h-3 w-3" strokeWidth={1.75} />
                      <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{exc.reason}: {exc.detail}</span>
                      <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)' }}>{exc.status}</span>
                    </p>
                  ))}
                </div>
                );
              })()}

              {!validationResult && (
                <div className="text-center py-8">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No validation results yet</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Run validation to see detailed rule results</p>
                </div>
              )}
            </div>
            )}

            {/* Audit Tab */}
            {detailTab === 'audit' && (
            <div>
              <AuditLogViewer invoiceId={selectedInvoice.id} />
            </div>
            )}
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-2 sm:mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Reject Invoice
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim()}
                  className="px-4 py-2 rounded-xl transition-colors text-sm font-medium"
                  style={!rejectReason.trim() ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-red)', color: 'var(--text-inverse)' }}
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Return to Previous Approver Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-2 sm:mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Return to Previous Approver
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                This will send the invoice back to the previous approver for corrections. Please provide a reason.
              </p>
              <textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Reason for returning this invoice..."
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                rows={4}
                autoFocus
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => { setShowReturnModal(false); setReturnReason(''); }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReturnForCorrection}
                  disabled={!returnReason.trim()}
                  className="px-4 py-2 rounded-xl transition-colors text-sm font-medium"
                  style={!returnReason.trim() ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                >
                  Return Invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedInvoice && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-2 sm:mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2.5 rounded-xl flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)' }}>
                  <AlertTriangle className="h-5 w-5" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Delete Invoice
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                    Are you sure you want to delete invoice <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</span>? This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteInvoice}
                  className="px-4 py-2 rounded-xl transition-colors text-sm font-medium"
                  style={{ background: 'var(--accent-red)', color: 'white' }}
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Payment Confirmation Modal */}
      {showConfirmSendModal && selectedInvoice && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-2 sm:mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                Send Payment Confirmation
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {selectedInvoice.vendor?.contact_email ? (
                  <>
                    Send payment confirmation to <strong>{selectedInvoice.vendor?.name}</strong> at <strong>{selectedInvoice.vendor.contact_email}</strong>?
                    <br /><br />
                    This will also CC <strong>PURCHASINGTEAM@madison88.com</strong> for visibility.
                  </>
                ) : (
                  <>
                    Mark payment confirmation as sent for <strong>{selectedInvoice.vendor?.name}</strong>?
                    <br /><br />
                    <span style={{ color: 'var(--accent-amber)' }}>No vendor email on file — email will be skipped. Invoice will be marked as confirmation sent for tracking purposes.</span>
                  </>
                )}
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowConfirmSendModal(false)}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendPaymentConfirmation}
                  disabled={sendingConfirmation}
                  className="px-4 py-2 rounded-xl transition-colors text-sm font-medium flex items-center gap-2"
                  style={sendingConfirmation
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-lime)', color: 'var(--text-inverse)' }
                  }
                >
                  {sendingConfirmation && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
                  {sendingConfirmation ? 'Sending...' : 'Confirm & Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {showEditModal && selectedInvoice && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-2xl w-full mx-2 sm:mx-4 max-h-[90vh] overflow-y-auto rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Edit Invoice
              </h3>

              {([
                { title: 'Basic Information', fields: [
                  { label: 'Vendor', field: 'vendor_id', type: 'select', required: true, options: [
                    { value: '', label: '— Select vendor —' },
                    ...vendorList.map((vendor) => ({ value: vendor.id, label: vendor.name })),
                  ] },
                  { label: 'Or enter a new vendor name', field: 'new_vendor_name', type: 'text' },
                  { label: 'Invoice Number', field: 'invoice_number', type: 'text', required: true },
                  { label: 'Invoice Date', field: 'invoice_date', type: 'date', required: true },
                  { label: 'Due Date', field: 'due_date', type: 'date', required: true },
                  { label: 'Amount', field: 'total_amount', type: 'number', required: true },
                  { label: 'Currency', field: 'currency', type: 'select', required: true, options: [
                    { value: '', label: '— Select —' },
                    { value: 'USD', label: 'USD — US Dollar' },
                    { value: 'HKD', label: 'HKD — Hong Kong Dollar' },
                    { value: 'IDR', label: 'IDR — Indonesian Rupiah' },
                  ] },
                  { label: 'Document Type', field: 'invoice_type', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'INVOICE', label: 'Invoice' },
                    { value: 'PROFORMA', label: 'Proforma' },
                    { value: 'COMMERCIAL', label: 'Commercial Invoice' },
                    { value: 'SALES', label: 'Sales Invoice' },
                    { value: 'STATEMENT', label: 'Statement' },
                    { value: 'PREPAID', label: 'Prepaid' },
                    { value: 'PROTO_SAMPLE', label: 'Proto Sample' },
                  ] },
                  { label: 'Payment Terms', field: 'payment_terms', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    ...paymentTermsOptions.map((t: string) => ({ value: t, label: t })),
                    ...((editFormData.payment_terms && !paymentTermsOptions.includes(editFormData.payment_terms))
                      ? [{ value: editFormData.payment_terms, label: editFormData.payment_terms + ' (current)' }]
                      : []),
                  ] },
                  { label: 'Incoterm', field: 'incoterm', type: 'text' },
                ]},
                { title: 'Classification', fields: [
                  { label: 'Brand', field: 'brand', type: 'text', required: true },
                  { label: 'Brand Tier', field: 'brand_tier', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'TOP_10', label: 'Top 10' },
                    { value: 'OTHER', label: 'Other' },
                  ] },
                  { label: 'Season', field: 'season', type: 'text', required: true },
                  { label: 'Order Type', field: 'order_type', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'BULK', label: 'Bulk' },
                    { value: 'SMS', label: 'SMS' },
                    { value: 'SAMPLE', label: 'Sample' },
                  ] },
                  { label: 'Category', field: 'category', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'TRIMS', label: 'Trims' },
                    { value: 'YARN', label: 'Yarn' },
                    { value: 'SAMPLE_CHARGES', label: 'Sample Charges' },
                    { value: 'SHIPPING_FREIGHT', label: 'Shipping / Freight' },
                    { value: 'LAB_TESTING', label: 'Lab Testing' },
                    { value: 'FACTORY', label: 'Factory' },
                    { value: 'FACTORY_AUDIT', label: 'Factory Audit' },
                    { value: 'PROFESSIONAL_FEE', label: 'Professional Fee' },
                    { value: 'SMS', label: 'SMS' },
                    { value: 'CONSULTATION', label: 'Consultation' },
                    { value: 'OTHER', label: 'Other' },
                  ] },
                  { label: 'Bill To Entity', field: 'bill_to_entity', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'MADISON_88_LTD', label: 'Madison 88 Ltd' },
                    { value: 'MADISON_88_HK_LIMITED', label: 'Madison 88 HK Limited' },
                  ] },
                ]},
                { title: 'PO & Material', fields: [
                  { label: 'PO Number', field: 'customer_po_number', type: 'text', required: true },
                  { label: 'MPO Number', field: 'mpo_number', type: 'text' },
                  { label: 'Base MPO', field: 'mpo_base_number', type: 'text', required: true },
                  { label: 'Order Sequence', field: 'mpo_order_sequence', type: 'text' },
                  { label: 'Material Code', field: 'material_code', type: 'text' },
                  { label: 'Material Name', field: 'material_name', type: 'text' },
                  { label: 'QTY SHIPPED', field: 'qty_shipped', type: 'number' },
                ]},
                { title: 'Financial Details', fields: [
                  { label: 'Subtotal', field: 'subtotal', type: 'number' },
                  { label: 'Tax Amount', field: 'tax_amount', type: 'number' },
                  { label: 'Discount', field: 'discount_amount', type: 'number' },
                  { label: 'Bank Charges', field: 'bank_charges', type: 'number' },
                  { label: 'Freight Charges', field: 'freight_charges', type: 'number' },
                  { label: 'Additional Charges', field: 'additional_charges', type: 'number' },
                  { label: 'Exchange Rate', field: 'exchange_rate_to_usd', type: 'number' },
                  { label: 'Original Currency', field: 'invoice_currency_original', type: 'text' },
                ]},
                { title: 'Bank Details', fields: [
                  { label: 'Beneficiary Name', field: 'beneficiary_name', type: 'text' },
                  { label: 'Bank Name', field: 'bank_name', type: 'text' },
                  { label: 'SWIFT Code', field: 'swift_code', type: 'text' },
                  { label: 'Account Number', field: 'account_number', type: 'text' },
                ]},
                { title: 'Shipping & Dates', fields: [
                  { label: 'Ship To', field: 'ship_to', type: 'text' },
                  { label: 'Sold To', field: 'sold_to', type: 'text' },
                  { label: 'Date Range Start', field: 'date_range_start', type: 'date' },
                  { label: 'Date Range End', field: 'date_range_end', type: 'date' },
                  { label: 'Priority Pay Date', field: 'priority_pay_date', type: 'date' },
                ]},
              ] as any[]).map((section) => {
                const isCollapsed = editCollapsed[section.title];
                const isBankSection = section.title === 'Bank Details';
                const canEditBank = user ? hasPermission(user.role, 'canEditBankDetails') : false;
                const canEditAll = user ? hasPermission(user.role, 'canEditInvoice') : false;
                const canEditVendor = user ? ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role) : false;
                // Bank section: read-only if user can't edit bank details
                // Non-bank sections: read-only if user can't edit invoice (e.g., Accounting can only edit bank)
                const isReadOnly = canEditAll
                  ? (isBankSection && !canEditBank)
                  : !isBankSection;
                return (
                <div key={section.title} className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => setEditCollapsed({ ...editCollapsed, [section.title]: !isCollapsed })}
                    className="w-full flex items-center justify-between px-4 py-3 transition-colors"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                  >
                    <span className="text-sm font-medium">{section.title}</span>
                    <ChevronRight className="h-4 w-4 transition-transform" style={{ color: 'var(--text-muted)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }} />
                  </button>
                  {!isCollapsed && (
                    <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                      {section.fields.map(({ label, field, type, options, required }: any) => {
                        const fieldIsReadOnly = isReadOnly && !(canEditVendor && (field === 'vendor_id' || field === 'new_vendor_name'));
                        return (
                        <div key={field}>
                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                            {label}{required && <span style={{ color: 'var(--accent-red)' }}> *</span>}
                          </label>
                          {type === 'select' ? (
                            <select
                              value={editFormData[field] || ''}
                              onChange={(e) => {
                                if (field === 'vendor_id') {
                                  const selectedVendor = vendorList.find((vendor) => vendor.id === e.target.value);
                                  setEditFormData({
                                    ...editFormData,
                                    vendor_id: e.target.value,
                                    vendor_name_raw: selectedVendor?.name || editFormData.vendor_name_raw,
                                    new_vendor_name: '',
                                  });
                                } else {
                                  handleEditChange(field, e.target.value);
                                }
                              }}
                              disabled={fieldIsReadOnly}
                              className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                              style={{
                                background: fieldIsReadOnly ? 'var(--bg-base)' : 'var(--bg-elevated)',
                                border: '1px solid var(--border-color)',
                                color: fieldIsReadOnly ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: fieldIsReadOnly ? 'not-allowed' : 'pointer',
                                opacity: fieldIsReadOnly ? 0.7 : 1,
                              }}
                            >
                              {options.map((opt: any) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          ) : type === 'datalist' ? (
                            <>
                              <input
                                type="text"
                                list={`datalist-${field}`}
                                value={editFormData[field] || ''}
                                onChange={(e) => handleEditChange(field, e.target.value)}
                                disabled={fieldIsReadOnly}
                                readOnly={fieldIsReadOnly}
                                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                                style={{
                                  background: fieldIsReadOnly ? 'var(--bg-base)' : 'var(--bg-elevated)',
                                  border: '1px solid var(--border-color)',
                                  color: fieldIsReadOnly ? 'var(--text-muted)' : 'var(--text-primary)',
                                  cursor: fieldIsReadOnly ? 'not-allowed' : 'text',
                                  opacity: fieldIsReadOnly ? 0.7 : 1,
                                }}
                              />
                              <datalist id={`datalist-${field}`}>
                                {options.map((opt: any) => (
                                  <option key={opt.value} value={opt.value} />
                                ))}
                              </datalist>
                            </>
                          ) : (
                            <input
                              type={type}
                              value={editFormData[field] || ''}
                              onChange={(e) => handleEditChange(field, e.target.value)}
                              disabled={fieldIsReadOnly}
                              readOnly={fieldIsReadOnly}
                              className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                              style={{
                                background: fieldIsReadOnly ? 'var(--bg-base)' : 'var(--bg-elevated)',
                                border: '1px solid var(--border-color)',
                                color: fieldIsReadOnly ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: fieldIsReadOnly ? 'not-allowed' : 'text',
                                opacity: fieldIsReadOnly ? 0.7 : 1,
                              }}
                            />
                          )}
                        </div>
                        );
                      })}
                    </div>
                    {isReadOnly && (
                      <div className="px-4 pb-4">
                        {isBankSection ? (
                          // Bank section read-only for non-Accounting users
                          <>
                          <div className="p-3 rounded-xl flex items-start gap-2 mb-3" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                            <p className="text-xs" style={{ color: 'var(--accent-amber)' }}>
                              Bank details can only be edited by Accounting. Click below to request a change.
                            </p>
                          </div>
                          <button
                            onClick={() => { setBankChangeField(''); setBankChangeValue(''); setBankChangeReason(''); setBankChangeAttachment(null); setShowBankChangeModal(true); }}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                            style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 20%, transparent)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 10%, transparent)'; }}
                          >
                            <Edit className="h-4 w-4" strokeWidth={1.75} />
                            Request Bank Details Change
                          </button>
                          </>
                        ) : (
                          // Non-bank section read-only for Accounting users
                          <div className="p-3 rounded-xl flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--text-muted) 8%, transparent)', border: '1px solid var(--border-color)' }}>
                            <Eye className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              View only — editable by Purchasing Coordinator.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    </>
                  )}
                </div>
                );
              })}

              {/* Flags */}
              <div className="mt-3 p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Flags</p>
                <div className="flex flex-wrap gap-4">
                  {[
                    { label: 'Handwritten', field: 'is_handwritten' },
                    { label: 'Urgent', field: 'is_urgent' },
                    { label: 'Priority Flag', field: 'priority_flag' },
                  ].map(({ label, field }) => (
                    <label key={field} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={editFormData[field] || false}
                        onChange={(e) => handleEditChange(field, e.target.checked)}
                        className="rounded"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Reason for edit */}
              <div className="mt-3">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Reason for edit</label>
                <textarea value={editFormData.edit_reason || ''} onChange={(e) => handleEditChange('edit_reason', e.target.value)} rows={2} placeholder="Required for material or financial changes" className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl transition-colors text-sm font-medium"
                  style={savingEdit ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div 
            key={toast.id}
            className="rounded-xl border shadow-2xl animate-slide-in-right"
            style={{ 
              background: 'var(--bg-card)',
              borderLeft: toast.type === 'success' ? '3px solid var(--accent-lime)' : toast.type === 'error' ? '3px solid var(--accent-red)' : toast.type === 'warning' ? '3px solid var(--accent-amber)' : '3px solid var(--accent-purple)',
              borderColor: 'var(--border-color)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              padding: '12px 16px',
              minWidth: '280px',
              maxWidth: '400px',
              borderRadius: '12px',
            }}
          >
            <div className="flex items-center gap-3">
              {toast.type === 'success' ? (
                <CheckCircle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
              ) : toast.type === 'error' ? (
                <XCircle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
              ) : toast.type === 'warning' ? (
                <AlertTriangle className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
              ) : (
                <Bell className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
              )}
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{toast.message}</span>
            </div>
            <div className="mt-2 h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
              <div 
                className="h-full rounded-full"
                style={{ 
                  background: toast.type === 'success' ? 'var(--accent-lime)' : toast.type === 'error' ? 'var(--accent-red)' : toast.type === 'warning' ? 'var(--accent-amber)' : 'var(--accent-purple)',
                  animation: 'progressFill 3s linear forwards',
                  '--progress-width': '100%',
                } as React.CSSProperties}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Upload Invoice Modal */}
      <UploadInvoiceModal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} />

      {/* Hold for Batch Threshold Modal */}
      {showHoldModal && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => !holdingInvoice && setShowHoldModal(false)}>
          <div className="w-full max-w-md rounded-2xl p-6 animate-scale-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl p-2.5" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)' }}>
                <Pause className="h-5 w-5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Hold for Batch Threshold</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Invoice will be held until vendor cumulative reaches $100</p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>Invoice</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span style={{ color: 'var(--text-muted)' }}>Vendor</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.vendor?.name || 'Unknown'}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span style={{ color: 'var(--text-muted)' }}>Amount</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>${Number(selectedInvoice.total_amount || 0).toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Reason</label>
                <textarea
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  disabled={holdingInvoice}
                  rows={3}
                  className="w-full rounded-xl px-3 py-2 text-sm resize-none"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="Enter reason for holding this invoice..."
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowHoldModal(false)}
                disabled={holdingInvoice}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmHoldForBatchThreshold}
                disabled={holdingInvoice}
                className="flex-1 flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={holdingInvoice
                  ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                  : { background: 'var(--accent-amber)', color: 'var(--text-inverse)' }}
              >
                {holdingInvoice ? <Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.75} /> : <Pause className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                {holdingInvoice ? 'Holding...' : 'Hold Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bank Details Change Request Modal */}
      {showBankChangeModal && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => !submittingBankChange && setShowBankChangeModal(false)}>
          <div className="w-full max-w-md rounded-2xl p-6 animate-scale-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Request Bank Details Change</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Invoice: {selectedInvoice.invoice_number} — {selectedInvoice.vendor?.name}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Field to Change</label>
                <select
                  value={bankChangeField}
                  onChange={(e) => { setBankChangeField(e.target.value); setBankChangeValue(''); }}
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                >
                  <option value="">Select a field...</option>
                  <option value="beneficiary_name">Beneficiary Name</option>
                  <option value="bank_name">Bank Name</option>
                  <option value="swift_code">SWIFT Code</option>
                  <option value="account_number">Account Number</option>
                </select>
              </div>

              {bankChangeField && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Current Value</label>
                  <div className="px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    {String((editFormData as any)[bankChangeField] || '—') || '—'}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Requested New Value</label>
                <input
                  type="text"
                  value={bankChangeValue}
                  onChange={(e) => setBankChangeValue(e.target.value)}
                  placeholder="Enter the correct value..."
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Reason for Change</label>
                <textarea
                  value={bankChangeReason}
                  onChange={(e) => setBankChangeReason(e.target.value)}
                  placeholder="Explain why this change is needed..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm resize-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  Supporting Document <span style={{ color: 'var(--accent-red)' }}>*</span>
                </label>
                <div
                  className="relative rounded-xl transition-all cursor-pointer"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: bankChangeAttachment ? '1px solid var(--accent-lime)' : '2px dashed var(--border-color)',
                  }}
                  onClick={() => document.getElementById('bank-change-attachment')?.click()}
                  onMouseEnter={(e) => { if (!bankChangeAttachment) e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                  onMouseLeave={(e) => { if (!bankChangeAttachment) e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                >
                  <input
                    id="bank-change-attachment"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setBankChangeAttachment(file);
                    }}
                  />
                  {bankChangeAttachment ? (
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
                        <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{bankChangeAttachment.name}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setBankChangeAttachment(null); }}
                        className="flex-shrink-0 p-1 rounded transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-red)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        <X className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-4 px-3 text-center">
                      <Upload className="h-5 w-5 mb-1.5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Click to upload supporting document</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>PDF, JPG, or PNG (max 10MB)</p>
                    </div>
                  )}
                </div>
                {!bankChangeAttachment && (
                  <p className="text-[10px] mt-1" style={{ color: 'var(--accent-amber)' }}>
                    Attachment is required — e.g. vendor email, bank letter, or invoice copy
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => !submittingBankChange && setShowBankChangeModal(false)}
                disabled={submittingBankChange}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleRequestBankChange}
                disabled={!bankChangeField || !bankChangeValue.trim() || !bankChangeReason.trim() || !bankChangeAttachment || submittingBankChange}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={!bankChangeField || !bankChangeValue.trim() || !bankChangeReason.trim() || !bankChangeAttachment || submittingBankChange
                  ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                  : { background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
              >
                {submittingBankChange ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Send className="h-4 w-4" strokeWidth={1.75} />}
                {submittingBankChange ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
