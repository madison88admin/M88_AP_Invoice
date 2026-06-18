import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search, Filter, Download, Eye, CheckCircle, XCircle, DollarSign } from 'lucide-react';

interface PaymentBatch {
  id: string;
  batch_number: string;
  total_amount: number;
  payment_count: number;
  status: 'DRAFT' | 'PENDING_CFO' | 'APPROVED' | 'PROCESSED' | 'CANCELLED';
  created_at: Date;
  processed_at?: Date;
  payments: Array<{
    id: string;
    amount: number;
    currency: string;
    payment_date: Date;
    invoice: {
      invoice_number: string;
      vendor: {
        name: string;
      };
    };
  }>;
}

export default function CFOApproval() {
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
  const [filters, setFilters] = useState({
    status: 'DRAFT',
    search: '',
  });

  useEffect(() => {
    loadBatches();
  }, [filters]);

  const loadBatches = async () => {
    try {
      setLoading(true);
      // In production, this would call the actual API
      // const response = await paymentBatchApi.getAll({ status: filters.status });
      // setBatches(response.data);
      
      // Mock data for now
      setBatches([]);
    } catch (error) {
      console.error('Failed to load payment batches:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredBatches = batches.filter((batch) =>
    batch.batch_number.toLowerCase().includes(filters.search.toLowerCase())
  );

  const handleApprove = async (batchId: string) => {
    try {
      // In production, this would call the actual API
      // await paymentBatchApi.approve(batchId);
      console.log('Approving batch:', batchId);
      loadBatches();
    } catch (error) {
      console.error('Failed to approve batch:', error);
    }
  };

  const handleReject = async (batchId: string, reason: string) => {
    try {
      // In production, this would call the actual API
      // await paymentBatchApi.reject(batchId, reason);
      console.log('Rejecting batch:', batchId, reason);
      loadBatches();
    } catch (error) {
      console.error('Failed to reject batch:', error);
    }
  };

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

      <div className="relative z-10">
        <header style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4 sticky top-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', boxShadow: '0 8px 32px rgba(139, 92, 246, 0.3)' }}>
                <DollarSign className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">CFO Approval</h1>
                <p className="text-xs text-slate-400">Review and approve payment batches</p>
              </div>
            </div>
            <Link
              to="/"
              className="group flex items-center px-4 py-2.5 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #64748b 0%, #475569 100%)' }}
            >
              Back to Dashboard
            </Link>
          </div>
        </header>

        <main className="px-6 py-8">
          {/* Filters */}
          <div style={{ background: 'rgba(255, 255, 255, 0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 h-5 w-5" />
                  <input
                    type="text"
                    placeholder="Search batches..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-12 pr-4 py-3 w-full bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white placeholder-slate-400"
                  />
                </div>
              </div>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white"
              >
                <option value="DRAFT">Draft</option>
                <option value="PENDING_CFO">Pending CFO</option>
                <option value="APPROVED">Approved</option>
                <option value="PROCESSED">Processed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="">All Statuses</option>
              </select>
              <button className="flex items-center px-4 py-3 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' }}>
                <Filter className="h-5 w-5 mr-2" />
                More Filters
              </button>
            </div>
          </div>

          {/* Payment Batches Table */}
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <h2 className="text-lg font-semibold text-white">
                Payment Batches ({filteredBatches.length})
              </h2>
              <button className="flex items-center px-4 py-2.5 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}>
                <Download className="h-5 w-5 mr-2" />
                Export
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-center text-slate-400">Loading payment batches...</div>
            ) : (
              <table className="min-w-full divide-y divide-white/5">
                <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Batch Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Payment Count
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Total Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Created Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredBatches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 text-slate-400 mr-2" />
                          <span className="text-sm font-medium text-white">{batch.batch_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {batch.payment_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        ${batch.total_amount.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          batch.status === 'DRAFT'
                            ? 'bg-yellow-500/20 text-yellow-300'
                            : batch.status === 'PENDING_CFO'
                            ? 'bg-blue-500/20 text-blue-300'
                            : batch.status === 'PROCESSED'
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}>
                          {batch.status === 'DRAFT' ? 'Draft' : batch.status === 'PENDING_CFO' ? 'Pending CFO' : batch.status === 'APPROVED' ? 'Approved' : batch.status === 'PROCESSED' ? 'Processed' : batch.status === 'CANCELLED' ? 'Cancelled' : batch.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {new Date(batch.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => setSelectedBatch(batch)}
                          className="text-blue-400 hover:text-blue-300 mr-3 transition-colors"
                        >
                          <Eye className="h-5 w-5" />
                        </button>
                        {batch.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => handleApprove(batch.id)}
                              className="text-green-400 hover:text-green-300 mr-3 transition-colors"
                            >
                              <CheckCircle className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleReject(batch.id, 'Rejected by CFO')}
                              className="text-red-400 hover:text-red-300 transition-colors"
                            >
                              <XCircle className="h-5 w-5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!loading && filteredBatches.length === 0 && (
              <div className="p-6 text-center text-slate-400">No payment batches found</div>
            )}
          </div>

          {/* Batch Detail Panel */}
          {selectedBatch && (
            <div className="mt-6" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">Batch Details</h2>
                  <button
                    onClick={() => setSelectedBatch(null)}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <XCircle className="h-6 w-6" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Batch Number</label>
                    <p className="text-sm text-white font-medium">{selectedBatch.batch_number}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Status</label>
                    <p className="text-sm text-white font-medium">{selectedBatch.status}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Payment Count</label>
                    <p className="text-sm text-white font-medium">{selectedBatch.payment_count}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Total Amount</label>
                    <p className="text-sm text-white font-medium">${selectedBatch.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Created Date</label>
                    <p className="text-sm text-white font-medium">{new Date(selectedBatch.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Processed Date</label>
                    <p className="text-sm text-white font-medium">
                      {selectedBatch.processed_at ? new Date(selectedBatch.processed_at).toLocaleString() : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <h3 className="text-md font-medium text-white mb-3">Payments in Batch</h3>
                  <div className="space-y-2">
                    {selectedBatch.payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                        <div className="flex items-center gap-3">
                          <FileText className="h-4 w-4 text-slate-400" />
                          <div>
                            <p className="text-sm text-white font-medium">{payment.invoice.invoice_number}</p>
                            <p className="text-xs text-slate-400">{payment.invoice.vendor.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-white font-medium">${payment.amount.toLocaleString()}</p>
                          <p className="text-xs text-slate-400">{new Date(payment.payment_date).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedBatch.status === 'DRAFT' && (
                  <div className="mt-6 pt-6 flex gap-3" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <button
                      onClick={() => handleApprove(selectedBatch.id)}
                      className="flex-1 flex items-center justify-center px-4 py-3 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                      style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}
                    >
                      <CheckCircle className="h-5 w-5 mr-2" />
                      Approve Batch
                    </button>
                    <button
                      onClick={() => handleReject(selectedBatch.id, 'Rejected by CFO')}
                      className="flex-1 flex items-center justify-center px-4 py-3 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                      style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}
                    >
                      <XCircle className="h-5 w-5 mr-2" />
                      Reject Batch
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
