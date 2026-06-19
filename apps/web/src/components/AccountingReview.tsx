import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { InvoiceStatus } from '@ap-invoice/shared';
import { useMockData } from '../contexts/MockDataContext';
import { MockInvoice } from '../lib/mockData';
import { FileText, Search, Filter, Download, Eye, CheckCircle, XCircle, Calendar, FileSearch } from 'lucide-react';

export default function AccountingReview() {
  const { invoices } = useMockData();
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [filters, setFilters] = useState({
    status: InvoiceStatus.POSTED_TO_QB,
    search: '',
  });

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  const filteredInvoices = invoices.filter(invoice =>
    invoice.invoice_number.toLowerCase().includes(filters.search.toLowerCase()) ||
    invoice.vendor_name.toLowerCase().includes(filters.search.toLowerCase())
  );

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
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)', boxShadow: '0 8px 32px rgba(20,184,166,0.3)' }}>
                <FileSearch className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Accounting Review</h1>
                <p className="text-xs text-slate-400">Review posted invoices and audit trail</p>
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
                    placeholder="Search invoices..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-12 pr-4 py-3 w-full bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all text-white placeholder-slate-400"
                  />
                </div>
              </div>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus })}
                className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all text-white"
              >
                <option value={InvoiceStatus.POSTED_TO_QB}>Posted</option>
                <option value={InvoiceStatus.PAID}>Paid</option>
                <option value={InvoiceStatus.PAYMENT_SCHEDULED}>Payment Scheduled</option>
                <option value="">All Statuses</option>
              </select>
              <button className="flex items-center px-4 py-3 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}>
                <Filter className="h-5 w-5 mr-2" />
                More Filters
              </button>
            </div>
          </div>

          {/* Invoice Table */}
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <h2 className="text-lg font-semibold text-white">
                Posted Invoices ({filteredInvoices.length})
              </h2>
              <button className="flex items-center px-4 py-2.5 text-white rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5" style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}>
                <Download className="h-5 w-5 mr-2" />
                Export
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-center text-slate-400">Loading invoices...</div>
            ) : (
              <table className="min-w-full divide-y divide-white/5">
                <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Invoice Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Vendor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Posted Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 text-slate-400 mr-2" />
                          <span className="text-sm font-medium text-white">{invoice.invoice_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {invoice.vendor_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        ${invoice.total_amount.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          invoice.status === (InvoiceStatus.POSTED_TO_QB as any)
                            ? 'bg-blue-500/20 text-blue-300'
                            : invoice.status === InvoiceStatus.PAID
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-yellow-500/20 text-yellow-300'
                        }`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {invoice.updated_at ? new Date(invoice.updated_at).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => setSelectedInvoice(invoice)}
                          className="text-blue-400 hover:text-blue-300 mr-3 transition-colors"
                        >
                          <Eye className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!loading && filteredInvoices.length === 0 && (
              <div className="p-6 text-center text-slate-400">No invoices found</div>
            )}
          </div>

          {/* Invoice Detail Panel */}
          {selectedInvoice && (
            <div className="mt-6" style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">Invoice Details</h2>
                  <button
                    onClick={() => setSelectedInvoice(null)}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <XCircle className="h-6 w-6" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Invoice Number</label>
                    <p className="text-sm text-white font-medium">{selectedInvoice.invoice_number}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Vendor</label>
                    <p className="text-sm text-white font-medium">{selectedInvoice.vendor_name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Amount</label>
                    <p className="text-sm text-white font-medium">${selectedInvoice.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Currency</label>
                    <p className="text-sm text-white font-medium">{selectedInvoice.currency}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Invoice Date</label>
                    <p className="text-sm text-white font-medium">{selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Due Date</label>
                    <p className="text-sm text-white font-medium">
                      {selectedInvoice.due_date
                        ? new Date(selectedInvoice.due_date).toLocaleDateString()
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Status</label>
                    <p className="text-sm text-white font-medium">{selectedInvoice.status}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Posted Date</label>
                    <p className="text-sm text-white font-medium">{selectedInvoice.updated_at ? new Date(selectedInvoice.updated_at).toLocaleDateString() : 'N/A'}</p>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <h3 className="text-md font-medium text-white mb-3">Bank Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Bank Name</label>
                      <p className="text-sm text-white font-medium">{selectedInvoice.bank_name || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Account Number</label>
                      <p className="text-sm text-white font-medium">{selectedInvoice.account_number || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">SWIFT Code</label>
                      <p className="text-sm text-white font-medium">{selectedInvoice.swift_code || 'N/A'}</p>
                    </div>
                    <div className="mt-4 p-3 rounded-lg" style={{ background: selectedInvoice.swift_code && selectedInvoice.account_number ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: selectedInvoice.swift_code && selectedInvoice.account_number ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)' }}>
                      <div className="flex items-center">
                        {selectedInvoice.swift_code && selectedInvoice.account_number ? (
                          <>
                            <CheckCircle className="h-5 w-5 mr-2 text-green-400" />
                            <span className="text-sm text-green-300 font-medium">Bank information is complete and validated</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 mr-2 text-red-400" />
                            <span className="text-sm text-red-300 font-medium">Bank information is incomplete - requires vendor update</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <h3 className="text-md font-medium text-white mb-3">Audit Trail</h3>
                  <div className="space-y-2">
                    <div className="flex items-center text-sm text-slate-400">
                      <CheckCircle className="h-4 w-4 mr-2 text-green-400" />
                      <span>Posted on {selectedInvoice.updated_at ? new Date(selectedInvoice.updated_at).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div className="flex items-center text-sm text-slate-400">
                      <Calendar className="h-4 w-4 mr-2 text-blue-400" />
                      <span>Created on {selectedInvoice.created_at ? new Date(selectedInvoice.created_at).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
