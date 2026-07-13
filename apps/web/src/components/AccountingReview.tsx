import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { InvoiceStatus } from '@ap-invoice/shared';
import { useMockData } from '../contexts/MockDataContext';
import { MockInvoice } from '../lib/mockData';
import { FileText, Search, Filter, Download, Eye, CheckCircle, XCircle, Calendar, FileSearch, AlertTriangle } from 'lucide-react';
export default function AccountingReview() {
  const { invoices } = useMockData();
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [activeTab, setActiveTab] = useState<'posted' | 'soa'>('posted');
  const [filters, setFilters] = useState({
    status: InvoiceStatus.POSTED_TO_QB,
    search: '',
  });

  const statementInvoices = invoices.filter(i => i.invoice_type === 'STATEMENT');

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  const filteredInvoices = invoices.filter(invoice => {
    if (activeTab === 'soa' && invoice.invoice_type !== 'STATEMENT') return false;
    if (activeTab === 'posted' && invoice.invoice_type === 'STATEMENT') return false;
    if (filters.status && invoice.status !== filters.status) return false;
    return invoice.invoice_number.toLowerCase().includes(filters.search.toLowerCase()) ||
    invoice.vendor_name.toLowerCase().includes(filters.search.toLowerCase());
  });

  const getInvoiceStatusStyle = (status: string): React.CSSProperties => {
    if (status === InvoiceStatus.POSTED_TO_QB) {
      return { background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' };
    }
    if (status === InvoiceStatus.PAID) {
      return { background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' };
    }
    if (status === InvoiceStatus.PAYMENT_CONFIRMATION_SENT) {
      return { background: 'color-mix(in srgb, var(--accent-lime) 12%, transparent)', color: 'var(--accent-lime)', border: '1px solid color-mix(in srgb, var(--accent-lime) 20%, transparent)' };
    }
    return { background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' };
  };

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10">
        <header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}>
                <FileSearch className="h-5 w-5 text-white" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Accounting Review</h1>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Review posted invoices and audit trail</p>
              </div>
            </div>
            <Link
              to="/"
              className="flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-medium"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              Back to Dashboard
            </Link>
          </div>
        </header>

        <main className="px-6 py-8">
          {/* Tab Switcher */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('posted')}
              className="px-4 py-2.5 rounded-xl transition-all text-sm font-medium"
              style={activeTab === 'posted'
                ? { background: 'var(--accent-purple)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              Posted Invoices
            </button>
            <button
              onClick={() => setActiveTab('soa')}
              className="px-4 py-2.5 rounded-xl transition-all text-sm font-medium flex items-center gap-2"
              style={activeTab === 'soa'
                ? { background: 'var(--accent-amber)', color: 'white' }
                : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
            >
              <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
              SOA Reconciliation ({statementInvoices.length})
            </button>
          </div>

          {/* SOA Info Banner */}
          {activeTab === 'soa' && (
            <div className="p-4 mb-6 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Statement Type — Manual SOA Reconciliation Required</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>These are monthly statement invoices with aggregated totals (current charges + prior overdue + finance surcharge). PO amount matching is skipped. Reconcile against vendor Statements of Account manually.</p>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="p-6 mb-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                  <input
                    type="text"
                    placeholder="Search invoices..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-12 pr-4 py-3 w-full rounded-xl focus:outline-none transition-all text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus })}
                className="px-4 py-3 rounded-xl focus:outline-none transition-all text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value={InvoiceStatus.POSTED_TO_QB}>Posted</option>
                <option value={InvoiceStatus.PAID}>Paid</option>
                <option value={InvoiceStatus.PAYMENT_CONFIRMATION_SENT}>Confirmation Sent</option>
                <option value={InvoiceStatus.PAYMENT_SCHEDULED}>Payment Scheduled</option>
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

          {/* Invoice Table */}
          <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {activeTab === 'soa' ? 'SOA Reconciliation Queue' : 'Posted Invoices'} ({filteredInvoices.length})
              </h2>
              <button className="flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-semibold" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-lime)'; }}
              >
                <Download className="h-5 w-5 mr-2" strokeWidth={1.75} />
                Export
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>Loading invoices...</div>
            ) : (
              <table className="min-w-full">
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Invoice Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendor</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Posted Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice, idx) => (
                    <tr key={invoice.id} className="transition-colors" style={{ borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 mr-2" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{invoice.invoice_number}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.vendor_name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${invoice.total_amount.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full" style={getInvoiceStatusStyle(invoice.status)}>{invoice.status}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>{invoice.updated_at ? new Date(invoice.updated_at).toLocaleDateString() : 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onClick={() => setSelectedInvoice(invoice)} className="transition-colors" style={{ color: 'var(--accent-purple)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-violet)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; }}
                        >
                          <Eye className="h-5 w-5" strokeWidth={1.75} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!loading && filteredInvoices.length === 0 && (
              <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>No invoices found</div>
            )}
          </div>

          {/* Invoice Detail Panel */}
          {selectedInvoice && (
            <div className="mt-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Invoice Details</h2>
                  <button onClick={() => setSelectedInvoice(null)} className="transition-colors" style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <XCircle className="h-6 w-6" strokeWidth={1.75} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Number</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.vendor_name}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${selectedInvoice.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Currency</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.currency}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Due Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.due_date ? new Date(selectedInvoice.due_date).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Status</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.status}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Posted Date</label>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.updated_at ? new Date(selectedInvoice.updated_at).toLocaleDateString() : 'N/A'}</p>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <h3 className="text-md font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Bank Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bank Name</label>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.bank_name || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Account Number</label>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.account_number || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>SWIFT Code</label>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.swift_code || 'N/A'}</p>
                    </div>
                    <div className="mt-4 p-3 rounded-xl" style={selectedInvoice.swift_code && selectedInvoice.account_number
                      ? { background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }
                      : { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }
                    }>
                      <div className="flex items-center">
                        {selectedInvoice.swift_code && selectedInvoice.account_number ? (
                          <>
                            <CheckCircle className="h-5 w-5 mr-2" style={{ color: 'var(--accent-green)' }} strokeWidth={1.75} />
                            <span className="text-sm font-medium" style={{ color: 'var(--accent-green)' }}>Bank information is complete and validated</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 mr-2" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                            <span className="text-sm font-medium" style={{ color: 'var(--accent-red)' }}>Bank information is incomplete - requires vendor update</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <h3 className="text-md font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Audit Trail</h3>
                  <div className="space-y-2">
                    <div className="flex items-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="h-4 w-4 mr-2" style={{ color: 'var(--accent-green)' }} strokeWidth={1.75} />
                      <span>Posted on {selectedInvoice.updated_at ? new Date(selectedInvoice.updated_at).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div className="flex items-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <Calendar className="h-4 w-4 mr-2" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
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
