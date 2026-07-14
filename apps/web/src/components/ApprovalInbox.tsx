import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle, XCircle, Clock, ArrowLeft, Loader2 } from 'lucide-react';
import { MockInvoice } from '../lib/mockData';
import { Skeleton } from './ui/Skeleton';
import { isWithinRoleThreshold } from '../lib/roleAccess';

const mapUserRoleToSignatoryRoles = (role: string): string[] => {
  const mapping: Record<string, string[]> = {
    'PURCHASING_COORDINATOR': ['COORDINATOR'],
    'PURCHASING_MANAGER': ['PURCHASING_MANAGER'],
    'PLANNING_MANAGER': ['MLO_PLANNING_MANAGER'],
    'MLO_PLANNING_MANAGER': ['MLO_PLANNING_MANAGER'],
    'MLO_ACCOUNT_HOLDER': ['MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER'],
    'SR_MANAGER_GLOBAL_PRODUCTION': ['SR_MANAGER_GLOBAL_PRODUCTION'],
    'MS_POLLY': ['MS_POLLY'],
    'ACCOUNTING_ASSOCIATE': ['ACCOUNTING_REVIEWER'],
    'ACCOUNTING_SUPERVISOR': ['ACCOUNTING_REVIEWER'],
    'PRESIDENT': ['ACCOUNTING_REVIEWER'],
    'SUPERADMIN': [],
  };
  return mapping[role] || [];
};

export default function ApprovalInbox() {
  const { invoices, approveInvoice, rejectInvoice } = useMockData();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  // Filter invoices to show only pending approvals for the current user's role
  const pendingApprovals = invoices.filter(invoice => {
    if (!invoice.signatures || invoice.signatures.length === 0) return false;
    // Exclude invoices not in an active approval workflow
    const status = String(invoice.status || '');
    if (!status.startsWith('PENDING_') || status === 'PENDING_ACCOUNTING') return false;
    // Exclude invoices below the user's tier threshold
    if (user && !isWithinRoleThreshold(user.role, Number(invoice.total_amount))) return false;
    // Find the first unsigned signature (sequential enforcement — signatures are in route order)
    const firstPending = invoice.signatures.find(s => !s.signed_at);
    if (!firstPending) return false;
    const userSignatoryRoles = user ? mapUserRoleToSignatoryRoles(user.role) : [];
    return userSignatoryRoles.length > 0 ? userSignatoryRoles.includes(firstPending.signatory_role) : false;
  });

  // Pagination logic
  const totalPages = Math.ceil(pendingApprovals.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const displayedInvoices = pendingApprovals.slice(startIndex, endIndex);

  const handleApprove = async () => {
    if (!selectedInvoice || !user) return;

    try {
      setApproving(true);
      await approveInvoice(selectedInvoice.id, user.name);
      setSelectedInvoice(null);
    } catch (error) {
      console.error('Failed to approve invoice:', error);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim() || !user) return;

    try {
      setRejecting(true);
      await rejectInvoice(selectedInvoice.id, rejectReason);
      setSelectedInvoice(null);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error) {
      console.error('Failed to reject invoice:', error);
    } finally {
      setRejecting(false);
    }
  };

  const getApprovalStatus = (invoice: MockInvoice) => {
    if (!invoice.signatures || invoice.signatures.length === 0) return 'No approvals';
    
    const approved = invoice.signatures.filter(s => s.signed_at !== null).length;
    const total = invoice.signatures.length;
    const pending = invoice.signatures.find(s => !s.signed_at);
    
    if (pending) {
      return `Awaiting: ${pending.signatory_role}`;
    }
    
    return `${approved}/${total} approved`;
  };

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10">
        <header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center">
            <Link to="/" className="mr-4 transition-colors" style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
            </Link>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Approval Inbox</h1>
          </div>
        </header>

        <main className="px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Invoice List */}
            <div className="lg:col-span-2">
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Pending Approvals
                  </h2>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{pendingApprovals.length} items</span>
                </div>
                {loading ? (
                  <div className="px-6 py-4 space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                        <Skeleton className="h-10 w-10 rounded-xl" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <Skeleton className="h-6 w-20 rounded-lg" />
                      </div>
                    ))}
                  </div>
                ) : pendingApprovals.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <div className="inline-flex p-4 rounded-2xl mb-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                      <CheckCircle className="h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No pending approvals</p>
                  </div>
                ) : (
                  <>
                    <div>
                      {displayedInvoices.map((invoice, idx) => (
                      <div
                        key={invoice.id}
                        onClick={() => setSelectedInvoice(invoice)}
                        className="px-6 py-4 cursor-pointer transition-colors"
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
                          background: selectedInvoice?.id === invoice.id ? 'var(--bg-card-hover)' : undefined,
                        }}
                        onMouseEnter={(e) => { if (selectedInvoice?.id !== invoice.id) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                        onMouseLeave={(e) => { if (selectedInvoice?.id !== invoice.id) e.currentTarget.style.background = ''; }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                              <Clock className="h-5 w-5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                            </div>
                            <div>
                              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {invoice.invoice_number}
                              </p>
                              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                {invoice.vendor_name}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                              {invoice.currency} {Number(invoice.total_amount).toFixed(2)}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {getApprovalStatus(invoice)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Pagination Controls */}
                  <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => { if (currentPage !== 1) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      Previous
                    </button>
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => { if (currentPage !== totalPages) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      Next
                    </button>
                  </div>
                </>
                )}
              </div>
            </div>

            {/* Invoice Detail Panel */}
            {selectedInvoice && (
              <div className="lg:col-span-1">
                <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                  <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Invoice Details
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Number</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedInvoice.invoice_number}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedInvoice.vendor_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Amount</p>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {selectedInvoice.currency} {Number(selectedInvoice.total_amount).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Date</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedInvoice.invoice_date
                          ? new Date(selectedInvoice.invoice_date).toLocaleDateString()
                          : 'N/A'}
                      </p>
                    </div>

                    {/* Approval Progress */}
                    {selectedInvoice.signatures && selectedInvoice.signatures.length > 0 && (
                      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                          Approval Progress
                        </p>
                        <div className="space-y-2">
                          {selectedInvoice.signatures
                            .map((sig) => (
                              <div
                                key={sig.id}
                                className="flex items-center justify-between text-sm"
                              >
                                <span style={{ color: 'var(--text-secondary)' }}>{sig.signatory_role}</span>
                                <div className="flex items-center">
                                  {sig.signed_at && (
                                    <CheckCircle className="h-4 w-4 mr-1" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
                                  )}
                                  {!sig.signed_at && (
                                    <Clock className="h-4 w-4 mr-1" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                                  )}
                                  <span
                                    style={{
                                      color: sig.signed_at ? 'var(--accent-lime)' : 'var(--accent-amber)',
                                    }}
                                  >
                                    {sig.signed_at ? 'Signed' : 'Pending'}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="pt-4 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <button
                        onClick={handleApprove}
                        disabled={approving}
                        className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-semibold text-sm"
                        style={approving
                          ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                          : { background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px var(--accent-lime-glow)' }
                        }
                        onMouseEnter={(e) => { if (!approving) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                        onMouseLeave={(e) => { if (!approving) e.currentTarget.style.background = 'var(--accent-lime)'; }}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                        {approving ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => setShowRejectModal(true)}
                        disabled={rejecting}
                        className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                          color: 'var(--accent-red)',
                          border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)',
                        }}
                        onMouseEnter={(e) => { if (!rejecting) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                        onMouseLeave={(e) => { if (!rejecting) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                      >
                        <XCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="max-w-md w-full mx-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Reject Invoice
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || rejecting}
                  className="px-4 py-2 rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-medium"
                  style={!rejectReason.trim() || rejecting
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-red)', color: '#fff' }
                  }
                  onMouseEnter={(e) => { if (rejectReason.trim() && !rejecting) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
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
