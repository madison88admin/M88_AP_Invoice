import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { AlertTriangle, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { MockException } from '../lib/mockData';
import { exceptionApi } from '../lib/api';

export default function ExceptionManager() {
  const { invoices, resolveException } = useMockData();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedException, setSelectedException] = useState<MockException | null>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showWaiveModal, setShowWaiveModal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [waiverReason, setWaiverReason] = useState('');

  // Get exceptions from invoices
  const exceptions = invoices.reduce((acc: MockException[], invoice) => {
    return [...acc, ...invoice.exceptions];
  }, []);

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  const handleResolve = async () => {
    if (!selectedException || !resolution.trim() || !user) return;

    try {
      await resolveException(selectedException.invoice_id, selectedException.id, resolution);
      setSelectedException(null);
      setShowResolveModal(false);
      setResolution('');
    } catch (error) {
      console.error('Failed to resolve exception:', error);
    }
  };

  const handleWaive = async () => {
    if (!selectedException || !waiverReason.trim() || !user) return;

    try {
      await exceptionApi.waive(selectedException.id, waiverReason);
      setSelectedException(null);
      setShowWaiveModal(false);
      setWaiverReason('');
    } catch (error) {
      console.error('Failed to waive exception:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'bg-amber-500/20 text-amber-300';
      case 'RESOLVED':
        return 'bg-green-500/20 text-green-300';
      case 'WAIVED':
        return 'bg-blue-500/20 text-blue-300';
      default:
        return 'bg-slate-500/20 text-slate-300';
    }
  };

  // Get invoice for an exception
  const getInvoiceForException = (exception: MockException) => {
    return invoices.find(inv => inv.id === exception.invoice_id);
  };

  // Filter to show only OPEN exceptions
  const openExceptions = exceptions.filter(exc => exc.status === 'OPEN');

  // Get invoice for selected exception
  const selectedInvoice = selectedException ? getInvoiceForException(selectedException) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-slate-400">Loading exceptions...</div>
      </div>
    );
  }

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
        <div style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link to="/" className="text-slate-300 hover:text-white transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-2xl font-bold text-white">Exception Manager</h1>
            </div>
            <div className="text-sm text-slate-400">
              {exceptions.length} pending exceptions
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          {exceptions.length === 0 ? (
            <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Pending Exceptions</h3>
              <p className="text-slate-400">All exceptions have been resolved or waived.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Exception List */}
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
                <div className="p-4" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <h2 className="text-lg font-semibold text-white">Pending Exceptions</h2>
                </div>
                <div className="divide-y divide-white/5 max-h-[600px] overflow-y-auto">
                  {openExceptions.map((exception) => {
                    const invoice = getInvoiceForException(exception);
                    if (!invoice) return null;
                    return (
                      <div
                        key={exception.id}
                        onClick={() => setSelectedException(exception)}
                        className={`p-4 cursor-pointer transition-colors ${
                          selectedException?.id === exception.id ? 'bg-white/5' : ''
                        }`}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 150ms ease' }}
                        onMouseEnter={(e) => {
                          if (selectedException?.id !== exception.id) {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedException?.id !== exception.id) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                          <AlertTriangle className="h-5 w-5 text-amber-400" />
                          <span className="font-medium text-white">{exception.reason}</span>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(exception.status)}`}>
                          {exception.status}
                        </span>
                      </div>
                      <div className="text-sm text-slate-400 mb-2">
                        Invoice: {invoice.invoice_number}
                      </div>
                      <div className="text-sm text-slate-400 mb-2">
                        Vendor: {invoice.vendor_name}
                      </div>
                      <div className="text-sm text-slate-400">
                        Amount: {invoice.currency} {invoice.total_amount.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-500 mt-2">
                        Created: {new Date(exception.created_at).toLocaleString()}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Exception Detail */}
              {selectedException && selectedInvoice && (
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
                  <div className="p-4" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <h2 className="text-lg font-semibold text-white">Exception Details</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Reason</label>
                      <div className="text-white">{selectedException.reason}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
                      <div className="text-white">{selectedException.description}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Invoice</label>
                      <div className="text-white">{selectedInvoice.invoice_number}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Vendor</label>
                      <div className="text-white">{selectedInvoice.vendor_name}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Amount</label>
                      <div className="text-white">
                        {selectedInvoice.currency} {selectedInvoice.total_amount.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Created</label>
                      <div className="text-white">
                        {new Date(selectedException.created_at).toLocaleString()}
                      </div>
                    </div>
                    {selectedException.resolution_notes && (
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Resolution</label>
                        <div className="text-white">{selectedException.resolution_notes}</div>
                      </div>
                    )}
                    {selectedException.resolved_at && (
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Resolved At</label>
                        <div className="text-white">
                          {new Date(selectedException.resolved_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                    {selectedException.resolved_by && (
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Resolved By</label>
                        <div className="text-white">{selectedException.resolved_by}</div>
                      </div>
                    )}
                    {selectedException.status === 'OPEN' && (
                      <div className="space-y-2 pt-4" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <button
                          onClick={() => setShowResolveModal(true)}
                          className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Resolve Exception
                        </button>
                        <button
                          onClick={() => setShowWaiveModal(true)}
                          className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Waive Exception
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Resolve Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div style={{ background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} className="max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Resolve Exception
              </h3>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Please describe how this exception was resolved..."
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-white placeholder-slate-400"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowResolveModal(false);
                    setResolution('');
                  }}
                  className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolve}
                  disabled={!resolution.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
                >
                  Confirm Resolution
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waive Modal */}
      {showWaiveModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div style={{ background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} className="max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Waive Exception
              </h3>
              <textarea
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="Please provide a reason for waiving this exception..."
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-slate-400"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowWaiveModal(false);
                    setWaiverReason('');
                  }}
                  className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleWaive}
                  disabled={!waiverReason.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
                >
                  Confirm Waiver
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
