import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search, Filter, Download, Eye, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { paymentBatchApi } from '../lib/api';

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
    status: 'PENDING_CFO',
    search: '',
  });

  useEffect(() => {
    loadBatches();
  }, [filters]);

  const loadBatches = async () => {
    try {
      setLoading(true);
      const response = await paymentBatchApi.getAll();
      const allBatches = response.data || [];
      const filtered = filters.status ? allBatches.filter((b: any) => b.status === filters.status) : allBatches;
      setBatches(filtered.map((b: any) => ({
        id: b.id,
        batch_number: b.batch_number || b.batch_name || b.name || b.id,
        total_amount: Number(b.total_amount || 0),
        payment_count: b.payment_count || b.invoice_count || 0,
        status: b.status || 'DRAFT',
        created_at: new Date(b.created_at),
        processed_at: b.processed_at ? new Date(b.processed_at) : undefined,
        payments: (b.payments || []).map((p: any) => ({
          id: p.id,
          amount: Number(p.amount || 0),
          currency: p.currency || 'USD',
          payment_date: p.payment_date ? new Date(p.payment_date) : new Date(),
          invoice: {
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

  const filteredBatches = batches.filter((batch) =>
    batch.batch_number.toLowerCase().includes(filters.search.toLowerCase())
  );

  const handleApprove = async (batchId: string) => {
    try {
      await paymentBatchApi.approve(batchId);
      loadBatches();
    } catch (error) {
      console.error('Failed to approve batch:', error);
    }
  };

  const handleReject = async (batchId: string, reason: string) => {
    try {
      await paymentBatchApi.cancel(batchId, reason);
      loadBatches();
    } catch (error) {
      console.error('Failed to reject batch:', error);
    }
  };

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10">
        <header className="px-6 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 16px rgba(108,92,231,0.25)' }}>
                <DollarSign className="h-5 w-5 text-white" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>CFO Approval</h1>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Review and approve payment batches</p>
              </div>
            </div>
            <Link to="/" className="flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-medium" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = ''; }}
            >
              Back to Dashboard
            </Link>
          </div>
        </header>

        <main className="px-6 py-8">
          {/* Filters */}
          <div className="p-6 mb-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                  <input
                    type="text"
                    placeholder="Search batches..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-12 pr-4 py-3 w-full rounded-xl focus:outline-none transition-all text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="px-4 py-3 rounded-xl focus:outline-none transition-all text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value="DRAFT">Draft</option>
                <option value="PENDING_CFO">Pending CFO</option>
                <option value="APPROVED">Approved</option>
                <option value="PROCESSED">Processed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="">All Statuses</option>
              </select>
              <button className="flex items-center px-4 py-3 text-white rounded-xl transition-all text-sm font-medium" style={{ background: 'var(--accent-purple)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-purple)'; }}
              >
                <Filter className="h-5 w-5 mr-2" strokeWidth={1.75} />
                More Filters
              </button>
            </div>
          </div>

          {/* Payment Batches Table */}
          <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Payment Batches ({filteredBatches.length})</h2>
              <button className="flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-semibold" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-lime)'; }}
              >
                <Download className="h-5 w-5 mr-2" strokeWidth={1.75} />
                Export
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>Loading payment batches...</div>
            ) : (
              <table className="min-w-full divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Batch Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Payment Count</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Total Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Created Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {filteredBatches.map((batch) => (
                    <tr key={batch.id} className="transition-colors" onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 mr-2" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{batch.batch_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{batch.payment_count}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${batch.total_amount.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full border" style={
                          batch.status === 'DRAFT' ? { background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)', borderColor: 'color-mix(in srgb, var(--accent-amber) 20%, transparent)' } :
                          batch.status === 'PENDING_CFO' ? { background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', color: 'var(--accent-purple)', borderColor: 'color-mix(in srgb, var(--accent-purple) 20%, transparent)' } :
                          batch.status === 'PROCESSED' ? { background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', color: 'var(--accent-green)', borderColor: 'color-mix(in srgb, var(--accent-green) 20%, transparent)' } :
                          { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', borderColor: 'color-mix(in srgb, var(--accent-red) 20%, transparent)' }
                        }>
                          {batch.status === 'DRAFT' ? 'Draft' : batch.status === 'PENDING_CFO' ? 'Pending CFO' : batch.status === 'APPROVED' ? 'Approved' : batch.status === 'PROCESSED' ? 'Processed' : batch.status === 'CANCELLED' ? 'Cancelled' : batch.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{new Date(batch.created_at).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onClick={() => setSelectedBatch(batch)} className="mr-3 transition-colors" style={{ color: 'var(--accent-purple)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-violet)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}
                        >
                          <Eye className="h-5 w-5" strokeWidth={1.75} />
                        </button>
                        {batch.status === 'PENDING_CFO' && (
                          <>
                            <button onClick={() => handleApprove(batch.id)} className="mr-3 transition-colors" style={{ color: 'var(--accent-green)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                            >
                              <CheckCircle className="h-5 w-5" strokeWidth={1.75} />
                            </button>
                            <button onClick={() => handleReject(batch.id, 'Rejected by CFO')} className="transition-colors" style={{ color: 'var(--accent-red)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                            >
                              <XCircle className="h-5 w-5" strokeWidth={1.75} />
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
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>No payment batches found</div>
            )}
          </div>

          {/* Batch Detail Panel */}
          {selectedBatch && (
            <div className="mt-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Batch Details</h2>
                  <button onClick={() => setSelectedBatch(null)} className="transition-colors" style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <XCircle className="h-6 w-6" strokeWidth={1.75} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Batch Number</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedBatch.batch_number}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedBatch.status}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Payment Count</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedBatch.payment_count}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Total Amount</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${selectedBatch.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Created Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{new Date(selectedBatch.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Processed Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedBatch.processed_at ? new Date(selectedBatch.processed_at).toLocaleString() : 'N/A'}</p>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="text-md font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Payments in Batch</h3>
                  <div className="space-y-2">
                    {selectedBatch.payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                        <div className="flex items-center gap-3">
                          <FileText className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                          <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{payment.invoice.invoice_number}</p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{payment.invoice.vendor.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${payment.amount.toLocaleString()}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(payment.payment_date).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedBatch.status === 'PENDING_CFO' && (
                  <div className="mt-6 pt-6 flex gap-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                    <button onClick={() => handleApprove(selectedBatch.id)} className="flex-1 flex items-center justify-center px-4 py-3 rounded-xl transition-all font-semibold text-sm" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px rgba(198,255,61,0.15)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-lime)'; }}
                    >
                      <CheckCircle className="h-5 w-5 mr-2" strokeWidth={1.75} />
                      Approve Batch
                    </button>
                    <button onClick={() => handleReject(selectedBatch.id, 'Rejected by CFO')} className="flex-1 flex items-center justify-center px-4 py-3 rounded-xl transition-all font-medium text-sm" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                    >
                      <XCircle className="h-5 w-5 mr-2" strokeWidth={1.75} />
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
