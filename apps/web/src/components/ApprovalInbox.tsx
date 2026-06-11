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
        <header style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4">
          <div className="flex items-center">
            <Link to="/" className="mr-4 text-slate-300 hover:text-white transition-colors">
              <ArrowLeft className="h-6 w-6" />
            </Link>
            <h1 className="text-2xl font-bold text-white">Approval Inbox</h1>
          </div>
        </header>

        <main className="px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Invoice List */}
            <div className="lg:col-span-2">
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
                <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <h2 className="text-lg font-semibold text-white">
                    Pending Approvals ({invoices.length})
                  </h2>
                </div>
                {loading ? (
                  <div className="px-6 py-12 text-center text-slate-400">Loading...</div>
                ) : invoices.length === 0 ? (
                  <div className="px-6 py-12 text-center text-slate-400">
                    No pending approvals
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {invoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        onClick={() => setSelectedInvoice(invoice)}
                        className={`px-6 py-4 cursor-pointer transition-colors ${
                          selectedInvoice?.id === invoice.id ? 'bg-white/5' : ''
                        }`}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 150ms ease' }}
                        onMouseEnter={(e) => {
                          if (selectedInvoice?.id !== invoice.id) {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedInvoice?.id !== invoice.id) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="p-2 rounded-lg" style={{ background: 'rgba(234, 179, 8, 0.2)' }}>
                              <Clock className="h-5 w-5 text-amber-400" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-white">
                                {invoice.invoice_number}
                              </p>
                              <p className="text-sm text-slate-400">
                                {invoice.vendor?.name}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-white">
                              {invoice.currency} {Number(invoice.amount).toFixed(2)}
                            </p>
                            <p className="text-xs text-slate-400">
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
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
                  <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <h3 className="text-lg font-semibold text-white">
                      Invoice Details
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <p className="text-sm text-slate-400">Invoice Number</p>
                      <p className="text-sm font-medium text-white">
                        {selectedInvoice.invoice_number}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Vendor</p>
                      <p className="text-sm font-medium text-white">
                        {selectedInvoice.vendor?.name}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Amount</p>
                      <p className="text-sm font-medium text-white">
                        {selectedInvoice.currency} {Number(selectedInvoice.amount).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Due Date</p>
                      <p className="text-sm font-medium text-white">
                        {selectedInvoice.invoice_due_date
                          ? new Date(selectedInvoice.invoice_due_date).toLocaleDateString()
                          : 'N/A'}
                      </p>
                    </div>

                    {/* Approval Progress */}
                    {selectedInvoice.signatures && selectedInvoice.signatures.length > 0 && (
                      <div className="pt-4" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <p className="text-sm font-medium text-white mb-3">
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
                                <span className="text-slate-300">{sig.role}</span>
                                <div className="flex items-center">
                                  {sig.status === 'APPROVED' && (
                                    <CheckCircle className="h-4 w-4 text-green-400 mr-1" />
                                  )}
                                  {sig.status === 'REJECTED' && (
                                    <XCircle className="h-4 w-4 text-red-400 mr-1" />
                                  )}
                                  {sig.status === 'PENDING' && (
                                    <Clock className="h-4 w-4 text-amber-400 mr-1" />
                                  )}
                                  <span
                                    className={`${
                                      sig.status === 'APPROVED'
                                        ? 'text-green-400'
                                        : sig.status === 'REJECTED'
                                        ? 'text-red-400'
                                        : 'text-amber-400'
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
                    <div className="pt-4 space-y-2" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <button
                        onClick={handleApprove}
                        disabled={approving}
                        className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {approving ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => setShowRejectModal(true)}
                        disabled={rejecting}
                        className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
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
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div style={{ background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} className="max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Reject Invoice
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-white placeholder-slate-400"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || rejecting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
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
