import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Invoice, InvoiceStatus } from '@ap-invoice/shared';
import { approvalApi, invoiceApi } from '../lib/api';
import { CheckCircle, XCircle, Clock, FileText, ArrowLeft } from 'lucide-react';

export default function ApprovalInbox() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  useEffect(() => {
    loadPendingApprovals();
  }, []);

  const loadPendingApprovals = async () => {
    try {
      setLoading(true);
      const response = await approvalApi.getPending();
      setInvoices(response.data);
    } catch (error) {
      console.error('Failed to load pending approvals:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedInvoice) return;

    try {
      setApproving(true);
      const signerName = 'Current User'; // In production, this would come from user context
      await invoiceApi.approve(selectedInvoice.id, signerName);
      await loadPendingApprovals();
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Failed to approve invoice:', error);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim()) return;

    try {
      setRejecting(true);
      await invoiceApi.reject(selectedInvoice.id, rejectReason);
      await loadPendingApprovals();
      setSelectedInvoice(null);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      console.error('Failed to reject invoice:', error);
    } finally {
      setRejecting(false);
    }
  };

  const getApprovalStatus = (invoice: Invoice) => {
    if (!invoice.signatures || invoice.signatures.length === 0) return 'No approvals';
    
    const approved = invoice.signatures.filter(s => s.status === 'APPROVED').length;
    const total = invoice.signatures.length;
    const pending = invoice.signatures.find(s => s.status === 'PENDING');
    
    if (pending) {
      return `Awaiting: ${pending.role}`;
    }
    
    return `${approved}/${total} approved`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center">
            <Link to="/" className="mr-4 text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-6 w-6" />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Approval Inbox</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Invoice List */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Pending Approvals ({invoices.length})
                </h2>
              </div>
              {loading ? (
                <div className="px-6 py-12 text-center text-gray-500">Loading...</div>
              ) : invoices.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  No pending approvals
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      onClick={() => setSelectedInvoice(invoice)}
                      className={`px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedInvoice?.id === invoice.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="bg-yellow-100 p-2 rounded-lg">
                            <Clock className="h-5 w-5 text-yellow-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {invoice.invoice_number}
                            </p>
                            <p className="text-sm text-gray-500">
                              {invoice.vendor?.name}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-900">
                            {invoice.currency} {Number(invoice.amount).toFixed(2)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {getApprovalStatus(invoice)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Invoice Detail Panel */}
          {selectedInvoice && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Invoice Details
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Invoice Number</p>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedInvoice.invoice_number}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Vendor</p>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedInvoice.vendor?.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Amount</p>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedInvoice.currency} {Number(selectedInvoice.amount).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Due Date</p>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedInvoice.invoice_due_date
                        ? new Date(selectedInvoice.invoice_due_date).toLocaleDateString()
                        : 'N/A'}
                    </p>
                  </div>

                  {/* Approval Progress */}
                  {selectedInvoice.signatures && selectedInvoice.signatures.length > 0 && (
                    <div className="pt-4 border-t border-gray-200">
                      <p className="text-sm font-medium text-gray-900 mb-3">
                        Approval Progress
                      </p>
                      <div className="space-y-2">
                        {selectedInvoice.signatures
                          .sort((a, b) => a.order - b.order)
                          .map((sig) => (
                            <div
                              key={sig.id}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-gray-600">{sig.role}</span>
                              <div className="flex items-center">
                                {sig.status === 'APPROVED' && (
                                  <CheckCircle className="h-4 w-4 text-green-500 mr-1" />
                                )}
                                {sig.status === 'REJECTED' && (
                                  <XCircle className="h-4 w-4 text-red-500 mr-1" />
                                )}
                                {sig.status === 'PENDING' && (
                                  <Clock className="h-4 w-4 text-yellow-500 mr-1" />
                                )}
                                <span
                                  className={`${
                                    sig.status === 'APPROVED'
                                      ? 'text-green-600'
                                      : sig.status === 'REJECTED'
                                      ? 'text-red-600'
                                      : 'text-yellow-600'
                                  }`}
                                >
                                  {sig.status.toLowerCase()}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-4 border-t border-gray-200 space-y-2">
                    <button
                      onClick={handleApprove}
                      disabled={approving}
                      className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {approving ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={rejecting}
                      className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
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
                  disabled={!rejectReason.trim() || rejecting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {rejecting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
