import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, Play, X, AlertCircle, CheckCircle, Clock, DollarSign, ArrowLeft } from 'lucide-react';
import { paymentBatchApi } from '../lib/api';

interface Payment {
  id: string;
  amount: number;
  scheduled_date: string;
  status: string;
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
  status: 'DRAFT' | 'PENDING_CFO' | 'APPROVED' | 'PROCESSED' | 'CANCELLED';
  created_at: string;
  processed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  payments: Payment[];
}

export default function PaymentBatchManager() {
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const loadBatches = async () => {
    try {
      setLoading(true);
      const response = await paymentBatchApi.getAll();
      const data = response.data || [];
      setBatches(data.map((b: any) => ({
        id: b.id,
        batch_number: b.batch_name || b.name || b.id,
        total_amount: Number(b.total_amount || 0),
        payment_count: b.invoice_count || 0,
        status: b.status || 'DRAFT',
        created_at: b.created_at || new Date().toISOString(),
        processed_at: b.processed_at || undefined,
        cancelled_at: b.cancelled_at || undefined,
        cancellation_reason: b.cancellation_reason || undefined,
        payments: (b.payments || []).map((p: any) => ({
          id: p.id,
          amount: Number(p.amount || 0),
          scheduled_date: p.payment_date || p.scheduled_date || new Date().toISOString(),
          status: p.status || 'SCHEDULED',
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, []);

  const handleProcessBatch = async (batchId: string) => {
    setProcessing(true);
    try {
      await paymentBatchApi.process(batchId);
      await loadBatches();
      setSelectedBatch(null);
    } catch (error) {
      console.error('Failed to process batch:', error);
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
      case 'PENDING_CFO':
        return { background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' };
      case 'APPROVED':
        return { background: 'color-mix(in srgb, var(--accent-violet) 12%, transparent)', color: 'var(--accent-violet)', border: '1px solid color-mix(in srgb, var(--accent-violet) 20%, transparent)' };
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
      case 'PENDING_CFO':
        return <Play className="h-4 w-4" />;
      case 'APPROVED':
        return <CheckCircle className="h-4 w-4" />;
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
      <div className="flex items-center justify-center h-64" style={{ background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading payment batches...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
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

        <div className="rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Payment Batches</h2>
            {batches.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No payment batches found</div>
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

              {selectedBatch.status === 'DRAFT' && (
                <div className="flex items-center space-x-3 mb-6">
                  <button onClick={() => handleProcessBatch(selectedBatch.id)} disabled={processing}
                    className="flex items-center px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 text-sm font-semibold"
                    style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                    onMouseEnter={(e) => { if (!processing) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                    onMouseLeave={(e) => { if (!processing) e.currentTarget.style.background = 'var(--accent-lime)'; }}
                  >
                    <Play className="h-4 w-4 mr-2" strokeWidth={1.75} />
                    Process Batch
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
            </div>
          </div>
        )}

        {showCancelModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="p-6 max-w-md w-full mx-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
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
      </div>
    </div>
  );
}
