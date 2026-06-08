import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { paymentBatchApi } from '../lib/api';
import { Package, Play, X, AlertCircle, CheckCircle, Clock, DollarSign, ArrowLeft } from 'lucide-react';

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
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
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

  useEffect(() => {
    loadBatches();
  }, []);

  const loadBatches = async () => {
    try {
      const response = await paymentBatchApi.getAll();
      setBatches(response.data);
    } catch (error) {
      console.error('Failed to load payment batches:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      case 'PROCESSING':
        return 'bg-blue-100 text-blue-800';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Clock className="h-4 w-4" />;
      case 'PROCESSING':
        return <Play className="h-4 w-4" />;
      case 'COMPLETED':
        return <CheckCircle className="h-4 w-4" />;
      case 'CANCELLED':
        return <X className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading payment batches...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
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

      <div className="relative z-10 px-6 py-8 space-y-6">
        <header style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4 sticky top-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-slate-300 hover:text-white transition-colors">
                <ArrowLeft className="h-6 w-6" />
              </Link>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', boxShadow: '0 8px 32px rgba(139,92,246,0.3)' }}>
                <Package className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Payment Batches</h1>
                <p className="text-xs text-slate-400">Manage payment batches for wire transfers</p>
              </div>
            </div>
          </div>
        </header>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Payment Batches</h2>
            {batches.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                No payment batches found
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between p-4 border border-white/10 rounded-lg cursor-pointer transition-colors"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onClick={() => setSelectedBatch(batch)}
                  >
                    <div className="flex items-center space-x-4">
                      <div className={`p-2 rounded-lg ${getStatusColor(batch.status)}`}>
                        {getStatusIcon(batch.status)}
                      </div>
                      <div>
                        <div className="font-medium text-white">{batch.batch_number}</div>
                        <div className="text-sm text-slate-400">
                          {batch.payment_count} payments • ${batch.total_amount.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(batch.status)}`}>
                        {batch.status}
                      </div>
                      <div className="text-sm text-slate-400 mt-1">
                        {new Date(batch.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedBatch && (
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  Batch Details: {selectedBatch.batch_number}
                </h2>
                <button
                  onClick={() => setSelectedBatch(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-sm text-slate-400">Total Amount</div>
                  <div className="text-2xl font-bold text-white flex items-center">
                    <DollarSign className="h-5 w-5 mr-1" />
                    {selectedBatch.total_amount.toLocaleString()}
                  </div>
                </div>
                <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-sm text-slate-400">Payment Count</div>
                  <div className="text-2xl font-bold text-white">
                    {selectedBatch.payment_count}
                  </div>
                </div>
                <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-sm text-slate-400">Status</div>
                  <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium mt-1 ${getStatusColor(selectedBatch.status)}`}>
                    {getStatusIcon(selectedBatch.status)}
                    <span className="ml-1">{selectedBatch.status}</span>
                  </div>
                </div>
                <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-sm text-slate-400">Created</div>
                  <div className="text-sm font-medium text-white mt-1">
                    {new Date(selectedBatch.created_at).toLocaleString()}
                  </div>
                </div>
              </div>

              {selectedBatch.status === 'PENDING' && (
                <div className="flex items-center space-x-3 mb-6">
                  <button
                    onClick={() => handleProcessBatch(selectedBatch.id)}
                    disabled={processing}
                    className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Process Batch
                  </button>
                  <button
                    onClick={() => setShowCancelModal(true)}
                    disabled={processing}
                    className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel Batch
                  </button>
                </div>
              )}

              <h3 className="text-md font-semibold text-white mb-3">Payments in Batch</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10">
                  <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Invoice
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Vendor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Scheduled Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {selectedBatch.payments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {payment.invoice.invoice_number}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                          {payment.invoice.vendor.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                          ${payment.amount.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                          {new Date(payment.scheduled_date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(payment.status)}`}>
                            {payment.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedBatch.cancellation_reason && (
                <div className="mt-4 p-4 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div className="text-sm font-medium text-red-400">Cancellation Reason</div>
                  <div className="text-sm text-red-300">{selectedBatch.cancellation_reason}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {showCancelModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div style={{ background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} className="p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-white mb-4">Cancel Payment Batch</h3>
              <p className="text-sm text-slate-400 mb-4">
                Are you sure you want to cancel batch {selectedBatch?.batch_number}? This will unlink all payments from the batch.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Cancellation Reason
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-white placeholder-slate-400"
                  rows={3}
                  placeholder="Enter reason for cancellation..."
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowCancelModal(false);
                    setCancelReason('');
                  }}
                  className="px-4 py-2 text-slate-300 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCancelBatch}
                  disabled={!cancelReason || processing}
                  className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  Confirm Cancellation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
