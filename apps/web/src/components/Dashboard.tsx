import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { InvoiceStatus, InvoiceCategory, InvoiceType, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { invoiceApi, notificationApi } from '../lib/api';
import InvoiceTable from './InvoiceTable';
import UploadInvoiceModal from './UploadInvoiceModal';
import BottleneckView from './BottleneckView';
import AuditLogViewer from './AuditLogViewer';
import MyTasksWidget from './MyTasksWidget';
import StatusGuide from './StatusGuide';
import StatCard from './ui/StatCard';
import AuditTile from './ui/AuditTile';
import SidebarItem from './ui/SidebarItem';
import { ThemeToggle } from './ThemeToggle';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { MockInvoice } from '../lib/mockData';
import { hasPermission, filterInvoicesByRole, canUserApproveStatus, isWithinRoleThreshold } from '../lib/roleAccess';
import { cn } from '../lib/utils';
import { FileText, Clock, AlertTriangle, CheckCircle, Shield, CheckSquare, XCircle, Send, AlertCircle, Package, BarChart3, FileSearch, TrendingUp, Search, Bell, Settings, LayoutDashboard, Building2, ChevronLeft, LogOut, Edit, Unlock, Users, Loader2 } from 'lucide-react';
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

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { invoices, vendors, paymentBatches, refresh, loading: ctxLoading } = useMockData();
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [validating, setValidating] = useState(false);
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [posting, setPosting] = useState(false);
  const [showSchedulePaymentModal, setShowSchedulePaymentModal] = useState(false);
  const [paymentDate, setPaymentDate] = useState('');
  const [filters, setFilters] = useState({
    status: undefined as InvoiceStatus | undefined,
    category: undefined as InvoiceCategory | undefined,
    type: undefined as InvoiceType | undefined,
    brand: undefined as string | undefined,
    brand_code: undefined as string | undefined,
    search: undefined as string | undefined,
    dateFrom: undefined as string | undefined,
    dateTo: undefined as string | undefined,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }[]>([]);
  const [countUpStarted, setCountUpStarted] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bypassVarianceCheck, setBypassVarianceCheck] = useState(false);
  const [sendingConfirmation, setSendingConfirmation] = useState(false);
  const [showConfirmSendModal, setShowConfirmSendModal] = useState(false);
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

    // PURCHASING_COORDINATOR - pending their approval, validation, or batch hold (they upload first)
    if (role === 'PURCHASING_COORDINATOR') {
      return allInvoices.filter(i =>
        i.status === 'RECEIVED' ||
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
    return true;
  });

  // Count how many filters are currently active (for the "Clear" affordance)
  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;

  // Sort invoices by created_at/received date (newest first)
  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
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
    if (state?.selectedInvoiceId && invoices.length > 0) {
      const target = invoices.find(inv => inv.id === state.selectedInvoiceId);
      if (target) {
        setSelectedInvoice(target);
        // Clear the state so it doesn't re-trigger on refresh
        navigate('/', { replace: true, state: {} });
      }
    }
  }, [location.state, invoices, navigate]);

  // Compute PO audit summary dynamically from each invoice's NextGen validation result.
  useEffect(() => {
    const summary = allInvoices.reduce((acc, invoice) => {
      const pv = invoice.po_validation;
      acc.total++;
      if (!pv) {
        acc.pending++;
        return acc;
      }
      if (pv.mode === 'AST_ISOLATED' && pv.skipped) {
        acc.skipped++;
        return acc;
      }
      if (!pv.po_found) {
        acc.not_found++;
        return acc;
      }
      const comparison = pv.comparison || pv.validation_result?.checks;
      const hasMismatch = comparison &&
        (comparison.vendor_match === false || comparison.amount_match === false ||
         comparison.brand_match === false || comparison.season_match === false ||
         comparison.order_type_match === false || comparison.currency_match === false);
      const hasWarning = comparison &&
        (typeof comparison.amount_variance_percent === 'number' && comparison.amount_variance_percent > 0 && comparison.amount_variance_percent <= 5);
      if (hasMismatch) {
        acc.mismatches++;
      } else if (hasWarning) {
        acc.warnings++;
      } else if (pv.is_match || pv.validation_result?.status === 'AUTO_APPROVED') {
        acc.matched++;
      } else if (pv.validation_result?.status === 'REJECTED') {
        acc.mismatches++;
      } else if (pv.validation_result?.status === 'REVIEW_REQUIRED') {
        acc.warnings++;
      } else {
        acc.matched++;
      }
      return acc;
    }, {
      matched: 0,
      warnings: 0,
      mismatches: 0,
      pending: 0,
      not_found: 0,
      skipped: 0,
      error: 0,
      total: 0,
    });
    setPoAuditSummary(summary);
  }, [allInvoices]);

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


  const handleValidate = async () => {
    if (!selectedInvoice) return;

    try {
      setValidating(true);
      const response = await invoiceApi.validate(selectedInvoice.id);
      setValidationResult(response.data);
      await refresh();
      const updatedInvoice = await invoiceApi.getById(selectedInvoice.id);
      setSelectedInvoice(updatedInvoice.data);
    } catch (error) {
      console.error('Failed to validate invoice:', error);
    } finally {
      setValidating(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!selectedInvoice) return;
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

  const handleOpenEdit = async () => {
    if (!selectedInvoice) return;
    const invoice = selectedInvoice as any;
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
      mpo_number: invoice.mpo_number || '',
      customer_po_number: invoice.customer_po_number || '',
      season: invoice.season || '',
      order_type: invoice.order_type || '',
      invoice_type: invoice.invoice_type || '',
      category: invoice.category || '',
      bill_to_entity: invoice.bill_to_entity || '',
      vendor_name_raw: invoice.vendor_name_raw || '',
      vendor_id: invoice.vendor_id || '',
      ship_to: invoice.ship_to || '',
      sold_to: invoice.sold_to || '',
      bank_name: invoice.bank_name || '',
      swift_code: invoice.swift_code || '',
      account_number: invoice.account_number || '',
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
    setEditFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    if (!selectedInvoice) return;
    setSavingEdit(true);
    try {
      const parseNum = (val: string) => (val === '' || val === undefined || val === null) ? undefined : parseFloat(val);
      const parseString = (val: string) => (val === '' || val === undefined || val === null) ? undefined : val;

      const payload = {
        vendor_name_raw: parseString(editFormData.vendor_name_raw),
        invoice_number: parseString(editFormData.invoice_number),
        invoice_date: parseString(editFormData.invoice_date),
        due_date: parseString(editFormData.due_date),
        total_amount: parseNum(editFormData.total_amount),
        currency: parseString(editFormData.currency),
        invoice_type: parseString(editFormData.invoice_type),
        brand: parseString(editFormData.brand),
        brand_tier: parseString(editFormData.brand_tier),
        season: parseString(editFormData.season),
        order_type: parseString(editFormData.order_type),
        customer_po_number: parseString(editFormData.customer_po_number),
        mpo_number: parseString(editFormData.mpo_number),
        qty_shipped: parseNum(editFormData.qty_shipped),
        payment_terms: parseString(editFormData.payment_terms),
        bank_name: parseString(editFormData.bank_name),
        swift_code: parseString(editFormData.swift_code),
        account_number: parseString(editFormData.account_number),
        ship_to: parseString(editFormData.ship_to),
        sold_to: parseString(editFormData.sold_to),
        subtotal: parseNum(editFormData.subtotal),
        tax_amount: parseNum(editFormData.tax_amount),
        discount_amount: parseNum(editFormData.discount_amount),
        bank_charges: parseNum(editFormData.bank_charges),
        freight_charges: parseNum(editFormData.freight_charges),
        additional_charges: parseNum(editFormData.additional_charges),
        exchange_rate_to_usd: parseNum(editFormData.exchange_rate_to_usd),
        invoice_currency_original: parseString(editFormData.invoice_currency_original),
        incoterm: parseString(editFormData.incoterm),
        category: parseString(editFormData.category),
        bill_to_entity: parseString(editFormData.bill_to_entity),
        is_handwritten: editFormData.is_handwritten || undefined,
        is_urgent: editFormData.is_urgent || undefined,
        priority_flag: editFormData.priority_flag || undefined,
        priority_pay_date: parseString(editFormData.priority_pay_date),
        date_range_start: parseString(editFormData.date_range_start),
        date_range_end: parseString(editFormData.date_range_end),
      };
      const response = await invoiceApi.update(selectedInvoice.id, payload);
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

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim()) return;

    try {
      await invoiceApi.reject(selectedInvoice.id, rejectReason);
      showToast('Invoice rejected successfully', 'success');
      await refresh();
      setSelectedInvoice(null);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      console.error('Failed to reject invoice:', error);
      showToast('Failed to reject invoice', 'error');
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
    } catch (error) {
      console.error('Failed to post invoice:', error);
      showToast('Failed to post invoice', 'error');
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
    } catch (error) {
      console.error('Failed to release invoice from hold:', error);
      showToast('Failed to release invoice from hold', 'error');
    } finally {
      setPosting(false);
    }
  };

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
    } catch (error) {
      console.error('Failed to check NextGen changes:', error);
      showToast('Failed to check NextGen changes', 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleSchedulePayment = async () => {
    if (!selectedInvoice || !paymentDate) return;

    try {
      await invoiceApi.schedulePayment(selectedInvoice.id, paymentDate);
      showToast('Payment scheduled successfully', 'success');
      await refresh();
      setSelectedInvoice(null);
      setShowSchedulePaymentModal(false);
      setPaymentDate('');
    } catch (error) {
      console.error('Failed to schedule payment:', error);
      showToast('Failed to schedule payment', 'error');
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
        const myInvs = allInvoices.filter(i => i.uploaded_by === user.email);
        const pendingVal = allInvoices.filter(i => i.status === InvoiceStatus.VALIDATION_PENDING);
        const validated = allInvoices.filter(i => i.status === InvoiceStatus.APPROVED);
        const paidPendingConfirmation = allInvoices.filter(i => i.status === InvoiceStatus.PAID);
        const scheduledPayments = allInvoices.filter(i => i.status === InvoiceStatus.PAYMENT_SCHEDULED);
        const draftBatches = paymentBatches.filter(b => b.status === 'DRAFT');
        return [
          {
            label: 'My Invoices',
            value: myInvs.length,
            icon: FileText,
            accent: 'info',
            ...calcTrend(myInvs),
          },
          {
            label: 'Pending Validation',
            value: pendingValidationCount.count,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendingVal),
          },
          {
            label: 'PAID — Confirmation Pending',
            value: paidPendingConfirmation.length,
            icon: Send,
            accent: 'success',
            ...calcTrend(paidPendingConfirmation),
            subtitle: 'Send payment confirmations',
          },
          {
            label: 'Draft Payment Batches',
            value: draftBatches.length,
            icon: Package,
            accent: 'warning',
            ...calcTrend(draftBatches),
            subtitle: 'Ready for processing',
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
        const pendingAssoc = allInvoices.filter(i => i.status === 'VALIDATION_PENDING');
        const readyPost = allInvoices.filter(i => i.status === InvoiceStatus.APPROVED || i.status === InvoiceStatus.PENDING_ACCOUNTING);
        const paidPendingConfSup = allInvoices.filter(i => i.status === InvoiceStatus.PAID);
        const allBatches = paymentBatches;
        return [
          {
            label: 'All Invoices Overview',
            value: allInvoices.length,
            icon: FileText,
            accent: 'info',
            ...calcTrend(allInvoices),
          },
          {
            label: 'Pending from Associates',
            value: pendingAssoc.length,
            icon: Clock,
            accent: 'default',
            ...calcTrend(pendingAssoc),
          },
          {
            label: 'PAID — Confirmation Pending',
            value: paidPendingConfSup.length,
            icon: Send,
            accent: 'success',
            ...calcTrend(paidPendingConfSup),
            subtitle: 'Send payment confirmations',
          },
          {
            label: 'Payment Batches',
            value: allBatches.length,
            icon: Package,
            accent: 'warning',
            ...calcTrend(allBatches),
            subtitle: 'View all batches',
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

  return (
    <div className="flex h-screen relative" style={{ background: 'var(--bg-base)' }}>

      {/* Sidebar - Floating rounded card */}
      <aside className={`${sidebarCollapsed ? 'w-20' : 'w-64'} m-4 flex flex-col flex-shrink-0 transition-all duration-300 hidden md:flex z-10 rounded-3xl`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)' }}>
        {/* Logo */}
        <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <img src="/madison-logo.png" alt="Madison 88" className="h-10 w-auto flex-shrink-0" />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          <SidebarItem
            icon={LayoutDashboard}
            label="Dashboard"
            active
            collapsed={sidebarCollapsed}
          />
          {user && [
            'PURCHASING_COORDINATOR',
            'PURCHASING_MANAGER',
            'PLANNING_MANAGER',
            'SR_MANAGER_GLOBAL_PRODUCTION',
            'MS_POLLY',
            'ACCOUNTING_SUPERVISOR'
          ].includes(user.role) && (
            <SidebarItem
              icon={CheckSquare}
              label="Approvals"
              badge={awaitingApprovalCount.count}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/approvals')}
            />
          )}
          {user && ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'IT_ADMIN'].includes(user.role) && (
            <SidebarItem
              icon={AlertTriangle}
              label="Exceptions"
              badge={exceptionsCount.count}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/exceptions')}
            />
          )}
          {user && ['PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE'].includes(user.role) && (
            <SidebarItem
              icon={Building2}
              label="Vendors"
              badge={vendorsPendingVerification}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/vendors')}
            />
          )}
          {user && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
            <SidebarItem
              icon={Package}
              label="Batches"
              badge={draftBatchCount}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/payment-batches')}
            />
          )}
          {user && ['PURCHASING_MANAGER', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
            <SidebarItem
              icon={BarChart3}
              label="Reports"
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/reports')}
            />
          )}
          {user && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR'].includes(user.role) && (
            <SidebarItem
              icon={FileSearch}
              label="Review"
              badge={reviewPendingCount}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/accounting-review')}
            />
          )}
          {user && (user.role === 'IT_ADMIN' || user.role === 'SUPERADMIN') && (
            <SidebarItem
              icon={Users}
              label="User Management"
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/users')}
            />
          )}
          {user && (user.role === 'IT_ADMIN' || user.role === 'SUPERADMIN') && (
            <SidebarItem
              icon={Settings}
              label="System Configuration"
              collapsed={sidebarCollapsed}
              onClick={() => navigate('/settings')}
            />
          )}
        </nav>

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

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden z-10">
        {/* Top Header */}
        <header className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {user ? `Welcome, ${user.name.split(' ')[0]}` : 'Dashboard'}
              </h1>
              {user && (
                <span className="inline-block mt-1 px-3 py-1 text-xs font-medium rounded-full" style={{ background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  {user.role.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2.5 rounded-xl transition-colors" style={{ color: 'var(--text-muted)' }}
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
                  <div className="absolute right-0 top-full mt-2 w-96 rounded-2xl z-50 overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
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
                        <button onClick={() => setShowNotifications(false)} className="text-sm" style={{ color: 'var(--text-muted)' }}>Close</button>
                      </div>
                    </div>
                    <div className="max-h-96 overflow-y-auto" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      {notifications.length > 0 ? (
                        notifications.map((n) => {
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
                )}
              </div>
              {/* Theme Toggle */}
              <ThemeToggle />
              {/* User Info */}
              {user && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}>
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-inverse)' }}>
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div className="text-left">
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

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-6 pb-24 md:pb-6">
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
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* PO Validation Audit — unified horizontal scorecard */}
          {user?.role !== 'SUPERADMIN' && (
          <div className="mb-6 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
                  <FileSearch className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>NextGen Validation Audit</h3>
              </div>
              {poAuditLoading && (
                <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  Loading...
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-stretch rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg-elevated) 60%, transparent)' }}>
              <AuditTile
                label="Matched"
                value={poAuditSummary.matched}
                icon={CheckCircle}
                status="success"
              />
              <AuditTile
                label="Warnings"
                value={poAuditSummary.warnings}
                icon={AlertTriangle}
                status="warning"
              />
              <AuditTile
                label="Mismatches"
                value={poAuditSummary.mismatches}
                icon={XCircle}
                status="danger"
              />
              <AuditTile
                label="Pending"
                value={poAuditSummary.pending}
                icon={Clock}
                status="info"
              />
              <AuditTile
                label="Not Found"
                value={poAuditSummary.not_found}
                icon={Search}
                status="warning"
              />
              <AuditTile
                label="Skipped"
                value={poAuditSummary.skipped}
                icon={Shield}
                status="neutral"
              />
              <AuditTile
                label="Error"
                value={poAuditSummary.error}
                icon={AlertCircle}
                status="danger"
              />
            </div>
            <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
              {poAuditSummary.total} invoice(s) audited against NextGen PO data. Audit is async and informational only.
            </p>
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

          {/* Filters — pill selectors */}
          {user && user.role !== 'MS_POLLY' && user.role !== 'IT_ADMIN' && user.role !== 'SUPERADMIN' && (
            <div className="p-4 mb-6 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Filter Invoices</h3>
                <StatusGuide />
              </div>
              <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                <div className="relative w-full md:flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search invoice number, vendor, or brand..."
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
                <button
                  onClick={() => setFilters({ status: undefined, category: undefined, type: undefined, brand: undefined, brand_code: undefined, search: undefined, dateFrom: undefined, dateTo: undefined })}
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
              </div>
            </div>
          )}

          {/* Invoice Table — hidden from SUPERADMIN (system maintenance only) */}
          {user?.role !== 'SUPERADMIN' && (
          <div className="rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Invoices</h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{displayedInvoices.length} records</span>
            </div>
            <InvoiceTable
              invoices={displayedInvoices}
              onInvoiceClick={setSelectedInvoice}
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
        </main>
      </div>

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
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
            <Package className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs mt-1">More</span>
          </button>
        </div>
      </div>

      {/* Invoice Detail Panel */}
      {selectedInvoice && (
        <div className="fixed right-0 top-0 h-full w-96 overflow-y-auto z-50" style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Invoice Details</h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                ×
              </button>
            </div>
            <div className="space-y-4">
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
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.status}</p>
              </div>
              {(selectedInvoice as any).ocr_confidence_score !== undefined && (selectedInvoice as any).ocr_confidence_score !== null && (
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>OCR Confidence</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                      <div
                        className={cn(
                          'h-full rounded-full',
                          Number((selectedInvoice as any).ocr_confidence_score) >= 0.9 ? '' : ''
                        )}
                        style={{ width: `${Math.round(Number((selectedInvoice as any).ocr_confidence_score) * 100)}%`, backgroundColor: Number((selectedInvoice as any).ocr_confidence_score) >= 0.9 ? 'var(--accent-lime)' : 'var(--accent-amber)' }}
                      />
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      {Math.round(Number((selectedInvoice as any).ocr_confidence_score) * 100)}%
                    </span>
                  </div>
                </div>
              )}
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

              {/* Edit Invoice Button */}
              {user && hasPermission(user.role, 'canEditInvoice') && (
                <button
                  onClick={handleOpenEdit}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-purple)'; }}
                >
                  <Edit className="h-4 w-4 mr-2" strokeWidth={1.75} />
                  Edit Invoice
                </button>
              )}

              {/* Check NextGen Changes Button */}
              {selectedInvoice.mpo_number && user && ['PURCHASING_COORDINATOR', 'ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'].includes(user.role) && (
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
                selectedInvoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any) ||
                selectedInvoice.status === (InvoiceStatus.ON_HOLD as any)) && user && hasPermission(user.role, 'canValidate') && (
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
              {selectedInvoice.status === (InvoiceStatus.EXCEPTION_FLAGGED as any) && user && ['PURCHASING_COORDINATOR', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'].includes(user.role) && (
                <button
                  onClick={() => navigate('/exceptions')}
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
                </div>
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

              {/* Payment Scheduling */}
              {selectedInvoice.status === (InvoiceStatus.POSTED_TO_QB as any) && user && hasPermission(user.role, 'canSchedulePayment') && (
                <button
                  onClick={() => setShowSchedulePaymentModal(true)}
                  className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                  style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-purple)'; }}
                >
                  <Clock className="h-4 w-4 mr-2" strokeWidth={1.75} />
                  Schedule Payment
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

              {/* Audit Log */}
              <AuditLogViewer invoiceId={selectedInvoice.id} />

              {/* Validation Results - Detailed 17-Rule Display */}
              {validationResult && (
                <div className={`mt-4 p-4 rounded-lg border`} style={{ background: validationResult.passed ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)' : 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: `1px solid ${validationResult.passed ? 'color-mix(in srgb, var(--accent-lime) 20%, transparent)' : 'color-mix(in srgb, var(--accent-red) 20%, transparent)'}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold" style={{ color: validationResult.passed ? 'var(--accent-lime)' : 'var(--accent-red)' }}>
                      {validationResult.passed ? '✓ Validation Passed' : '✗ Validation Failed'}
                    </p>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {validationResult.results.filter((r: any) => r.passed).length}/{validationResult.results.length} rules passed
                    </span>
                  </div>

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

                    {/* NextGen PO Cross-Check - Highlighted */}
                    <div className={`p-2 rounded border`} style={{ background: validationResult.results[16]?.passed ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)' : 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: `1px solid ${validationResult.results[16]?.passed ? 'color-mix(in srgb, var(--accent-lime) 20%, transparent)' : 'color-mix(in srgb, var(--accent-red) 20%, transparent)'}` }}>
                      <p className="text-xs font-medium mb-1 flex items-center" style={{ color: 'var(--text-muted)' }}>
                        <span className="mr-1">🔗</span> NextGen PO Cross-Check
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

              {selectedInvoice.exceptions && selectedInvoice.exceptions.length > 0 && (
                <div className="mt-4 p-4 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                  <p className="text-sm font-semibold mb-2" style={{ color: 'var(--accent-red)' }}>Exceptions</p>
                  {selectedInvoice.exceptions.map((exc) => (
                    <p key={exc.id} className="text-xs" style={{ color: 'var(--accent-red)' }}>
                      {exc.reason}: {exc.detail}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
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

      {/* Schedule Payment Modal */}
      {showSchedulePaymentModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Schedule Payment
              </h3>
              <div className="mb-4">
                <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowSchedulePaymentModal(false);
                    setPaymentDate('');
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSchedulePayment}
                  disabled={!paymentDate}
                  className="px-4 py-2 rounded-xl transition-colors text-sm font-medium"
                  style={!paymentDate ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' } : { background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}
                >
                  Schedule Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Payment Confirmation Modal */}
      {showConfirmSendModal && selectedInvoice && (
        <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
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
          <div className="max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Edit Invoice
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { label: 'Vendor Name', field: 'vendor_name_raw', type: 'text' },
                  { label: 'Invoice Number', field: 'invoice_number', type: 'text' },
                  { label: 'Invoice Date', field: 'invoice_date', type: 'date' },
                  { label: 'Due Date', field: 'due_date', type: 'date' },
                  { label: 'Amount', field: 'total_amount', type: 'number' },
                  { label: 'Currency', field: 'currency', type: 'text' },
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
                  { label: 'Brand', field: 'brand', type: 'text' },
                  { label: 'Brand Tier', field: 'brand_tier', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'TOP_10', label: 'Top 10' },
                    { value: 'OTHER', label: 'Other' },
                  ] },
                  { label: 'Season', field: 'season', type: 'text' },
                  { label: 'Order Type', field: 'order_type', type: 'select', options: [
                    { value: '', label: '— Select —' },
                    { value: 'BULK', label: 'Bulk' },
                    { value: 'SMS', label: 'SMS' },
                    { value: 'SAMPLE', label: 'Sample' },
                  ] },
                  { label: 'PO Number', field: 'customer_po_number', type: 'text' },
                  { label: 'MPO Number', field: 'mpo_number', type: 'text' },
                  { label: 'QTY SHIPPED', field: 'qty_shipped', type: 'number' },
                  { label: 'Payment Terms', field: 'payment_terms', type: 'text' },
                  { label: 'Bank Name', field: 'bank_name', type: 'text' },
                  { label: 'SWIFT Code', field: 'swift_code', type: 'text' },
                  { label: 'Account Number', field: 'account_number', type: 'text' },
                  { label: 'Ship To', field: 'ship_to', type: 'text' },
                  { label: 'Sold To', field: 'sold_to', type: 'text' },
                  { label: 'Subtotal', field: 'subtotal', type: 'number' },
                  { label: 'Tax Amount', field: 'tax_amount', type: 'number' },
                  { label: 'Discount', field: 'discount_amount', type: 'number' },
                  { label: 'Bank Charges', field: 'bank_charges', type: 'number' },
                  { label: 'Freight Charges', field: 'freight_charges', type: 'number' },
                  { label: 'Additional Charges', field: 'additional_charges', type: 'number' },
                  { label: 'Exchange Rate', field: 'exchange_rate_to_usd', type: 'number' },
                  { label: 'Original Currency', field: 'invoice_currency_original', type: 'text' },
                  { label: 'Incoterm', field: 'incoterm', type: 'text' },
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
                  { label: 'Date Range Start', field: 'date_range_start', type: 'date' },
                  { label: 'Date Range End', field: 'date_range_end', type: 'date' },
                  { label: 'Priority Pay Date', field: 'priority_pay_date', type: 'date' },
                ].map(({ label, field, type, options }: any) => (
                  <div key={field}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                      {label}
                    </label>
                    {type === 'select' ? (
                      <select
                        value={editFormData[field] || ''}
                        onChange={(e) => handleEditChange(field, e.target.value)}
                        className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      >
                        {options.map((opt: any) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={type}
                        value={editFormData[field] || ''}
                        onChange={(e) => handleEditChange(field, e.target.value)}
                        className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      />
                    )}
                  </div>
                ))}

                <div className="col-span-full flex flex-wrap gap-4 mt-2">
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
    </div>
  );
}
