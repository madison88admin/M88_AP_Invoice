import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Package, Play, X, AlertCircle, CheckCircle, Clock, DollarSign, ArrowLeft, CheckSquare, Calendar, Loader2, Paperclip, Pencil, Download, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { paymentBatchApi, vendorApi, qbApi } from '../lib/api';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface ScheduledPayment {
  id: string;
  amount: number;
  currency: string;
  payment_date: string;
  status: string;
  selected_for_batch: boolean;
  selected_by?: string;
  invoice_date?: string | null;
  due_date?: string | null;
  brand?: string | null;
  category?: string | null;
  qb_memo?: string | null;
  approval_date?: string | null;
  aging_days?: number | null;
  open_balance: number;
  remarks?: string | null;
  supervisor_action?: string | null;
  supervisor_note?: string | null;
  payment_date_source?: string;
  payment_date_from_due?: boolean;
  invoice: {
    id: string;
    invoice_number: string;
    vendor: {
      id?: string;
      name: string;
      account_number?: string;
    };
    bill_to_entity?: string;
  };
}

interface FilteredTotals {
  currency: string;
  count: number;
  total: number;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  scheduled_date: string;
  payment_date_source?: string;
  status: string;
  paid_at?: string;
  reference?: string;
  bank_used?: string;
  remarks?: string;
  bank_charge_amount?: number | null;
  bank_charge_note?: string | null;
  bill_stub?: {
    id: string;
    stub_date?: string | null;
    type?: string | null;
    reference?: string | null;
    original_amount?: number | null;
    balance?: number | null;
    discount?: number | null;
    paid_amount?: number | null;
    proof_file_url?: string | null;
    proof_file_name?: string | null;
  } | null;
  proof_file_url?: string;
  proof_file_name?: string;
  invoice: {
    id: string;
    invoice_number: string;
    due_date?: string | null;
    vendor: {
      name: string;
    };
  };
}

interface PaymentBatch {
  id: string;
  batch_number: string;
  total_amount: number;
  payment_count: number;
  status: 'DRAFT' | 'PENDING_SUPERVISOR_REVIEW' | 'RETURNED_FOR_CORRECTION' | 'REVIEWED' | 'EXPORTED_TO_BANK' | 'PROCESSING' | 'PROCESSED' | 'PARTIALLY_PAID' | 'FAILED' | 'CANCELLED';
  created_at: string;
  processed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  return_reason?: string;
  review_note?: string;
  payments: Payment[];
  vendor_bill_stubs?: VendorBillStub[];
}

interface VendorBillStub {
  id: string;
  vendor?: { name?: string };
  currency: string;
  total_amount: number;
  payment_reference?: string | null;
  status: string;
  lines: Array<{ payment_id: string; invoice_id: string; amount: number }>;
}

/** Normalize a batch payload from the API into the component's PaymentBatch shape. */
function mapBatchPayload(b: any): PaymentBatch {
  return {
    id: b.id,
    batch_number: b.batch_number || b.batch_name || b.name || b.id,
    total_amount: Number(b.total_amount || 0),
    payment_count: b.payment_count || b.invoice_count || 0,
    status: b.status || 'DRAFT',
    created_at: b.created_at || new Date().toISOString(),
    processed_at: b.processed_at || undefined,
    cancelled_at: b.cancelled_at || undefined,
    cancellation_reason: b.cancellation_reason || undefined,
    return_reason: b.return_reason || undefined,
    review_note: b.review_note || undefined,
    vendor_bill_stubs: (b.vendor_bill_stubs || []).map((s: any) => ({
      id: s.id,
      vendor: s.vendor,
      currency: s.currency || 'USD',
      total_amount: Number(s.total_amount || 0),
      payment_reference: s.payment_reference || null,
      status: s.status || 'DRAFT',
      lines: (s.lines || []).map((l: any) => ({ payment_id: l.payment_id, invoice_id: l.invoice_id, amount: Number(l.amount || 0) })),
    })),
    payments: (b.payments || []).map((p: any) => ({
      id: p.id,
      amount: Number(p.amount || 0),
      currency: p.currency || 'USD',
      scheduled_date: p.payment_date || p.scheduled_date || new Date().toISOString(),
      payment_date_source: p.payment_date_source || 'DUE_DATE',
      status: p.status || 'SCHEDULED',
      paid_at: p.paid_at || undefined,
      reference: p.reference || undefined,
      bank_used: p.bank_used || undefined,
      remarks: p.remarks || undefined,
      bank_charge_amount: p.bank_charge_amount != null ? Number(p.bank_charge_amount) : null,
      bank_charge_note: p.bank_charge_note || null,
      bill_stub: p.bill_stub
        ? {
            id: p.bill_stub.id,
            stub_date: p.bill_stub.stub_date || null,
            type: p.bill_stub.type || null,
            reference: p.bill_stub.reference || null,
            original_amount: p.bill_stub.original_amount != null ? Number(p.bill_stub.original_amount) : null,
            balance: p.bill_stub.balance != null ? Number(p.bill_stub.balance) : null,
            discount: p.bill_stub.discount != null ? Number(p.bill_stub.discount) : null,
            paid_amount: p.bill_stub.paid_amount != null ? Number(p.bill_stub.paid_amount) : null,
            proof_file_url: p.bill_stub.proof_file_url || null,
            proof_file_name: p.bill_stub.proof_file_name || null,
          }
        : null,
      proof_file_url: p.proof_file_url || undefined,
      proof_file_name: p.proof_file_name || undefined,
      invoice: {
        id: p.invoice?.id || p.invoice_id || '',
        invoice_number: p.invoice?.invoice_number || '',
        due_date: p.invoice?.due_date || null,
        vendor: { name: p.invoice?.vendor?.name || '' },
      },
    })),
  };
}

export default function PaymentBatchManager() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'scheduled' | 'batches'>('scheduled');
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [stuckBatches, setStuckBatches] = useState<(PaymentBatch & { days_stuck?: number; pending_payments?: number })[]>([]);
  const [stuckLoading, setStuckLoading] = useState(false);
  const [scheduledPayments, setScheduledPayments] = useState<ScheduledPayment[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showExecutionModal, setShowExecutionModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [executionForm, setExecutionForm] = useState({
    paidDate: new Date().toISOString().split('T')[0],
    reference: '',
    bankUsed: '',
    remarks: '',
    proof: null as File | null,
  });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());
  const [selectedReturnPaymentIds, setSelectedReturnPaymentIds] = useState<Set<string>>(new Set());
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [filters, setFilters] = useState({
    vendorId: '', currency: '', dateFrom: '', dateTo: '', search: '',
    dueMonth: '', dueFrom: '', dueTo: '',
    invoiceDateFrom: '', invoiceDateTo: '',
    approvalFrom: '', approvalTo: '',
    brand: '', memo: '', category: '', aging: '', status: '',
  });
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [vendorList, setVendorList] = useState<{ id: string; name: string }[]>([]);
  const [filteredTotals, setFilteredTotals] = useState<FilteredTotals[]>([]);
  const [remarksTarget, setRemarksTarget] = useState<ScheduledPayment | null>(null);
  const [remarksDraft, setRemarksDraft] = useState('');
  const [remarksSaving, setRemarksSaving] = useState(false);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [pendingHeldCount, setPendingHeldCount] = useState(0);
  const [showApproveAllModal, setShowApproveAllModal] = useState(false);
  const [approveAllIds, setApproveAllIds] = useState<string[]>([]);
  const [approveAllNote, setApproveAllNote] = useState('');
  const [rejectTarget, setRejectTarget] = useState<ScheduledPayment | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showBankChargeModal, setShowBankChargeModal] = useState(false);
  const [bankChargeForm, setBankChargeForm] = useState({ paymentId: '', amount: '', note: '' });
  const [bankChargeSaving, setBankChargeSaving] = useState(false);
  const [qbExporting, setQbExporting] = useState(false);
  const [reconExporting, setReconExporting] = useState(false);
  const [stubTarget, setStubTarget] = useState<Payment | null>(null);
  const [stubForm, setStubForm] = useState({ stubDate: '', type: 'Bank Transfer', reference: '', originalAmount: '', balance: '', discount: '', paidAmount: '' });
  const [stubFile, setStubFile] = useState<File | null>(null);
  const [stubSaving, setStubSaving] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [matchForm, setMatchForm] = useState({ reference: '', amount: '', paidDate: new Date().toISOString().split('T')[0] });
  const [matchSelected, setMatchSelected] = useState<Set<string>>(new Set());
  const [matchSaving, setMatchSaving] = useState(false);

  const isAssociate = user?.role === 'ACCOUNTING_ASSOCIATE';
  const isSupervisor = user?.role === 'ACCOUNTING_SUPERVISOR';
  const isPurchasing = user?.role === 'PURCHASING_COORDINATOR';
  const isBatchable = (p: ScheduledPayment) => p.status === 'SCHEDULED' || p.status === 'APPROVED_FOR_PAYMENT';

  const loadStuckBatches = useCallback(async () => {
    setStuckLoading(true);
    try {
      const response = await paymentBatchApi.getStuckBatches();
      const data = response.data || [];
      setStuckBatches(data.map((b: any) => ({ ...mapBatchPayload(b), days_stuck: b.days_stuck ?? 0, pending_payments: b.pending_payments ?? 0 })));
    } catch (error) {
      console.error('Failed to load stuck batches:', error);
      setStuckBatches([]);
    } finally {
      setStuckLoading(false);
    }
  }, []);

  const loadBatches = useCallback(async () => {
    try {
      const response = await paymentBatchApi.getAll();
      const data = response.data || [];
      setBatches(data.map((b: any) => mapBatchPayload(b)));
    } catch (error) {
      console.error('Failed to load payment batches:', error);
      setBatches([]);
    }
    loadStuckBatches();
  }, [loadStuckBatches]);

  const loadScheduledPayments = useCallback(async () => {
    try {
      const response = await paymentBatchApi.getScheduledPayments(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
      const data = response.data?.payments || response.data || [];
      setFilteredTotals(response.data?.totals || []);
      const mapped = data.map((p: any) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        currency: p.currency || 'USD',
        payment_date: p.payment_date || new Date().toISOString(),
        status: p.status || 'SCHEDULED',
        selected_for_batch: p.selected_for_batch || false,
        selected_by: p.selected_by || undefined,
        invoice_date: p.invoice_date || null,
        due_date: p.due_date || null,
        brand: p.brand || null,
        category: p.category || null,
        qb_memo: p.qb_memo || null,
        approval_date: p.approval_date || null,
        aging_days: p.aging_days ?? null,
        open_balance: Number(p.open_balance || 0),
        remarks: p.remarks || null,
        supervisor_action: p.supervisor_action || null,
        supervisor_note: p.supervisor_note || null,
        payment_date_source: p.payment_date_source || 'DUE_DATE',
        payment_date_from_due: p.payment_date_source === 'DUE_DATE',
        invoice: {
          id: p.invoice?.id || p.invoice_id,
          invoice_number: p.invoice?.invoice_number || '',
          vendor: { id: p.invoice?.vendor?.id || p.invoice?.vendor_id, name: p.invoice?.vendor?.name || '', account_number: p.invoice?.vendor?.account_number || '' },
          bill_to_entity: p.invoice?.bill_to_entity || '',
        },
      }));
      setScheduledPayments(mapped);
      const selected = new Set<string>();
      mapped.forEach((p: ScheduledPayment) => {
        if (p.selected_for_batch && p.selected_by === user?.id) selected.add(p.id);
      });
      setSelectedPaymentIds(selected);
      if (user?.role === 'ACCOUNTING_SUPERVISOR') {
        paymentBatchApi.getScheduledPayments({ status: 'FOR_PAYMENT' })
          .then((r) => setPendingReviewCount(Number(r.data?.filtered_count ?? r.data?.payments?.length ?? 0)))
          .catch(() => setPendingReviewCount(0));
      } else {
        setPendingReviewCount(0);
      }
      if (user?.role === 'PURCHASING_COORDINATOR') {
        paymentBatchApi.getScheduledPayments({ status: 'HELD_BELOW_100' })
          .then((r) => setPendingHeldCount(Number(r.data?.filtered_count ?? r.data?.payments?.length ?? 0)))
          .catch(() => setPendingHeldCount(0));
      } else {
        setPendingHeldCount(0);
      }
    } catch (error) {
      console.error('Failed to load scheduled payments:', error);
      setScheduledPayments([]);
      setFilteredTotals([]);
    }
  }, [filters, user?.id, user?.role]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([
        loadBatches(),
        loadScheduledPayments(),
        vendorApi.getAll().then((res) => {
          const vendors = (res.data || []).map((v: any) => ({ id: v.id, name: v.name }));
          setVendorList(vendors);
        }).catch(() => setVendorList([])),
      ]);
      setLoading(false);
    };
    init();
  }, [loadBatches, loadScheduledPayments]);

  const handleToggleSelect = async (paymentId: string) => {
    const payment = scheduledPayments.find(p => p.id === paymentId);
    if (!payment || !isBatchable(payment)) return;
    const isSelected = selectedPaymentIds.has(paymentId);
    setActionLoading(true);
    try {
      if (isSelected) {
        await paymentBatchApi.deselectPayments([paymentId]);
        setSelectedPaymentIds(prev => { const next = new Set(prev); next.delete(paymentId); return next; });
      } else {
        await paymentBatchApi.selectPayments([paymentId]);
        setSelectedPaymentIds(prev => { const next = new Set(prev); next.add(paymentId); return next; });
      }
    } catch (error: any) {
      console.error('Failed to toggle payment selection:', error);
      const msg = error?.response?.data?.error?.message || 'Failed to toggle payment selection';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExportQBBills = async () => {
    setQbExporting(true);
    try {
      const response = await qbApi.exportBills();
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qb-bills-${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      const count = Number(response.headers?.['x-qb-bill-count'] || 0);
      showToast(
        count > 0
          ? `${count} bill${count === 1 ? '' : 's'} exported for QuickBooks import`
          : 'QB Bills export downloaded (no posted invoices yet)',
        'success'
      );
    } catch (error: any) {
      let msg = 'Failed to export QB bills';
      if (error?.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const parsed = JSON.parse(text);
          msg = parsed?.error?.message || msg;
        } catch { /* use default msg */ }
      } else if (error?.response?.data?.error?.message) {
        msg = error.response.data.error.message;
      }
      showToast(msg, 'error');
    } finally {
      setQbExporting(false);
    }
  };

  const handleExportReconciliation = async () => {
    setReconExporting(true);
    try {
      const response = await paymentBatchApi.exportReconciliation();
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payment-reconciliation-${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Reconciliation Excel downloaded — totals include bank charges', 'success');
    } catch (error: any) {
      let msg = 'Failed to export reconciliation report';
      if (error?.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const parsed = JSON.parse(text);
          msg = parsed?.error?.message || msg;
        } catch { /* use default msg */ }
      } else if (error?.response?.data?.error?.message) {
        msg = error.response.data.error.message;
      }
      showToast(msg, 'error');
    } finally {
      setReconExporting(false);
    }
  };

  const handleSelectAll = async () => {
    const unselected = scheduledPayments.filter(p => isBatchable(p) && !selectedPaymentIds.has(p.id));
    if (unselected.length === 0) return;
    setActionLoading(true);
    try {
      await paymentBatchApi.selectPayments(unselected.map(p => p.id));
      setSelectedPaymentIds(new Set(scheduledPayments.map(p => p.id)));
    } catch (error: any) {
      console.error('Failed to select all payments:', error);
      const msg = error?.response?.data?.error?.message || 'Failed to select all payments';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeselectAll = async () => {
    if (selectedPaymentIds.size === 0) return;
    setActionLoading(true);
    try {
      await paymentBatchApi.deselectPayments(Array.from(selectedPaymentIds));
      setSelectedPaymentIds(new Set());
    } catch (error: any) {
      console.error('Failed to deselect all payments:', error);
      const msg = error?.response?.data?.error?.message || 'Failed to deselect all payments';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditRemarks = (payment: ScheduledPayment) => {
    setRemarksTarget(payment);
    setRemarksDraft(payment.remarks || '');
  };

  const handleSaveRemarks = async () => {
    if (!remarksTarget) return;
    setRemarksSaving(true);
    try {
      await paymentBatchApi.setPaymentRemarks(remarksTarget.id, remarksDraft);
      showToast('Remarks saved', 'success');
      setRemarksTarget(null);
      await loadScheduledPayments();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to save remarks';
      showToast(msg, 'error');
    } finally {
      setRemarksSaving(false);
    }
  };

  const handleMarkForPayment = async (payment: ScheduledPayment) => {
    setActionLoading(true);
    try {
      await paymentBatchApi.markForPayment(payment.id);
      showToast('Marked for payment — sent to supervisor review', 'success');
      await loadScheduledPayments();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to mark for payment';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveForPayment = async (payment: ScheduledPayment) => {
    setActionLoading(true);
    try {
      await paymentBatchApi.approveForPayment(payment.id);
      showToast('Payment approved — ready for the payment process', 'success');
      await loadScheduledPayments();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to approve payment';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveHeld = async (payment: ScheduledPayment) => {
    setActionLoading(true);
    try {
      await paymentBatchApi.approveHeld(payment.id);
      showToast('Release approved — payment is now scheduled and batchable', 'success');
      await loadScheduledPayments();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to approve release';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectForPayment = (payment: ScheduledPayment) => {
    // Opens the final-remarks modal — the supervisor's remarks are what the
    // Associate sees when the payment returns to SCHEDULED.
    setRejectTarget(payment);
    setRejectReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setProcessing(true);
    try {
      await paymentBatchApi.rejectForPayment(rejectTarget.id, rejectReason.trim());
      showToast('Payment returned to Accounting Associate', 'success');
      setRejectTarget(null);
      setRejectReason('');
      await loadScheduledPayments();
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to reject payment';
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleApproveAll = async (ids: string[]) => {
    if (ids.length === 0) return;
    setProcessing(true);
    try {
      await paymentBatchApi.bulkApproveForPayment(ids, approveAllNote.trim() || undefined);
      showToast(`${ids.length} payment${ids.length === 1 ? '' : 's'} approved — ready for the payment process`, 'success');
      setShowApproveAllModal(false);
      setApproveAllIds([]);
      setApproveAllNote('');
      // Leave the queue: show the freshly approved payments in the default view.
      setFilters((prev) => ({ ...prev, status: '' }));
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to bulk approve payments';
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenApproveAllFromBanner = async () => {
    setProcessing(true);
    try {
      const r = await paymentBatchApi.getScheduledPayments({ status: 'FOR_PAYMENT' });
      const ids = (r.data?.payments || []).map((p: any) => p.id);
      if (ids.length === 0) {
        showToast('No payments awaiting approval', 'error');
        return;
      }
      setApproveAllIds(ids);
      setApproveAllNote('');
      setShowApproveAllModal(true);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to load the review queue';
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleCreateBatch = async () => {
    if (selectedPaymentIds.size === 0) return;
    setProcessing(true);
    setActionMessage(null);
    try {
      const response = await paymentBatchApi.create(Array.from(selectedPaymentIds));
      const batchCount = Number(response.data?.batch_count || 1);
      const paymentCount = Number(response.data?.payment_count || selectedPaymentIds.size);
      await Promise.all([loadBatches(), loadScheduledPayments()]);
      setSelectedPaymentIds(new Set());
      setActiveTab('batches');
      setActionMessage({
        type: 'success',
        text: `${batchCount} compatible batch${batchCount === 1 ? '' : 'es'} created for ${paymentCount} payment${paymentCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      console.error('Failed to create batch:', error);
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error?.message || error.response?.data?.error || error.response?.data?.message
        : undefined;
      setActionMessage({ type: 'error', text: message || 'Unable to create payment batch. Refresh the schedule and try again.' });
    } finally {
      setProcessing(false);
    }
  };

  const chargedPayment = selectedBatch?.payments.find(p => p.bank_charge_amount != null) ?? null;

  const openBankChargeModal = () => {
    if (!selectedBatch) return;
    setBankChargeForm({
      paymentId: chargedPayment?.id || selectedBatch.payments[0]?.id || '',
      amount: chargedPayment?.bank_charge_amount != null ? String(chargedPayment.bank_charge_amount) : '',
      note: chargedPayment?.bank_charge_note || '',
    });
    setShowBankChargeModal(true);
  };

  const refreshSelectedBatch = async (batchId: string) => {
    const updated = await paymentBatchApi.getById(batchId);
    setSelectedBatch(mapBatchPayload(updated.data));
  };

  const handleApplyBankCharge = async () => {
    if (!selectedBatch || !bankChargeForm.paymentId) return;
    const amount = Number(bankChargeForm.amount);
    if (!isFinite(amount) || amount <= 0) {
      showToast('Enter a positive bank charge amount', 'error');
      return;
    }
    setBankChargeSaving(true);
    try {
      await paymentBatchApi.applyBankCharge(selectedBatch.id, bankChargeForm.paymentId, amount, bankChargeForm.note.trim() || undefined);
      showToast('Bank charge applied — included in batch total and exports', 'success');
      setShowBankChargeModal(false);
      await Promise.all([loadBatches(), refreshSelectedBatch(selectedBatch.id)]);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to apply bank charge';
      showToast(msg, 'error');
    } finally {
      setBankChargeSaving(false);
    }
  };

  const handleRemoveBankCharge = async () => {
    if (!selectedBatch || !chargedPayment) return;
    setBankChargeSaving(true);
    try {
      await paymentBatchApi.removeBankCharge(selectedBatch.id, chargedPayment.id);
      showToast('Bank charge removed — batch total restored', 'success');
      setShowBankChargeModal(false);
      await Promise.all([loadBatches(), refreshSelectedBatch(selectedBatch.id)]);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to remove bank charge';
      showToast(msg, 'error');
    } finally {
      setBankChargeSaving(false);
    }
  };

  const endorsedPayments = selectedBatch?.payments.filter(p => p.status === 'ENDORSED') ?? [];

  const openStubModal = (payment: Payment) => {
    const stub = payment.bill_stub;
    setStubTarget(payment);
    setStubForm({
      stubDate: stub?.stub_date ? new Date(stub.stub_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      type: stub?.type || 'Bank Transfer',
      reference: stub?.reference || '',
      originalAmount: stub?.original_amount != null ? String(stub.original_amount) : String(payment.amount),
      balance: stub?.balance != null ? String(stub.balance) : String(payment.amount),
      discount: stub?.discount != null ? String(stub.discount) : '',
      paidAmount: stub?.paid_amount != null ? String(stub.paid_amount) : String(payment.amount),
    });
    setStubFile(null);
  };

  const handleEndorse = async () => {
    if (!selectedBatch || !stubTarget) return;
    setStubSaving(true);
    try {
      await paymentBatchApi.endorseBillStub(selectedBatch.id, stubTarget.id, {
        stubDate: stubForm.stubDate,
        type: stubForm.type,
        reference: stubForm.reference,
        originalAmount: stubForm.originalAmount ? Number(stubForm.originalAmount) : undefined,
        balance: stubForm.balance ? Number(stubForm.balance) : undefined,
        discount: stubForm.discount ? Number(stubForm.discount) : undefined,
        paidAmount: stubForm.paidAmount ? Number(stubForm.paidAmount) : undefined,
        stubFile,
      });
      showToast('Bill stub endorsed — payment tagged ENDORSED (in payment process, not paid)', 'success');
      setStubTarget(null);
      await Promise.all([loadBatches(), refreshSelectedBatch(selectedBatch.id)]);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to endorse bill stub';
      showToast(msg, 'error');
    } finally {
      setStubSaving(false);
    }
  };

  const openMatchModal = () => {
    if (!selectedBatch) return;
    const endorsed = selectedBatch.payments.filter(p => p.status === 'ENDORSED');
    setMatchSelected(new Set(endorsed.map(p => p.id)));
    setMatchForm({ reference: '', amount: '', paidDate: new Date().toISOString().split('T')[0] });
    setShowMatchModal(true);
  };

  const handleMatch = async () => {
    if (!selectedBatch) return;
    if (matchSelected.size === 0 && !matchForm.reference.trim()) {
      showToast('Enter a confirmation reference or select at least one endorsed payment', 'error');
      return;
    }
    setMatchSaving(true);
    try {
      let payload: any = { paidDate: matchForm.paidDate };
      if (matchForm.reference.trim()) {
        payload.reference = matchForm.reference.trim();
        if (matchForm.amount) payload.amount = Number(matchForm.amount);
      } else {
        payload.paymentIds = Array.from(matchSelected);
      }
      const response = await paymentBatchApi.matchConfirmation(selectedBatch.id, payload);
      const matched = Number(response.data?.matched ?? 0);
      showToast(
        `${matched} payment${matched === 1 ? '' : 's'} matched and tagged PAID${response.data?.batch_processed ? ' — batch marked PROCESSED' : ''}`,
        'success'
      );
      setShowMatchModal(false);
      await Promise.all([loadBatches(), refreshSelectedBatch(selectedBatch.id)]);
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to match payment confirmation';
      showToast(msg, 'error');
    } finally {
      setMatchSaving(false);
    }
  };

  const handleProcessBatch = async (batchId: string) => {
    setProcessing(true);
    try {
      await paymentBatchApi.process(batchId, executionForm);
      await loadBatches();
      setSelectedBatch(null);
      setShowExecutionModal(false);
      setExecutionForm({ paidDate: new Date().toISOString().split('T')[0], reference: '', bankUsed: '', remarks: '', proof: null });
    } catch (error: any) {
      console.error('Failed to process batch:', error);
      const msg = error?.response?.data?.error?.message || 'Failed to process batch';
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleBatchAction = async (action: 'submit' | 'review' | 'return' | 'export', batchId: string) => {
    const reason = action === 'return' ? window.prompt('Reason for returning this batch to Accounting Associate:') : undefined;
    if (action === 'return' && !reason?.trim()) return;
    setProcessing(true);
    try {
      if (action === 'submit') await paymentBatchApi.submit(batchId);
      if (action === 'review') await paymentBatchApi.review(batchId);
      if (action === 'return') await paymentBatchApi.returnForCorrection(batchId, reason!.trim());
      if (action === 'export') await paymentBatchApi.markExported(batchId);
      await loadBatches();
      setSelectedBatch(null);
    } catch (error: any) {
      console.error(`Failed to ${action} batch:`, error);
      const msg = error?.response?.data?.error?.message || `Failed to ${action} batch`;
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleReturnSelect = (paymentId: string) => {
    setSelectedReturnPaymentIds(prev => {
      const next = new Set(prev);
      if (next.has(paymentId)) next.delete(paymentId);
      else next.add(paymentId);
      return next;
    });
  };

  const handleReturnInvoices = async () => {
    if (!selectedBatch || !returnReason.trim() || selectedReturnPaymentIds.size === 0) return;
    setProcessing(true);
    try {
      const result = await paymentBatchApi.returnInvoices(
        selectedBatch.id,
        Array.from(selectedReturnPaymentIds),
        returnReason.trim()
      );
      showToast(`${selectedReturnPaymentIds.size} invoice(s) returned for revision`, 'success');
      setShowReturnModal(false);
      setReturnReason('');
      setSelectedReturnPaymentIds(new Set());
      await loadBatches();
      // Reload the selected batch to reflect changes
      if (result.data?.batch_cancelled) {
        setSelectedBatch(null);
      } else {
        const updated = await paymentBatchApi.getById(selectedBatch.id);
        setSelectedBatch(mapBatchPayload(updated.data));
      }
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message || 'Failed to return invoices';
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleExportPerVendor = async (batchId: string) => {
    setProcessing(true);
    try {
      const response = await paymentBatchApi.exportPerVendor(batchId);
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedBatch?.batch_number || batchId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Excel file downloaded', 'success');
    } catch (error: any) {
      console.error('Failed to export:', error);
      // Error response is also a blob (since responseType: 'blob'), need to parse it
      let msg = 'Failed to export Excel file';
      if (error?.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const parsed = JSON.parse(text);
          msg = parsed?.error?.message || msg;
        } catch { /* use default msg */ }
      } else if (error?.response?.data?.error?.message) {
        msg = error.response.data.error.message;
      }
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelBatch = async () => {
    if (!selectedBatch || !cancelReason) return;
    setProcessing(true);
    try {
      await paymentBatchApi.cancel(selectedBatch.id, cancelReason);
      await loadBatches();
      setShowCancelModal(false);
      setCancelReason('');
      setSelectedBatch(null);
    } catch (error: any) {
      console.error('Failed to cancel batch:', error);
      const msg = error?.response?.data?.error?.message || 'Failed to cancel batch';
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const getStatusStyle = (status: string): React.CSSProperties => {
    switch (status) {
      case 'DRAFT':
        return { background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' };
      case 'PROCESSED':
        return { background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' };
      case 'CANCELLED':
        return { background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' };
      default:
        return { background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' };
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Clock className="h-4 w-4" />;
      case 'PROCESSED':
        return <CheckCircle className="h-4 w-4" />;
      case 'CANCELLED':
        return <X className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const getPaymentStatusStyle = (status: string): React.CSSProperties => {
    switch (status) {
      case 'FOR_PAYMENT':
        return { background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' };
      case 'APPROVED_FOR_PAYMENT':
        return { background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' };
      case 'SCHEDULED':
        return { background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' };
      case 'HELD_BELOW_100':
        return { background: 'color-mix(in srgb, var(--text-muted) 12%, transparent)', color: 'var(--text-muted)', border: '1px solid color-mix(in srgb, var(--text-muted) 25%, transparent)' };
      default:
        return { background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' };
    }
  };

  const getPaymentStatusLabel = (status: string) => {
    switch (status) {
      case 'FOR_PAYMENT': return 'For Payment';
      case 'APPROVED_FOR_PAYMENT': return 'Approved';
      case 'SCHEDULED': return 'Scheduled';
      case 'HELD_BELOW_100': return 'Held <$100';
      default: return status;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 animate-fade-in" style={{ background: 'var(--bg-base)' }}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: 'var(--accent-purple)' }} />
          <div className="h-10 w-10 rounded-full border-2 animate-spin" style={{ borderTopColor: 'var(--accent-purple)', borderRightColor: 'var(--accent-purple)', borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
        </div>
        <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading payment data...</p>
      </div>
    );
  }

  const overdueCount = scheduledPayments.filter(p => p.status === 'SCHEDULED' && (p.aging_days ?? 0) > 0).length;

  const selectedPayments = scheduledPayments.filter(p => selectedPaymentIds.has(p.id));
  const selectedTotal = selectedPayments.reduce((sum, p) => sum + p.amount, 0);
  const previewVendors = Array.from(new Set(selectedPayments.map(p => p.invoice.vendor.name))).filter(Boolean);

  const dateCell = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const filterLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, color: 'var(--text-muted)' };
  const filterInput: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' };
  const filterRangeInput: React.CSSProperties = { flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' };
  const emptyFilters = { vendorId: '', currency: '', dateFrom: '', dateTo: '', search: '', dueMonth: '', dueFrom: '', dueTo: '', invoiceDateFrom: '', invoiceDateTo: '', approvalFrom: '', approvalTo: '', brand: '', memo: '', category: '', aging: '', status: '' };

  return (
    <div className="space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('scheduled')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={
              activeTab === 'scheduled'
                ? { background: 'var(--accent-purple)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }
            }
          >
            <Calendar className="h-4 w-4" strokeWidth={1.75} />
            Scheduled Payments
            {scheduledPayments.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: activeTab === 'scheduled' ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)' }}>
                {scheduledPayments.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('batches')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={
              activeTab === 'batches'
                ? { background: 'var(--accent-purple)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }
            }
          >
            <Package className="h-4 w-4" strokeWidth={1.75} />
            Batches
            {stuckBatches.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--accent-red)', color: 'white' }}>
                {stuckBatches.length}
              </span>
            )}
            {batches.length > 0 && stuckBatches.length === 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: activeTab === 'batches' ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)' }}>
                {batches.length}
              </span>
            )}
          </button>
        </div>

        {actionMessage && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
            style={{
              color: actionMessage.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
              background: actionMessage.type === 'success'
                ? 'color-mix(in srgb, var(--accent-green) 10%, transparent)'
                : 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
              border: `1px solid ${actionMessage.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'}`,
            }}
          >
            {actionMessage.type === 'success'
              ? <CheckCircle className="h-4 w-4 shrink-0" />
              : <AlertCircle className="h-4 w-4 shrink-0" />}
            {actionMessage.text}
          </div>
        )}

        {/* Scheduled Payments Tab */}
        {activeTab === 'scheduled' && (
          <div className="rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Scheduled Payments</h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Select payments to include in a new batch</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSelectAll}
                    disabled={actionLoading || scheduledPayments.length === 0}
                    className="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                    Select All
                  </button>
                  <button
                    onClick={handleDeselectAll}
                    disabled={actionLoading || selectedPaymentIds.size === 0}
                    className="flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />
                    Deselect All
                  </button>
                  <button
                    onClick={handleExportQBBills}
                    disabled={qbExporting}
                    className="flex items-center px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    title="Download an Excel of posted invoices as QuickBooks bills (vendor, amount, memo, GL account, GL class) for manual import"
                    style={{ background: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}
                  >
                    {qbExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />}
                    Export QB Bills
                  </button>
                </div>
              </div>

              {overdueCount > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg" style={{ background: 'var(--accent-red)' }}>
                      <AlertCircle className="h-4 w-4 text-white" strokeWidth={1.75} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{overdueCount} scheduled payment{overdueCount === 1 ? '' : 's'} overdue — past the due date</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Filter the schedule to see all overdue payments and prioritize them for batching</div>
                    </div>
                  </div>
                  {filters.aging !== 'overdue' && (
                    <button
                      onClick={() => setFilters({ ...filters, aging: 'overdue', status: '' })}
                      className="px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                      style={{ background: 'var(--accent-red)', color: 'white' }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      View Overdue
                    </button>
                  )}
                </div>
              )}

              {isPurchasing && pendingHeldCount > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--text-muted) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--text-muted) 25%, transparent)' }}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg" style={{ background: 'var(--text-muted)' }}>
                      <DollarSign className="h-4 w-4 text-white" strokeWidth={1.75} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{pendingHeldCount} sub-$100 payment{pendingHeldCount === 1 ? '' : 's'} held — awaiting your approval</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Approve release so the payment can proceed for payment or be consolidated</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setFilters({ ...filters, status: 'HELD_BELOW_100' })}
                    className="px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                    style={{ background: 'var(--text-muted)', color: 'var(--bg-base)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    Open Held Queue
                  </button>
                </div>
              )}

              {isSupervisor && pendingReviewCount > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg" style={{ background: 'var(--accent-amber)' }}>
                      <Clock className="h-4 w-4 text-white" strokeWidth={1.75} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{pendingReviewCount} payment{pendingReviewCount === 1 ? '' : 's'} awaiting your approval</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Review and approve, or reject with a reason</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleOpenApproveAllFromBanner}
                      disabled={processing}
                      className="px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      style={{ background: 'var(--accent-green)', color: 'white' }}
                      onMouseEnter={(e) => { if (!processing) e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      {processing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 inline animate-spin" /> : <CheckCircle className="h-3.5 w-3.5 mr-1.5 inline" strokeWidth={2} />}
                      Approve All ({pendingReviewCount})
                    </button>
                    <button
                      onClick={() => setFilters({ ...filters, status: 'FOR_PAYMENT' })}
                      className="px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                      style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      Open Review Queue
                    </button>
                  </div>
                </div>
              )}

              {isSupervisor && filters.status === 'FOR_PAYMENT' && (() => {
                const queueRows = scheduledPayments.filter(p => p.status === 'FOR_PAYMENT');
                return queueRows.length > 0 && (
                  <div className="flex items-center justify-between p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--accent-green) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg" style={{ background: 'var(--accent-green)' }}>
                        <CheckCircle className="h-4 w-4 text-white" strokeWidth={1.75} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{queueRows.length} payment{queueRows.length === 1 ? '' : 's'} awaiting your approval</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Approve all at once — this is the final approval; only the payment process follows</div>
                      </div>
                    </div>
                    <button
                      onClick={() => { setApproveAllIds(queueRows.map(p => p.id)); setApproveAllNote(''); setShowApproveAllModal(true); }}
                      disabled={processing}
                      className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                      style={{ background: 'var(--accent-green)', color: 'white' }}
                      onMouseEnter={(e) => { if (!processing) e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                      Approve All ({queueRows.length})
                    </button>
                  </div>
                );
              })()}

              {/* Filters — essentials always visible, the rest behind "More filters" */}
              <div className="mb-4 rounded-xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Find payments</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setFilters(emptyFilters)}
                      className="flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <X className="h-3.5 w-3.5 mr-1" strokeWidth={1.75} />
                      Clear
                    </button>
                    <button
                      onClick={() => setShowMoreFilters(v => !v)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ background: showMoreFilters ? 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' : 'var(--bg-card)', color: showMoreFilters ? 'var(--accent-blue)' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                    >
                      {showMoreFilters ? <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} /> : <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      {showMoreFilters ? 'Hide extras' : 'More filters'}
                    </button>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-1 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-4">
                      <label style={filterLabel}>Search</label>
                      <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Invoice #, vendor, MPO, memo, brand" style={filterInput} />
                    </div>
                    <div className="md:col-span-2">
                      <label style={filterLabel}>Vendor</label>
                      <select value={filters.vendorId} onChange={(e) => setFilters({ ...filters, vendorId: e.target.value })} style={filterInput}>
                        <option value="">All vendors</option>
                        {vendorList.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label style={filterLabel}>Currency</label>
                      <select value={filters.currency} onChange={(e) => setFilters({ ...filters, currency: e.target.value })} style={filterInput}>
                        <option value="">All currencies</option>
                        {Array.from(new Set([...scheduledPayments.map(p => p.currency), 'USD', 'EUR', 'GBP', 'CNY', 'HKD'])).sort().map(currency => <option key={currency} value={currency}>{currency}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label style={filterLabel}>Status</label>
                      <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={filterInput}>
                        <option value="">Scheduled + Approved</option>
                        <option value="SCHEDULED">Scheduled</option>
                        <option value="FOR_PAYMENT">For Payment (supervisor review)</option>
                        <option value="APPROVED_FOR_PAYMENT">Approved for payment</option>
                        <option value="HELD_BELOW_100">Held below $100 (Purchasing review)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label style={filterLabel}>Aging</label>
                      <select value={filters.aging} onChange={(e) => setFilters({ ...filters, aging: e.target.value })} style={filterInput}>
                        <option value="">All aging</option>
                        <option value="overdue">Overdue (any)</option>
                        <option value="not-due">Not yet due</option>
                        <option value="0-30">0–30 days overdue</option>
                        <option value="31-60">31–60 days overdue</option>
                        <option value="60+">60+ days overdue</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-3">
                      <label style={filterLabel}>Due Month (Cut-off)</label>
                      <input type="month" value={filters.dueMonth} onChange={(e) => setFilters({ ...filters, dueMonth: e.target.value })} style={filterInput} />
                    </div>
                    <div className="md:col-span-9 hidden md:block text-xs" style={{ color: 'var(--text-muted)' }}>
                      Pick a month to see only payments due within that cut-off — the basis for the monthly batch.
                    </div>
                  </div>
                  {showMoreFilters && (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                      <div className="md:col-span-3">
                        <label style={filterLabel}>Due Date</label>
                        <div className="flex items-center gap-2">
                          <input type="date" value={filters.dueFrom} onChange={(e) => setFilters({ ...filters, dueFrom: e.target.value })} title="Due from" style={filterRangeInput} />
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>–</span>
                          <input type="date" value={filters.dueTo} onChange={(e) => setFilters({ ...filters, dueTo: e.target.value })} title="Due to" style={filterRangeInput} />
                        </div>
                      </div>
                      <div className="md:col-span-3">
                        <label style={filterLabel}>Manager Approved</label>
                        <div className="flex items-center gap-2">
                          <input type="date" value={filters.approvalFrom} onChange={(e) => setFilters({ ...filters, approvalFrom: e.target.value })} title="Approved from" style={filterRangeInput} />
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>–</span>
                          <input type="date" value={filters.approvalTo} onChange={(e) => setFilters({ ...filters, approvalTo: e.target.value })} title="Approved to" style={filterRangeInput} />
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label style={filterLabel}>Brand</label>
                        <input value={filters.brand} onChange={(e) => setFilters({ ...filters, brand: e.target.value })} placeholder="e.g. SAMPLE" style={filterInput} />
                      </div>
                      <div className="md:col-span-2">
                        <label style={filterLabel}>Memo Details</label>
                        <input value={filters.memo} onChange={(e) => setFilters({ ...filters, memo: e.target.value })} placeholder="Memo / description" style={filterInput} />
                      </div>
                      <div className="md:col-span-2">
                        <label style={filterLabel}>Split / Account</label>
                        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} style={filterInput}>
                          <option value="">All splits</option>
                          {Array.from(new Set(['SAMPLE', 'YARNS', 'TRIMS', ...scheduledPayments.map(p => p.category).filter((c): c is string => !!c)])).sort().map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Filtered totals — computed from only the filtered rows */}
              {filteredTotals.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="text-xs font-medium uppercase tracking-wider mr-1" style={{ color: 'var(--text-muted)' }}>Filtered total</span>
                  {filteredTotals.map((t) => (
                    <span key={t.currency} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}>
                      {t.currency} {t.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <span className="opacity-70 font-normal">· {t.count} invoice{t.count === 1 ? '' : 's'}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Selection summary bar */}
              {selectedPaymentIds.size > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--accent-purple) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg" style={{ background: 'var(--accent-purple)' }}>
                      <CheckSquare className="h-4 w-4 text-white" strokeWidth={1.75} />
                    </div>
                    <div>
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedPaymentIds.size} payment{selectedPaymentIds.size !== 1 ? 's' : ''} selected</span>
                      <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>Total: ${selectedTotal.toLocaleString()}</span>
                    </div>
                  </div>
                  {isAssociate && (
                    <button
                      onClick={handleCreateBatch}
                      disabled={processing}
                      className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                      style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                      onMouseEnter={(e) => { if (!processing) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                      onMouseLeave={(e) => { if (!processing) e.currentTarget.style.background = 'var(--accent-lime)'; }}
                    >
                      {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Package className="h-4 w-4 mr-2" />}
                      Create Batch
                    </button>
                  )}
                  {isSupervisor && (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      View-only access — Associate manages batches
                    </div>
                  )}
                </div>
              )}
              {selectedPaymentIds.size > 0 && (
                <div className="grid gap-2 mb-4">
                  <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <div className="font-semibold">One batch · {selectedPaymentIds.size} invoice{selectedPaymentIds.size === 1 ? '' : 's'} from {previewVendors.length} vendor{previewVendors.length === 1 ? '' : 's'}</div>
                    <div className="mt-1">Total {selectedPayments[0]?.currency || 'USD'} {selectedTotal.toLocaleString()}</div>
                    <div style={{ color: 'var(--text-muted)' }} className="mt-0.5">{previewVendors.slice(0, 4).join(', ')}{previewVendors.length > 4 ? ` +${previewVendors.length - 4} more` : ''}</div>
                  </div>
                </div>
              )}

              {scheduledPayments.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                  {filters.status === 'HELD_BELOW_100' ? (
                    <>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Held queue is clear — no sub-$100 payments awaiting Purchasing approval</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Sub-$100 payments held on posting appear here for the Purchasing Coordinator to release</p>
                    </>
                  ) : filters.status === 'FOR_PAYMENT' ? (
                    <>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Review queue is clear — no payments awaiting approval</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>New payments appear here when the Associate marks them for payment</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No scheduled payments available for batching</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Post invoices to QB and schedule payments first</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead style={{ background: 'var(--bg-elevated)' }}>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', width: '40px' }}></th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendor</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Memo / Brand</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Manager Approved</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Due Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Split</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Remarks</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Aging</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Open Balance</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Payment Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                      {scheduledPayments.map((payment) => {
                        const isSelected = selectedPaymentIds.has(payment.id);
                        return (
                          <tr
                            key={payment.id}
                            className="transition-colors cursor-pointer"
                            style={{ borderTop: '1px solid var(--border-subtle)', background: isSelected ? 'color-mix(in srgb, var(--accent-purple) 5%, transparent)' : 'transparent' }}
                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                            onClick={() => { if (isBatchable(payment)) handleToggleSelect(payment.id); }}
                          >
                            <td className="px-4 py-4">
                              <div className="flex items-center justify-center w-5 h-5 rounded border-2 transition-all" style={{
                                borderColor: isBatchable(payment) ? (isSelected ? 'var(--accent-purple)' : 'var(--border-color)') : 'var(--border-subtle)',
                                background: isSelected ? 'var(--accent-purple)' : 'transparent',
                                opacity: isBatchable(payment) ? 1 : 0.35,
                                cursor: isBatchable(payment) ? 'pointer' : 'not-allowed',
                              }}>
                                {isSelected && <CheckSquare className="h-3 w-3 text-white" strokeWidth={2.5} />}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{dateCell(payment.invoice_date)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{payment.invoice.invoice_number}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{payment.invoice.vendor.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{[payment.qb_memo, payment.brand].filter(Boolean).join(' · ') || '—'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{dateCell(payment.approval_date)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{dateCell(payment.due_date)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{payment.category || '—'}</td>
                            <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)', maxWidth: 240 }}>
                              <div className="truncate" title={payment.remarks || ''}>{payment.remarks || '—'}</div>
                              {payment.supervisor_note && (
                                <div className="text-[11px] mt-0.5" style={{ color: payment.supervisor_action === 'FOR_PAYMENT_REJECTED' ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                                  {payment.supervisor_action === 'FOR_PAYMENT_REJECTED' ? `Rejected: ${payment.supervisor_note}` : `Supervisor: ${payment.supervisor_note}`}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: payment.aging_days !== null && payment.aging_days !== undefined && payment.aging_days > 0 ? 'var(--accent-red)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                              {payment.aging_days !== null && payment.aging_days !== undefined ? (payment.aging_days < 0 ? `${Math.abs(payment.aging_days)}d to due` : `${payment.aging_days}d overdue`) : '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{payment.currency} {payment.open_balance.toLocaleString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{payment.currency} {payment.amount.toLocaleString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                              <span className="inline-flex items-center gap-1.5">
                                {new Date(payment.payment_date).toLocaleDateString()}
                                {payment.payment_date_source === 'DUE_DATE' && (
                                  <span title="Payment date = invoice due date (auto-scheduled on posting)" style={{ display: 'inline-flex', cursor: 'help' }}>
                                    <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: 'var(--accent-blue)' }} />
                                  </span>
                                )}
                                {payment.payment_date_source === 'MANUAL' && (
                                  <span title="Payment date set manually" style={{ display: 'inline-flex', cursor: 'help' }}>
                                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: 'var(--accent-amber)' }} />
                                  </span>
                                )}
                                {payment.payment_date_source === 'DEFAULT' && (
                                  <span title="Payment date = posting date (invoice has no due date)" style={{ display: 'inline-flex', cursor: 'help' }}>
                                    <Clock className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: 'var(--text-muted)' }} />
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={getPaymentStatusStyle(payment.status)}>
                                  {getPaymentStatusLabel(payment.status)}
                                </span>
                                {isSelected && <span className="text-[11px] font-medium" style={{ color: 'var(--accent-purple)' }}>Selected</span>}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {isAssociate && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleEditRemarks(payment); }}
                                      className="p-1.5 rounded-lg transition-colors"
                                      title="Edit remarks"
                                      style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
                                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                                    >
                                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                                    </button>
                                    {payment.status === 'SCHEDULED' && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleMarkForPayment(payment); }}
                                        disabled={actionLoading}
                                        className="px-2 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                                        style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}
                                      >
                                        Mark for Payment
                                      </button>
                                    )}
                                  </>
                                )}
                                {isPurchasing && payment.status === 'HELD_BELOW_100' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleApproveHeld(payment); }}
                                    disabled={actionLoading}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                                    style={{ background: 'var(--accent-green)', color: 'white' }}
                                  >
                                    Approve Release
                                  </button>
                                )}
                                {isSupervisor && payment.status === 'FOR_PAYMENT' && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleApproveForPayment(payment); }}
                                      disabled={actionLoading}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                                      style={{ background: 'var(--accent-green)', color: 'white' }}
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleRejectForPayment(payment); }}
                                      disabled={actionLoading}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                                      style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Batches Tab */}
        {activeTab === 'batches' && (
        <div className="rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Payment Batches</h2>
              <button
                onClick={handleExportReconciliation}
                disabled={reconExporting}
                className="flex items-center px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                title="Download the payment reconciliation Excel (Payments + Bank Charges + Batches sheets; totals include batch-level bank charges)"
                style={{ background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}
              >
                {reconExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.75} />}
                Export Reconciliation
              </button>
            </div>

            {/* Stuck-batch alert — EXPORTED_TO_BANK batches whose payments haven't been endorsed or confirmed PAID */}
            {stuckBatches.length > 0 && (
              <div className="mb-4 p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--accent-red)' }}>
                    <AlertCircle className="h-4 w-4" strokeWidth={1.75} />
                    {stuckBatches.length} batch{stuckBatches.length === 1 ? '' : 'es'} stuck at EXPORTED_TO_BANK
                  </p>
                  {stuckLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--text-muted)' }} />}
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Payments not endorsed (bill stub) or confirmed PAID past the alert window. Open a batch to endorse the stubs and match the payment confirmation.
                </p>
                <div className="space-y-2">
                  {stuckBatches.map((sb) => (
                    <div key={sb.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-red) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 15%, transparent)' }}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{sb.batch_number}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {sb.pending_payments ?? 0} payment{(sb.pending_payments ?? 0) === 1 ? '' : 's'} pending · {sb.days_stuck ?? 0} day{(sb.days_stuck ?? 0) === 1 ? '' : 's'} stuck · {sb.payment_count} payment{(sb.payment_count || 0) === 1 ? '' : 's'} · ${sb.total_amount.toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => { setSelectedBatch(sb); setSelectedReturnPaymentIds(new Set()); }}
                        className="shrink-0 flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        style={{ background: 'var(--accent-red)', color: 'white' }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                      >
                        <Play className="h-3 w-3 mr-1.5" strokeWidth={2} />
                        Open & Complete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {batches.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No payment batches found</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Select scheduled payments and create a batch first</p>
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between p-4 rounded-xl cursor-pointer transition-colors"
                    style={{ border: '1px solid var(--border-color)', background: 'var(--bg-elevated)' }}
                    onClick={() => { setSelectedBatch(batch); setSelectedReturnPaymentIds(new Set()); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="p-2 rounded-lg" style={getStatusStyle(batch.status)}>
                        {getStatusIcon(batch.status)}
                      </div>
                      <div>
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{batch.batch_number}</div>
                        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {batch.payment_count} payments • ${batch.total_amount.toLocaleString()}
                          {batch.payments.some(p => p.bank_charge_amount != null) && (
                            <span className="ml-2 text-[11px] font-medium" style={{ color: 'var(--accent-amber)' }}>incl. bank charge</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={getStatusStyle(batch.status)}>
                        {batch.status}
                      </div>
                      <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{new Date(batch.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        {selectedBatch && (
          <div className="rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Batch Details: {selectedBatch.batch_number}</h2>
                <button onClick={() => setSelectedBatch(null)} className="transition-colors" style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <X className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Amount (incl. bank charge)</div>
                  <div className="text-2xl font-bold flex items-center" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    <DollarSign className="h-5 w-5 mr-1" strokeWidth={1.75} />
                    {selectedBatch.total_amount.toLocaleString()}
                  </div>
                </div>
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Bank Charge</div>
                  {chargedPayment ? (
                    <>
                      <div className="text-2xl font-bold" style={{ color: 'var(--accent-amber)', fontVariantNumeric: 'tabular-nums' }}>
                        {chargedPayment.currency} {Number(chargedPayment.bank_charge_amount).toLocaleString()}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }} title={chargedPayment.bank_charge_note || ''}>
                        on {chargedPayment.invoice.invoice_number}
                      </div>
                    </>
                  ) : (
                    <div className="text-lg font-medium mt-1" style={{ color: 'var(--text-muted)' }}>—</div>
                  )}
                </div>
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Payment Count</div>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{selectedBatch.payment_count}</div>
                </div>
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Status</div>
                  <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium mt-1" style={getStatusStyle(selectedBatch.status)}>
                    {getStatusIcon(selectedBatch.status)}
                    <span className="ml-1">{selectedBatch.status}</span>
                  </div>
                </div>
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Created</div>
                  <div className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{new Date(selectedBatch.created_at).toLocaleString()}</div>
                </div>
              </div>

              {(['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(selectedBatch.status)) && isAssociate && (
                <div className="flex items-center space-x-3 mb-6">
                  <button onClick={openBankChargeModal} disabled={processing}
                    className="flex items-center px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold"
                    style={{ background: chargedPayment ? 'color-mix(in srgb, var(--accent-amber) 15%, transparent)' : 'var(--accent-amber)', color: chargedPayment ? 'var(--accent-amber)' : 'var(--bg-base)', border: chargedPayment ? '1px solid var(--accent-amber)' : 'none' }}
                    onMouseEnter={(e) => { if (!processing) e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { if (!processing) e.currentTarget.style.opacity = '1'; }}
                  >
                    <DollarSign className="h-4 w-4 mr-2" strokeWidth={1.75} />
                    {chargedPayment ? `Bank Charge: ${chargedPayment.currency} ${Number(chargedPayment.bank_charge_amount).toLocaleString()} (Edit)` : 'Apply Bank Charge'}
                  </button>
                  <button onClick={() => handleBatchAction('submit', selectedBatch.id)} disabled={processing}
                    className="flex items-center px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold"
                    style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                    onMouseEnter={(e) => { if (!processing) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                    onMouseLeave={(e) => { if (!processing) e.currentTarget.style.background = 'var(--accent-lime)'; }}
                  >
                    {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                    Submit for Supervisor Review
                  </button>
                  <button onClick={() => setShowCancelModal(true)} disabled={processing}
                    className="flex items-center px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 text-sm font-medium"
                    style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}
                    onMouseEnter={(e) => { if (!processing) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                    onMouseLeave={(e) => { if (!processing) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                  >
                    <X className="h-4 w-4 mr-2" strokeWidth={1.75} />
                    Cancel Batch
                  </button>
                </div>
              )}

              {selectedBatch.status === 'PENDING_SUPERVISOR_REVIEW' && isSupervisor && (
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => handleBatchAction('review', selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-green)', color: 'white' }}>Mark Reviewed</button>
                  <button onClick={() => handleBatchAction('return', selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}>Return for Correction</button>
                </div>
              )}

              {selectedBatch.status === 'REVIEWED' && isSupervisor && (
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => handleExportPerVendor(selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: 'var(--accent-blue)', color: 'white' }}>
                    <Paperclip className="h-4 w-4" strokeWidth={1.75} />
                    {processing ? 'Exporting...' : 'Export Batch (Excel)'}
                  </button>
                  <button onClick={() => handleBatchAction('export', selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-purple)', color: 'white' }}>Mark Exported to Bank</button>
                </div>
              )}

              {selectedBatch.status === 'REVIEWED' && isAssociate && (
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => handleExportPerVendor(selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: 'var(--accent-blue)', color: 'white' }}>
                    <Paperclip className="h-4 w-4" strokeWidth={1.75} />
                    {processing ? 'Exporting...' : 'Export Batch (Excel)'}
                  </button>
                  {isSupervisor && (
                    <button onClick={() => handleBatchAction('export', selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-purple)', color: 'white' }}>Mark Exported to Bank</button>
                  )}
                </div>
              )}

              {(isAssociate || isSupervisor) && ['REVIEWED', 'EXPORTED_TO_BANK'].includes(selectedBatch.status) && endorsedPayments.length > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl mb-6" style={{ background: 'color-mix(in srgb, var(--accent-green) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }}>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{endorsedPayments.length} endorsed payment{endorsedPayments.length === 1 ? '' : 's'}</span>
                    <span className="ml-1">— tag PAID when the payment confirmation matches (by reference; amount as tiebreak)</span>
                  </div>
                  <button onClick={openMatchModal} disabled={processing} className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50" style={{ background: 'var(--accent-green)', color: 'white' }}
                    onMouseEnter={(e) => { if (!processing) e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />}
                    Match Payment Confirmation
                  </button>
                </div>
              )}

              {(selectedBatch.vendor_bill_stubs?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <h3 className="text-md font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Vendor Bill Stubs</h3>
                  <div className="space-y-2">
                    {selectedBatch.vendor_bill_stubs!.map((stub) => (
                      <div key={stub.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-subtle)' }}>
                        <div><div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{stub.vendor?.name || 'Vendor'}</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{stub.lines.length} invoice line{stub.lines.length === 1 ? '' : 's'} · {stub.status} · {stub.payment_reference || 'No reference'}</div></div>
                        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{stub.currency} {stub.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <h3 className="text-md font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Payments in Batch</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead style={{ background: 'var(--bg-elevated)' }}>
                    <tr>
                      {['DRAFT', 'RETURNED_FOR_CORRECTION', 'PENDING_SUPERVISOR_REVIEW'].includes(selectedBatch.status) && (
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', width: '40px' }}>
                          <div className="flex items-center justify-center w-5 h-5 rounded border-2 transition-all cursor-pointer" style={{
                            borderColor: selectedReturnPaymentIds.size === selectedBatch.payments.length && selectedBatch.payments.length > 0 ? 'var(--accent-amber)' : 'var(--border-color)',
                            background: selectedReturnPaymentIds.size === selectedBatch.payments.length && selectedBatch.payments.length > 0 ? 'var(--accent-amber)' : 'transparent',
                          }} onClick={() => {
                            if (selectedReturnPaymentIds.size === selectedBatch.payments.length) {
                              setSelectedReturnPaymentIds(new Set());
                            } else {
                              setSelectedReturnPaymentIds(new Set(selectedBatch.payments.map(p => p.id)));
                            }
                          }}>
                            {selectedReturnPaymentIds.size === selectedBatch.payments.length && selectedBatch.payments.length > 0 && <CheckSquare className="h-3 w-3 text-white" strokeWidth={2.5} />}
                          </div>
                        </th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Bank Charge</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Scheduled Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Execution</th>
                      {['REVIEWED', 'EXPORTED_TO_BANK'].includes(selectedBatch.status) && (
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBatch.payments.map((payment, idx) => {
                      const isReturnSelected = selectedReturnPaymentIds.has(payment.id);
                      const canReturn = ['DRAFT', 'RETURNED_FOR_CORRECTION', 'PENDING_SUPERVISOR_REVIEW'].includes(selectedBatch.status);
                      return (
                      <tr key={payment.id} className="transition-colors" style={{ borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none', background: isReturnSelected ? 'color-mix(in srgb, var(--accent-amber) 5%, transparent)' : '' }}
                        onMouseEnter={(e) => { if (!isReturnSelected) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                        onMouseLeave={(e) => { if (!isReturnSelected) e.currentTarget.style.background = ''; }}
                      >
                        {canReturn && (
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-center w-5 h-5 rounded border-2 transition-all cursor-pointer" style={{
                              borderColor: isReturnSelected ? 'var(--accent-amber)' : 'var(--border-color)',
                              background: isReturnSelected ? 'var(--accent-amber)' : 'transparent',
                            }} onClick={() => handleToggleReturnSelect(payment.id)}>
                              {isReturnSelected && <CheckSquare className="h-3 w-3 text-white" strokeWidth={2.5} />}
                            </div>
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{payment.invoice.invoice_number}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{payment.invoice.vendor.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{payment.currency} {payment.amount.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {payment.bank_charge_amount != null ? (
                            <span title={payment.bank_charge_note || 'Bank charge — one per vendor per batch, on a single invoice'} style={{ display: 'inline-flex', cursor: 'help' }}>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                                {payment.currency} {Number(payment.bank_charge_amount).toLocaleString()}
                              </span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <span className="inline-flex items-center gap-1.5">
                            {new Date(payment.scheduled_date).toLocaleDateString()}
                            {payment.payment_date_source === 'DUE_DATE' && (
                              <span title={`Payment date = invoice due date${payment.invoice.due_date ? ` (${new Date(payment.invoice.due_date).toLocaleDateString()})` : ''} — auto-scheduled on posting`} style={{ display: 'inline-flex', cursor: 'help' }}>
                                <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: 'var(--accent-blue)' }} />
                              </span>
                            )}
                            {payment.payment_date_source === 'MANUAL' && (
                              <span title="Payment date set manually" style={{ display: 'inline-flex', cursor: 'help' }}>
                                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: 'var(--accent-amber)' }} />
                              </span>
                            )}
                            {payment.payment_date_source === 'DEFAULT' && (
                              <span title="Payment date = posting date (invoice has no due date)" style={{ display: 'inline-flex', cursor: 'help' }}>
                                <Clock className="h-3.5 w-3.5" strokeWidth={1.75} style={{ color: 'var(--text-muted)' }} />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={getStatusStyle(payment.status)}>{payment.status}</span>
                        </td>
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          <div className="space-y-1">
                            {payment.bill_stub && (
                              <div className="space-y-0.5 p-2 rounded-lg mb-1" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 18%, transparent)' }}>
                                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-amber)' }}>Bill Stub {payment.status === 'ENDORSED' ? '· ENDORSED' : ''}</div>
                                {payment.bill_stub.type && <div>Type: {payment.bill_stub.type}</div>}
                                {payment.bill_stub.reference && <div>Ref: {payment.bill_stub.reference}</div>}
                                {payment.bill_stub.stub_date && <div>Stub date: {new Date(payment.bill_stub.stub_date).toLocaleDateString()}</div>}
                                {payment.bill_stub.original_amount != null && <div>Original: {payment.currency} {Number(payment.bill_stub.original_amount).toLocaleString()}</div>}
                                {payment.bill_stub.discount != null && Number(payment.bill_stub.discount) > 0 && <div>Discount: {payment.currency} {Number(payment.bill_stub.discount).toLocaleString()}</div>}
                                {payment.bill_stub.balance != null && <div>Balance: {payment.currency} {Number(payment.bill_stub.balance).toLocaleString()}</div>}
                                {payment.bill_stub.paid_amount != null && <div>Payment: {payment.currency} {Number(payment.bill_stub.paid_amount).toLocaleString()}</div>}
                                {payment.bill_stub.proof_file_url && (
                                  <a href={payment.bill_stub.proof_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: 'var(--accent-purple)' }}>
                                    <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                                    {payment.bill_stub.proof_file_name || 'Stub file'}
                                  </a>
                                )}
                              </div>
                            )}
                            {payment.reference && <div>Ref: {payment.reference}</div>}
                            {payment.bank_used && <div>Bank: {payment.bank_used}</div>}
                            {payment.paid_at && <div>Paid: {new Date(payment.paid_at).toLocaleDateString()}</div>}
                            {payment.proof_file_url && (
                              <a href={payment.proof_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: 'var(--accent-purple)' }}>
                                <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                                {payment.proof_file_name || 'Proof'}
                              </a>
                            )}
                            {!payment.bill_stub && !payment.reference && !payment.paid_at && !payment.proof_file_url && <span>Pending</span>}
                          </div>
                        </td>
                        {['REVIEWED', 'EXPORTED_TO_BANK'].includes(selectedBatch.status) && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            {['SCHEDULED', 'APPROVED_FOR_PAYMENT'].includes(payment.status) && (
                              <button
                                onClick={() => openStubModal(payment)}
                                disabled={processing}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                                style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                              >
                                Endorse Bill Stub
                              </button>
                            )}
                            {payment.status === 'ENDORSED' && (
                              <button
                                onClick={() => openStubModal(payment)}
                                disabled={processing}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50"
                                style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}
                              >
                                Edit Stub
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Per-invoice return action bar */}
              {['DRAFT', 'RETURNED_FOR_CORRECTION', 'PENDING_SUPERVISOR_REVIEW'].includes(selectedBatch.status) && selectedReturnPaymentIds.size > 0 && (
                <div className="mt-4 flex items-center justify-between p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>
                    {selectedReturnPaymentIds.size} invoice{selectedReturnPaymentIds.size === 1 ? '' : 's'} selected for return to revision
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedReturnPaymentIds(new Set())} className="px-3 py-2 text-sm transition-colors" style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >Clear</button>
                    <button onClick={() => setShowReturnModal(true)} disabled={processing}
                      className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                      style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                      onMouseEnter={(e) => { if (!processing) e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" strokeWidth={1.75} />
                      Return for Revision
                    </button>
                  </div>
                </div>
              )}

              {selectedBatch.cancellation_reason && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--accent-red)' }}>Cancellation Reason</div>
                  <div className="text-sm" style={{ color: 'var(--accent-red)', opacity: 0.8 }}>{selectedBatch.cancellation_reason}</div>
                </div>
              )}
              {selectedBatch.return_reason && (
                <div className="mt-4 p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid var(--accent-amber)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Supervisor Return Reason</div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{selectedBatch.return_reason}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {showCancelModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Cancel Payment Batch</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Are you sure you want to cancel batch {selectedBatch?.batch_number}? This will unlink all payments from the batch.</p>
              <div className="mb-4">
                <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Cancellation Reason</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  rows={3}
                  placeholder="Enter reason for cancellation..."
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button onClick={() => { setShowCancelModal(false); setCancelReason(''); }} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >Cancel</button>
                <button onClick={handleCancelBatch} disabled={!cancelReason || processing} className="px-4 py-2 text-white rounded-xl transition-colors disabled:opacity-50 text-sm font-medium" style={{ background: 'var(--accent-red)' }}
                  onMouseEnter={(e) => { if (cancelReason && !processing) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >Confirm Cancellation</button>
              </div>
            </div>
          </div>
        )}

        {showReturnModal && selectedBatch && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Return Invoices for Revision</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                Return {selectedReturnPaymentIds.size} invoice{selectedReturnPaymentIds.size === 1 ? '' : 's'} from batch {selectedBatch.batch_number} back to Accounting for revision?
                The invoice(s) will be unlinked from this batch and reset to <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>PENDING_ACCOUNTING</span> status.
              </p>
              <div className="mb-4">
                <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Return Reason</label>
                <textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  rows={3}
                  placeholder="Enter reason for returning these invoices..."
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button onClick={() => { setShowReturnModal(false); setReturnReason(''); }} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >Cancel</button>
                <button onClick={handleReturnInvoices} disabled={!returnReason.trim() || processing} className="px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold" style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                  onMouseEnter={(e) => { if (returnReason.trim() && !processing) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Return ${selectedReturnPaymentIds.size} Invoice${selectedReturnPaymentIds.size === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {remarksTarget && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Invoice Remarks</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                {remarksTarget.invoice.invoice_number} · {remarksTarget.invoice.vendor.name} — only the Accounting Associate can edit remarks.
              </p>
              <textarea
                value={remarksDraft}
                onChange={(e) => setRemarksDraft(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', resize: 'vertical' }}
                placeholder="Add remarks for this invoice (e.g. lab testing to consolidate, bank charge to apply...)"
              />
              <div className="flex justify-end space-x-3 mt-4">
                <button onClick={() => setRemarksTarget(null)} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >Cancel</button>
                <button onClick={handleSaveRemarks} disabled={remarksSaving} className="px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-medium" style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}>
                  {remarksSaving ? 'Saving...' : 'Save Remarks'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showExecutionModal && selectedBatch && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-lg w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Execute Payment Batch</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{selectedBatch.batch_number} | {selectedBatch.payment_count} payments | ${selectedBatch.total_amount.toLocaleString()}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Paid date</label>
                  <input type="date" value={executionForm.paidDate} onChange={(e) => setExecutionForm({ ...executionForm, paidDate: e.target.value })} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Reference / check no.</label>
                  <input value={executionForm.reference} onChange={(e) => setExecutionForm({ ...executionForm, reference: e.target.value })} placeholder="Bank reference" className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bank used</label>
                  <input value={executionForm.bankUsed} onChange={(e) => setExecutionForm({ ...executionForm, bankUsed: e.target.value })} placeholder="Bank / payment channel" className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Proof of payment</label>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setExecutionForm({ ...executionForm, proof: e.target.files?.[0] || null })} className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Remarks</label>
                  <textarea value={executionForm.remarks} onChange={(e) => setExecutionForm({ ...executionForm, remarks: e.target.value })} rows={3} placeholder="Optional notes" className="w-full px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-5">
                <button onClick={() => setShowExecutionModal(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
                <button onClick={() => handleProcessBatch(selectedBatch.id)} disabled={processing || !executionForm.paidDate} className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}>
                  {processing ? 'Processing...' : 'Confirm Paid'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showBankChargeModal && selectedBatch && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{chargedPayment ? 'Edit Bank Charge' : 'Apply Bank Charge'}</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                One bank charge per vendor per batch, on a <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>single invoice</span>. Duplicates are blocked — remove the current charge before moving it to another invoice.
              </p>
              {chargedPayment && (
                <div className="mb-4 p-3 rounded-lg text-xs" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)', color: 'var(--accent-amber)' }}>
                  Current charge: {chargedPayment.currency} {Number(chargedPayment.bank_charge_amount).toLocaleString()} on {chargedPayment.invoice.invoice_number}
                </div>
              )}
              <div className="mb-3">
                <label style={filterLabel}>Invoice carrying the charge</label>
                <select value={bankChargeForm.paymentId} onChange={(e) => setBankChargeForm({ ...bankChargeForm, paymentId: e.target.value })} style={filterInput}>
                  {selectedBatch.payments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.invoice.invoice_number} — {p.invoice.vendor.name} ({p.currency} {Number(p.amount).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label style={filterLabel}>Bank charge amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={bankChargeForm.amount}
                  onChange={(e) => setBankChargeForm({ ...bankChargeForm, amount: e.target.value })}
                  placeholder="0.00"
                  style={filterInput}
                />
              </div>
              <div className="mb-4">
                <label style={filterLabel}>Note (optional)</label>
                <textarea
                  value={bankChargeForm.note}
                  onChange={(e) => setBankChargeForm({ ...bankChargeForm, note: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', resize: 'vertical' }}
                  placeholder="e.g. wire fee, bank fee for this batch"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                {chargedPayment ? (
                  <button onClick={handleRemoveBankCharge} disabled={bankChargeSaving} className="px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                    {bankChargeSaving ? 'Removing...' : 'Remove Charge'}
                  </button>
                ) : <span />}
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowBankChargeModal(false)} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >Cancel</button>
                  <button onClick={handleApplyBankCharge} disabled={bankChargeSaving} className="px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold" style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                    onMouseEnter={(e) => { if (!bankChargeSaving) e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    {bankChargeSaving ? 'Saving...' : chargedPayment ? 'Update Charge' : 'Apply Charge'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {stubTarget && (
          <div className="fixed inset-0 flex items-center justify-center z-50 animate-backdrop" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
            <div className="max-w-lg w-full mx-2 sm:mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
              <div className="p-6">
                {/* Header with close */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Endorse Bill Stub</h3>
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {stubTarget.invoice.invoice_number} · {stubTarget.invoice.vendor.name}
                    </p>
                  </div>
                  <button onClick={() => setStubTarget(null)} className="p-1 rounded-lg transition-colors shrink-0" style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Endorsement note */}
                <p className="text-xs mb-5 p-3 rounded-xl leading-relaxed" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 18%, transparent)', color: 'var(--text-secondary)' }}>
                  Endorsing tags the payment <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>ENDORSED</span> (in payment process, <strong>NOT paid</strong>). PAID comes only when the payment confirmation matches by reference.
                </p>

                {/* Stub date + type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label style={filterLabel}>Stub Date</label>
                    <input type="date" value={stubForm.stubDate} onChange={(e) => setStubForm({ ...stubForm, stubDate: e.target.value })} style={filterInput} />
                  </div>
                  <div>
                    <label style={filterLabel}>Type</label>
                    <select value={stubForm.type} onChange={(e) => setStubForm({ ...stubForm, type: e.target.value })} style={filterInput}>
                      <option>Bank Transfer</option>
                      <option>Wire</option>
                      <option>Cheque</option>
                      <option>Other</option>
                    </select>
                  </div>
                </div>

                {/* Reference — full width, it drives the confirmation match */}
                <div className="mb-4">
                  <label style={filterLabel}>Reference</label>
                  <input value={stubForm.reference} onChange={(e) => setStubForm({ ...stubForm, reference: e.target.value })} placeholder="Bank ref / stub ref — used to match the payment confirmation" style={filterInput} />
                </div>

                {/* Amounts — 2x2 grid, currency as its own segment (never overlaps the amount) */}
                <div className="grid grid-cols-2 gap-4 mb-1.5">
                  <div>
                    <label style={filterLabel}>Original Amount</label>
                    <div
                      className="flex items-stretch overflow-hidden rounded-lg transition-colors"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    >
                      <span className="flex items-center px-2.5 text-xs font-medium shrink-0" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--input-border)' }}>{stubTarget.currency || 'USD'}</span>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={stubForm.originalAmount} onChange={(e) => setStubForm({ ...stubForm, originalAmount: e.target.value })} className="w-full focus:outline-none" style={{ background: 'transparent', border: 'none', padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                  <div>
                    <label style={filterLabel}>Payment</label>
                    <div
                      className="flex items-stretch overflow-hidden rounded-lg transition-colors"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    >
                      <span className="flex items-center px-2.5 text-xs font-medium shrink-0" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--input-border)' }}>{stubTarget.currency || 'USD'}</span>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={stubForm.paidAmount} onChange={(e) => setStubForm({ ...stubForm, paidAmount: e.target.value })} className="w-full focus:outline-none" style={{ background: 'transparent', border: 'none', padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                  <div>
                    <label style={filterLabel}>Discount</label>
                    <div
                      className="flex items-stretch overflow-hidden rounded-lg transition-colors"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    >
                      <span className="flex items-center px-2.5 text-xs font-medium shrink-0" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--input-border)' }}>{stubTarget.currency || 'USD'}</span>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={stubForm.discount} onChange={(e) => setStubForm({ ...stubForm, discount: e.target.value })} className="w-full focus:outline-none" style={{ background: 'transparent', border: 'none', padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                  <div>
                    <label style={filterLabel}>Balance</label>
                    <div
                      className="flex items-stretch overflow-hidden rounded-lg transition-colors"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    >
                      <span className="flex items-center px-2.5 text-xs font-medium shrink-0" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--input-border)' }}>{stubTarget.currency || 'USD'}</span>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={stubForm.balance} onChange={(e) => setStubForm({ ...stubForm, balance: e.target.value })} className="w-full focus:outline-none" style={{ background: 'transparent', border: 'none', padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                </div>
                <p className="text-[11px] mb-4" style={{ color: 'var(--text-muted)' }}>Balance = Original − Discount · Payment is the amount paid on this stub</p>

                {/* File — styled dropzone with chosen file name */}
                <div className="mb-5">
                  <label style={filterLabel}>Bill stub file (optional)</label>
                  <label
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                    style={{ background: 'var(--input-bg)', border: '1px dashed var(--border-color)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-amber)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    <span className="flex items-center gap-2 text-sm truncate" style={{ color: stubFile ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      <Paperclip className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      {stubFile ? stubFile.name : 'Choose file (PDF, PNG, JPG)'}
                    </span>
                    <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setStubFile(e.target.files?.[0] || null)} />
                    {stubFile && (
                      <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)', color: 'var(--accent-lime)' }}>
                        Attached
                      </span>
                    )}
                  </label>
                </div>

                {/* Actions */}
                <div className="flex justify-end space-x-3">
                  <button onClick={() => setStubTarget(null)} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >Cancel</button>
                  <button onClick={handleEndorse} disabled={stubSaving} className="flex items-center px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold" style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                    onMouseEnter={(e) => { if (!stubSaving) e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    {stubSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {stubSaving ? 'Endorsing...' : 'Endorse Bill Stub'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showMatchModal && selectedBatch && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-lg w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Match Payment Confirmation</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                The system matches <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>ENDORSED</span> payments by <strong>reference</strong> (amount as tiebreak — two vendors can share the same processed amount). Enter the confirmation reference below, or select the payments explicitly (e.g. from the exported Excel file).
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label style={filterLabel}>Confirmation Reference</label>
                  <input value={matchForm.reference} onChange={(e) => setMatchForm({ ...matchForm, reference: e.target.value })} placeholder="Bank confirmation reference" style={filterInput} />
                </div>
                <div>
                  <label style={filterLabel}>Amount (tiebreak, optional)</label>
                  <input type="number" min="0" step="0.01" value={matchForm.amount} onChange={(e) => setMatchForm({ ...matchForm, amount: e.target.value })} style={filterInput} />
                </div>
              </div>
              <div className="mb-2">
                <label style={filterLabel}>Paid Date</label>
                <input type="date" value={matchForm.paidDate} onChange={(e) => setMatchForm({ ...matchForm, paidDate: e.target.value })} style={filterInput} />
              </div>
              <div className="mb-4">
                <label style={filterLabel}>Endorsed payments ({endorsedPayments.length}) — used when no reference is entered</label>
                <div className="max-h-40 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
                  {endorsedPayments.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <input
                        type="checkbox"
                        checked={matchSelected.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(matchSelected);
                          if (e.target.checked) next.add(p.id); else next.delete(p.id);
                          setMatchSelected(next);
                        }}
                        className="w-4 h-4 rounded"
                      />
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.invoice.invoice_number}</span>
                      <span className="ml-auto font-variant-numeric">{p.currency} {Number(p.amount).toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button onClick={() => setShowMatchModal(false)} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >Cancel</button>
                <button onClick={handleMatch} disabled={matchSaving} className="px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold" style={{ background: 'var(--accent-green)', color: 'white' }}
                  onMouseEnter={(e) => { if (!matchSaving) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  {matchSaving ? 'Matching...' : 'Match & Mark Paid'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showApproveAllModal && approveAllIds.length > 0 && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Approve All Payments</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                {approveAllIds.length} payment{approveAllIds.length === 1 ? '' : 's'} will be marked <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>APPROVED_FOR_PAYMENT</span> — this is the final approval; only the payment process follows.
              </p>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Note (optional — recorded on each invoice)</label>
              <textarea
                value={approveAllNote}
                onChange={(e) => setApproveAllNote(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', resize: 'vertical' }}
                placeholder="e.g. Batch 3 — bank charge to be applied per vendor"
              />
              <div className="flex justify-end space-x-3 mt-4">
                <button onClick={() => { setShowApproveAllModal(false); setApproveAllIds([]); setApproveAllNote(''); }} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >Cancel</button>
                <button onClick={() => handleApproveAll(approveAllIds)} disabled={processing} className="px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold" style={{ background: 'var(--accent-green)', color: 'white' }}
                  onMouseEnter={(e) => { if (!processing) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  {processing ? <Loader2 className="h-4 w-4 mr-2 inline animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2 inline" strokeWidth={2} />}
                  Approve All ({approveAllIds.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {rejectTarget && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Return Payment to Associate</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                {rejectTarget.invoice.invoice_number} · {rejectTarget.invoice.vendor.name} — the final remarks you enter here are what the Accounting Associate sees when the payment returns to <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>SCHEDULED</span>.
              </p>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Final Remarks (required)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', resize: 'vertical' }}
                placeholder="Reason for return — shown to the Associate (e.g. missing supporting document, wrong split...)"
              />
              <div className="flex justify-end space-x-3 mt-4">
                <button onClick={() => setRejectTarget(null)} className="px-4 py-2 transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >Cancel</button>
                <button onClick={handleConfirmReject} disabled={!rejectReason.trim() || processing} className="px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold" style={{ background: 'var(--accent-amber)', color: 'var(--bg-base)' }}
                  onMouseEnter={(e) => { if (rejectReason.trim() && !processing) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  {processing ? <Loader2 className="h-4 w-4 mr-2 inline animate-spin" /> : <ArrowLeft className="h-4 w-4 mr-2 inline" strokeWidth={1.75} />}
                  Return with Final Remarks
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
