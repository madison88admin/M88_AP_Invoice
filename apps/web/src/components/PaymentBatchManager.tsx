import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Package, Play, X, AlertCircle, CheckCircle, Clock, DollarSign, ArrowLeft, CheckSquare, Calendar, Loader2, Paperclip } from 'lucide-react';
import { paymentBatchApi } from '../lib/api';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

interface ScheduledPayment {
  id: string;
  amount: number;
  currency: string;
  payment_date: string;
  status: string;
  selected_for_batch: boolean;
  selected_by?: string;
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

interface Payment {
  id: string;
  amount: number;
  scheduled_date: string;
  status: string;
  paid_at?: string;
  reference?: string;
  bank_used?: string;
  remarks?: string;
  proof_file_url?: string;
  proof_file_name?: string;
  invoice: {
    id: string;
    invoice_number: string;
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
}

export default function PaymentBatchManager() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'scheduled' | 'batches'>('scheduled');
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
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
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [filters, setFilters] = useState({ vendorId: '', currency: '', dateFrom: '', dateTo: '', search: '' });

  const isAssociate = user?.role === 'ACCOUNTING_ASSOCIATE';
  const isSupervisor = user?.role === 'ACCOUNTING_SUPERVISOR';

  const loadBatches = useCallback(async () => {
    try {
      const response = await paymentBatchApi.getAll();
      const data = response.data || [];
      setBatches(data.map((b: any) => ({
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
        payments: (b.payments || []).map((p: any) => ({
          id: p.id,
          amount: Number(p.amount || 0),
          scheduled_date: p.payment_date || p.scheduled_date || new Date().toISOString(),
          status: p.status || 'SCHEDULED',
          paid_at: p.paid_at || undefined,
          reference: p.reference || undefined,
          bank_used: p.bank_used || undefined,
          remarks: p.remarks || undefined,
          proof_file_url: p.proof_file_url || undefined,
          proof_file_name: p.proof_file_name || undefined,
          invoice: {
            id: p.invoice?.id || p.invoice_id,
            invoice_number: p.invoice?.invoice_number || '',
            vendor: { name: p.invoice?.vendor?.name || '' },
          },
        })),
      })));
    } catch (error) {
      console.error('Failed to load payment batches:', error);
      setBatches([]);
    }
  }, []);

  const loadScheduledPayments = useCallback(async () => {
    try {
      const response = await paymentBatchApi.getScheduledPayments(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
      const data = response.data || [];
      const mapped = data.map((p: any) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        currency: p.currency || 'USD',
        payment_date: p.payment_date || new Date().toISOString(),
        status: p.status || 'SCHEDULED',
        selected_for_batch: p.selected_for_batch || false,
        selected_by: p.selected_by || undefined,
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
    } catch (error) {
      console.error('Failed to load scheduled payments:', error);
      setScheduledPayments([]);
    }
  }, [filters, user?.id]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadBatches(), loadScheduledPayments()]);
      setLoading(false);
    };
    init();
  }, [loadBatches, loadScheduledPayments]);

  const handleToggleSelect = async (paymentId: string) => {
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
    } catch (error) {
      console.error('Failed to toggle payment selection:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSelectAll = async () => {
    const unselected = scheduledPayments.filter(p => !selectedPaymentIds.has(p.id));
    if (unselected.length === 0) return;
    setActionLoading(true);
    try {
      await paymentBatchApi.selectPayments(unselected.map(p => p.id));
      setSelectedPaymentIds(new Set(scheduledPayments.map(p => p.id)));
    } catch (error) {
      console.error('Failed to select all payments:', error);
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
    } catch (error) {
      console.error('Failed to deselect all payments:', error);
    } finally {
      setActionLoading(false);
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

  const handleProcessBatch = async (batchId: string) => {
    setProcessing(true);
    try {
      await paymentBatchApi.process(batchId, executionForm);
      await loadBatches();
      setSelectedBatch(null);
      setShowExecutionModal(false);
      setExecutionForm({ paidDate: new Date().toISOString().split('T')[0], reference: '', bankUsed: '', remarks: '', proof: null });
    } catch (error) {
      console.error('Failed to process batch:', error);
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
    } catch (error) {
      console.error(`Failed to ${action} batch:`, error);
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
    } catch (error) {
      console.error('Failed to cancel batch:', error);
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

  const selectedTotal = scheduledPayments
    .filter(p => selectedPaymentIds.has(p.id))
    .reduce((sum, p) => sum + p.amount, 0);
  const previewGroups = Array.from(scheduledPayments.filter(p => selectedPaymentIds.has(p.id)).reduce((groups, payment) => {
    const key = [payment.invoice.vendor.id, payment.currency, payment.invoice.vendor.account_number, payment.invoice.bill_to_entity].join('|');
    const current = groups.get(key) || { vendor: payment.invoice.vendor.name, currency: payment.currency, account: payment.invoice.vendor.account_number || 'Missing account', entity: payment.invoice.bill_to_entity || 'Missing entity', count: 0, total: 0 };
    current.count++; current.total += payment.amount; groups.set(key, current); return groups;
  }, new Map<string, {vendor:string;currency:string;account:string;entity:string;count:number;total:number}>()).values());

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10 px-6 py-8 space-y-6">
        <header className="px-6 py-4 -mx-6" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="transition-colors" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
              </Link>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}>
                <Package className="h-5 w-5 text-white" strokeWidth={1.75} />
              </div>

              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Payment Batches</h1>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Manage payment batches for wire transfers</p>
              </div>
            </div>
          </div>
        </header>

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
            {batches.length > 0 && (
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
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4 p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Invoice, MPO, material, vendor" className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                <select value={filters.vendorId} onChange={(e) => setFilters({ ...filters, vendorId: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
                  <option value="">All vendors</option>
                  {Array.from(new Map(scheduledPayments.filter(p => p.invoice.vendor.id).map(p => [p.invoice.vendor.id!, p.invoice.vendor.name])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select value={filters.currency} onChange={(e) => setFilters({ ...filters, currency: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
                  <option value="">All currencies</option>
                  {Array.from(new Set(scheduledPayments.map(p => p.currency))).map(currency => <option key={currency} value={currency}>{currency}</option>)}
                </select>
                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
              </div>

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
                      Create {previewGroups.length} Batch{previewGroups.length === 1 ? '' : 'es'}
                    </button>
                  )}
                  {isSupervisor && (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      View-only access — Associate manages batches
                    </div>
                  )}
                </div>
              )}
              {selectedPaymentIds.size > 0 && <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2 mb-4">{previewGroups.map((group, index) => <div key={`${group.vendor}-${index}`} className="p-3 rounded-lg text-xs" style={{background:'var(--bg-card)',border:'1px solid var(--border-color)'}}><div className="font-semibold">Batch {index + 1}: {group.vendor}</div><div>{group.count} invoice{group.count === 1 ? '' : 's'} · {group.currency} {group.total.toLocaleString()}</div><div style={{color:'var(--text-muted)'}}>{group.entity} · Account {group.account}</div></div>)}</div>}

              {scheduledPayments.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No scheduled payments available for batching</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Post invoices to QB and schedule payments first</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead style={{ background: 'var(--bg-elevated)' }}>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)', width: '40px' }}></th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendor</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Payment Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
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
                            onClick={() => handleToggleSelect(payment.id)}
                          >
                            <td className="px-4 py-4">
                              <div className="flex items-center justify-center w-5 h-5 rounded border-2 transition-all" style={{
                                borderColor: isSelected ? 'var(--accent-purple)' : 'var(--border-color)',
                                background: isSelected ? 'var(--accent-purple)' : 'transparent',
                              }}>
                                {isSelected && <CheckSquare className="h-3 w-3 text-white" strokeWidth={2.5} />}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{payment.invoice.invoice_number}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{payment.invoice.vendor.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{payment.currency} {payment.amount.toLocaleString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{new Date(payment.payment_date).toLocaleDateString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{
                                background: isSelected ? 'color-mix(in srgb, var(--accent-purple) 12%, transparent)' : 'color-mix(in srgb, var(--accent-amber) 12%, transparent)',
                                color: isSelected ? 'var(--accent-purple)' : 'var(--accent-amber)',
                                border: `1px solid ${isSelected ? 'color-mix(in srgb, var(--accent-purple) 20%, transparent)' : 'color-mix(in srgb, var(--accent-amber) 20%, transparent)'}`,
                              }}>
                                {isSelected ? 'Selected' : 'Scheduled'}
                              </span>
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
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Payment Batches</h2>
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
                    onClick={() => setSelectedBatch(batch)}
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

              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Amount</div>
                  <div className="text-2xl font-bold flex items-center" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    <DollarSign className="h-5 w-5 mr-1" strokeWidth={1.75} />
                    {selectedBatch.total_amount.toLocaleString()}
                  </div>
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

              {selectedBatch.status === 'REVIEWED' && isAssociate && (
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => handleBatchAction('export', selectedBatch.id)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-purple)', color: 'white' }}>Mark Exported to Bank</button>
                  <button onClick={() => setShowExecutionModal(true)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}>Execute Payments</button>
                </div>
              )}

              {selectedBatch.status === 'EXPORTED_TO_BANK' && isAssociate && (
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => setShowExecutionModal(true)} disabled={processing} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}>Confirm Payment Processing</button>
                </div>
              )}

              <h3 className="text-md font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Payments in Batch</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead style={{ background: 'var(--bg-elevated)' }}>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Scheduled Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Execution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBatch.payments.map((payment, idx) => (
                      <tr key={payment.id} className="transition-colors" style={{ borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{payment.invoice.invoice_number}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{payment.invoice.vendor.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${payment.amount.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{new Date(payment.scheduled_date).toLocaleDateString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={getStatusStyle(payment.status)}>{payment.status}</span>
                        </td>
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {payment.reference || payment.paid_at || payment.proof_file_url ? (
                            <div className="space-y-1">
                              {payment.reference && <div>Ref: {payment.reference}</div>}
                              {payment.bank_used && <div>Bank: {payment.bank_used}</div>}
                              {payment.paid_at && <div>Paid: {new Date(payment.paid_at).toLocaleDateString()}</div>}
                              {payment.proof_file_url && (
                                <a href={payment.proof_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: 'var(--accent-purple)' }}>
                                  <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                                  {payment.proof_file_name || 'Proof'}
                                </a>
                              )}
                            </div>
                          ) : 'Pending'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
      </div>
    </div>
  );
}
