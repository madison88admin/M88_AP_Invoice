import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Invoice, InvoiceStatus } from '@ap-invoice/shared';
import { invoiceApi } from '../lib/api';
import { FileText, Search, Filter, Download, Eye, CheckCircle, XCircle, Calendar, FileSearch } from 'lucide-react';

export default function AccountingReview() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [filters, setFilters] = useState({
    status: InvoiceStatus.POSTED,
    search: '',
  });

  useEffect(() => {
    loadInvoices();
  }, [filters]);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const response = await invoiceApi.getAll({ status: filters.status });
      setInvoices(response.data);
    } catch (error) {
      console.error('Failed to load invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredInvoices = invoices.filter(invoice =>
    invoice.invoice_number.toLowerCase().includes(filters.search.toLowerCase()) ||
    invoice.vendor?.name.toLowerCase().includes(filters.search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <header className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-teal-500 to-teal-600 p-2 rounded-xl shadow-lg">
                <FileSearch className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">Accounting Review</h1>
                <p className="text-xs text-gray-500">Review posted invoices and audit trail</p>
              </div>
            </div>
            <Link
              to="/"
              className="group flex items-center px-4 py-2.5 bg-gradient-to-r from-gray-500 to-gray-600 text-white rounded-xl hover:from-gray-600 hover:to-gray-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200/50 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search invoices..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-12 pr-4 py-3 w-full bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all shadow-sm"
                />
              </div>
            </div>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus })}
              className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all shadow-sm"
            >
              <option value={InvoiceStatus.POSTED}>Posted</option>
              <option value={InvoiceStatus.PAID}>Paid</option>
              <option value={InvoiceStatus.PAYMENT_INITIATED}>Payment Initiated</option>
              <option value="">All Statuses</option>
            </select>
            <button className="flex items-center px-4 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl hover:from-teal-600 hover:to-teal-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
              <Filter className="h-5 w-5 mr-2" />
              More Filters
            </button>
          </div>
        </div>

        {/* Invoice Table */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg overflow-hidden border border-gray-200/50">
          <div className="px-6 py-4 border-b border-gray-200/50 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Posted Invoices ({filteredInvoices.length})
            </h2>
            <button className="flex items-center px-4 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
              <Download className="h-5 w-5 mr-2" />
              Export
            </button>
          </div>

          {loading ? (
            <div className="p-6 text-center text-gray-600">Loading invoices...</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Invoice Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Posted Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <FileText className="h-5 w-5 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-900">{invoice.invoice_number}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {invoice.vendor?.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${invoice.amount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        invoice.status === InvoiceStatus.POSTED
                          ? 'bg-blue-100 text-blue-800'
                          : invoice.status === InvoiceStatus.PAID
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(invoice.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => setSelectedInvoice(invoice)}
                        className="text-blue-600 hover:text-blue-900 mr-3"
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
            <div className="p-6 text-center text-gray-600">No invoices found</div>
          )}
        </div>

        {/* Invoice Detail Panel */}
        {selectedInvoice && (
          <div className="mt-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200/50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Invoice Details</h2>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="h-6 w-6" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Invoice Number</label>
                <p className="text-sm text-gray-900 font-medium">{selectedInvoice.invoice_number}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Vendor</label>
                <p className="text-sm text-gray-900 font-medium">{selectedInvoice.vendor?.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Amount</label>
                <p className="text-sm text-gray-900 font-medium">${selectedInvoice.amount.toLocaleString()}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Currency</label>
                <p className="text-sm text-gray-900 font-medium">{selectedInvoice.currency}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Invoice Date</label>
                <p className="text-sm text-gray-900 font-medium">{new Date(selectedInvoice.invoice_date).toLocaleDateString()}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Due Date</label>
                <p className="text-sm text-gray-900 font-medium">
                  {selectedInvoice.invoice_due_date
                    ? new Date(selectedInvoice.invoice_due_date).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Status</label>
                <p className="text-sm text-gray-900 font-medium">{selectedInvoice.status}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Posted Date</label>
                <p className="text-sm text-gray-900 font-medium">{new Date(selectedInvoice.updated_at).toLocaleDateString()}</p>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-md font-medium text-gray-900 mb-3">Audit Trail</h3>
              <div className="space-y-2">
                <div className="flex items-center text-sm text-gray-600">
                  <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                  <span>Posted on {new Date(selectedInvoice.updated_at).toLocaleString()}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <Calendar className="h-4 w-4 mr-2 text-blue-500" />
                  <span>Created on {new Date(selectedInvoice.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
