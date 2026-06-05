import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Invoice, InvoiceStatus, InvoiceCategory, InvoiceType } from '@ap-invoice/shared';
import { invoiceApi } from '../lib/api';
import InvoiceTable from './InvoiceTable';
import { FileText, Clock, AlertTriangle, CheckCircle, Filter, Plus, Shield, CheckSquare, XCircle, Send, AlertCircle, Package } from 'lucide-react';

export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [posting, setPosting] = useState(false);
  const [showSchedulePaymentModal, setShowSchedulePaymentModal] = useState(false);
  const [paymentDate, setPaymentDate] = useState('');
  const [filters, setFilters] = useState({
    status: undefined as InvoiceStatus | undefined,
    category: undefined as InvoiceCategory | undefined,
    type: undefined as InvoiceType | undefined,
  });

  useEffect(() => {
    loadInvoices();
  }, [filters]);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const response = await invoiceApi.getAll(filters);
      setInvoices(response.data);
    } catch (error) {
      console.error('Failed to load invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!selectedInvoice) return;

    try {
      setValidating(true);
      const response = await invoiceApi.validate(selectedInvoice.id);
      setValidationResult(response.data);
      // Reload invoices to get updated status and exceptions
      await loadInvoices();
      // Reload selected invoice with updated data
      const updatedInvoice = await invoiceApi.getById(selectedInvoice.id);
      setSelectedInvoice(updatedInvoice.data);
    } catch (error) {
      console.error('Failed to validate invoice:', error);
    } finally {
      setValidating(false);
    }
  };

  const handleApprove = async (invoiceId: string) => {
    try {
      const signerName = 'Current User'; // In production, this would come from user context
      await invoiceApi.approve(invoiceId, signerName);
      await loadInvoices();
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Failed to approve invoice:', error);
    }
  };

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim()) return;

    try {
      await invoiceApi.reject(selectedInvoice.id, rejectReason);
      await loadInvoices();
      setSelectedInvoice(null);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      console.error('Failed to reject invoice:', error);
    }
  };

  const handlePost = async () => {
    if (!selectedInvoice) return;

    try {
      setPosting(true);
      await invoiceApi.post(selectedInvoice.id);
      await loadInvoices();
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Failed to post invoice:', error);
    } finally {
      setPosting(false);
    }
  };

  const handleSchedulePayment = async () => {
    if (!selectedInvoice || !paymentDate) return;

    try {
      await invoiceApi.schedulePayment(selectedInvoice.id, paymentDate);
      await loadInvoices();
      setSelectedInvoice(null);
      setShowSchedulePaymentModal(false);
      setPaymentDate('');
    } catch (error) {
      console.error('Failed to schedule payment:', error);
    }
  };

  const kpis = [
    {
      label: 'Pending Validation',
      value: invoices.filter((i) => i.status === InvoiceStatus.PENDING_VALIDATION).length,
      icon: FileText,
      color: 'bg-yellow-500',
    },
    {
      label: 'Awaiting Approval',
      value: invoices.filter((i) => i.status === InvoiceStatus.PENDING_APPROVAL).length,
      icon: Clock,
      color: 'bg-purple-500',
    },
    {
      label: 'SLA at Risk',
      value: invoices.filter((i) => i.priority === 'URGENT').length,
      icon: AlertTriangle,
      color: 'bg-red-500',
    },
    {
      label: 'Paid This Week',
      value: invoices.filter((i) => i.status === InvoiceStatus.PAID).length,
      icon: CheckCircle,
      color: 'bg-green-500',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">AP Invoice Dashboard</h1>
            <div className="flex items-center space-x-3">
              <Link 
                to="/approvals"
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <CheckSquare className="h-5 w-5 mr-2" />
                Approvals
              </Link>
              <Link 
                to="/exceptions"
                className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
              >
                <AlertCircle className="h-5 w-5 mr-2" />
                Exceptions
              </Link>
              <Link 
                to="/payment-batches"
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Package className="h-5 w-5 mr-2" />
                Payment Batches
              </Link>
              <Link 
                to="/upload"
                className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus className="h-5 w-5 mr-2" />
                Upload Invoice
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{kpi.label}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{kpi.value}</p>
                </div>
                <div className={`${kpi.color} p-3 rounded-lg`}>
                  <kpi.icon className="h-6 w-6 text-white" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 mb-6">
          <div className="flex items-center gap-4">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              value={filters.status || ''}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as InvoiceStatus | undefined })}
              className="block w-48 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md border"
            >
              <option value="">All Statuses</option>
              {Object.values(InvoiceStatus).map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={filters.category || ''}
              onChange={(e) => setFilters({ ...filters, category: e.target.value as InvoiceCategory | undefined })}
              className="block w-48 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md border"
            >
              <option value="">All Categories</option>
              {Object.values(InvoiceCategory).map((category) => (
                <option key={category} value={category}>
                  {category.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={filters.type || ''}
              onChange={(e) => setFilters({ ...filters, type: e.target.value as InvoiceType | undefined })}
              className="block w-48 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md border"
            >
              <option value="">All Types</option>
              {Object.values(InvoiceType).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <button
              onClick={() => setFilters({ status: undefined, category: undefined, type: undefined })}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Invoice Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
          </div>
          {loading ? (
            <div className="px-6 py-12 text-center text-gray-500">Loading...</div>
          ) : (
            <InvoiceTable invoices={invoices} onInvoiceClick={setSelectedInvoice} />
          )}
        </div>

        {/* Invoice Detail Panel */}
        {selectedInvoice && (
          <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl border-l border-gray-200 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">Invoice Details</h3>
                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Invoice Number</p>
                  <p className="text-sm font-medium text-gray-900">{selectedInvoice.invoice_number}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Vendor</p>
                  <p className="text-sm font-medium text-gray-900">{selectedInvoice.vendor?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Amount</p>
                  <p className="text-sm font-medium text-gray-900">
                    {selectedInvoice.currency} {Number(selectedInvoice.amount).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="text-sm font-medium text-gray-900">{selectedInvoice.status}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Payment Terms</p>
                  <p className="text-sm font-medium text-gray-900">{selectedInvoice.payment_terms}</p>
                </div>
                {selectedInvoice.incoterm && (
                  <div>
                    <p className="text-sm text-gray-500">Incoterm</p>
                    <p className="text-sm font-medium text-gray-900">{selectedInvoice.incoterm}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500">Bill To</p>
                  <p className="text-sm font-medium text-gray-900">{selectedInvoice.bill_to_name}</p>
                  <p className="text-xs text-gray-500">{selectedInvoice.bill_to_address}</p>
                </div>
                
                {/* Validation Button */}
                {selectedInvoice.status === InvoiceStatus.PENDING_VALIDATION && (
                  <button
                    onClick={handleValidate}
                    disabled={validating}
                    className="w-full flex items-center justify-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    {validating ? 'Validating...' : 'Run Validation'}
                  </button>
                )}

                {/* Approval Actions */}
                {selectedInvoice.status === InvoiceStatus.PENDING_APPROVAL && (
                  <div className="space-y-2">
                    <button
                      onClick={() => handleApprove(selectedInvoice.id)}
                      className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Approve
                    </button>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </button>
                  </div>
                )}

                {/* Posting Actions */}
                {selectedInvoice.status === InvoiceStatus.APPROVED && (
                  <button
                    onClick={handlePost}
                    disabled={posting}
                    className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {posting ? 'Posting...' : 'Post to Accounting'}
                  </button>
                )}

                {/* Payment Scheduling */}
                {selectedInvoice.status === InvoiceStatus.POSTED && (
                  <button
                    onClick={() => setShowSchedulePaymentModal(true)}
                    className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Schedule Payment
                  </button>
                )}

                {/* Validation Results */}
                {validationResult && (
                  <div className={`mt-4 p-4 rounded-lg ${validationResult.passed ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className={`text-sm font-semibold mb-2 ${validationResult.passed ? 'text-green-800' : 'text-red-800'}`}>
                      {validationResult.passed ? 'Validation Passed' : 'Validation Failed'}
                    </p>
                    <div className="space-y-1">
                      {validationResult.results.map((result: any, idx: number) => (
                        <div key={idx} className="flex items-start text-xs">
                          <span className={`mr-2 ${result.passed ? 'text-green-600' : 'text-red-600'}`}>
                            {result.passed ? '✓' : '✗'}
                          </span>
                          <span className={result.passed ? 'text-green-700' : 'text-red-700'}>
                            {result.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedInvoice.exceptions && selectedInvoice.exceptions.length > 0 && (
                  <div className="mt-4 p-4 bg-red-50 rounded-lg">
                    <p className="text-sm font-semibold text-red-800 mb-2">Exceptions</p>
                    {selectedInvoice.exceptions.map((exc) => (
                      <p key={exc.id} className="text-xs text-red-700">
                        {exc.reason}: {exc.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Reject Invoice
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Payment Modal */}
      {showSchedulePaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Schedule Payment
              </h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowSchedulePaymentModal(false);
                    setPaymentDate('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSchedulePayment}
                  disabled={!paymentDate}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Schedule Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
