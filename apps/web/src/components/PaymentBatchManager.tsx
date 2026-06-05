import { useState, useEffect } from 'react';
import { paymentBatchApi } from '../lib/api';
import { Package, Play, X, AlertCircle, CheckCircle, Clock, DollarSign } from 'lucide-react';

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Payment Batches</h1>
        <div className="flex items-center space-x-2">
          <Package className="h-6 w-6 text-gray-400" />
          <span className="text-sm text-gray-500">Manage payment batches for wire transfers</span>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Batches</h2>
          {batches.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No payment batches found
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedBatch(batch)}
                >
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-lg ${getStatusColor(batch.status)}`}>
                      {getStatusIcon(batch.status)}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{batch.batch_number}</div>
                      <div className="text-sm text-gray-500">
                        {batch.payment_count} payments • ${batch.total_amount.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(batch.status)}`}>
                      {batch.status}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Batch Details: {selectedBatch.batch_number}
              </h2>
              <button
                onClick={() => setSelectedBatch(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="text-sm text-gray-500">Total Amount</div>
                <div className="text-2xl font-bold text-gray-900 flex items-center">
                  <DollarSign className="h-5 w-5 mr-1" />
                  {selectedBatch.total_amount.toLocaleString()}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="text-sm text-gray-500">Payment Count</div>
                <div className="text-2xl font-bold text-gray-900">
                  {selectedBatch.payment_count}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="text-sm text-gray-500">Status</div>
                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium mt-1 ${getStatusColor(selectedBatch.status)}`}>
                  {getStatusIcon(selectedBatch.status)}
                  <span className="ml-1">{selectedBatch.status}</span>
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="text-sm text-gray-500">Created</div>
                <div className="text-sm font-medium text-gray-900 mt-1">
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

            <h3 className="text-md font-semibold text-gray-900 mb-3">Payments in Batch</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Invoice
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Vendor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Scheduled Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {selectedBatch.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {payment.invoice.invoice_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {payment.invoice.vendor.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${payment.amount.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
              <div className="mt-4 p-4 bg-red-50 rounded-lg">
                <div className="text-sm font-medium text-red-900">Cancellation Reason</div>
                <div className="text-sm text-red-700">{selectedBatch.cancellation_reason}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Cancel Payment Batch</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to cancel batch {selectedBatch?.batch_number}? This will unlink all payments from the batch.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cancellation Reason
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
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
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
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
  );
}
