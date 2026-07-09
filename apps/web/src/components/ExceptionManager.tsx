import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { AlertTriangle, CheckCircle, XCircle, ArrowLeft, AlertCircle, Search } from 'lucide-react';
import { MockException } from '../lib/mockData';
import { exceptionApi } from '../lib/api';
import { getStatusStyle } from '../lib/statusStyle';

type ExceptionFilter = 'OPEN' | 'RESOLVED' | 'WAIVED' | 'ALL';

export default function ExceptionManager() {
  const { invoices, resolveException } = useMockData();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ExceptionFilter>('OPEN');
  const [selectedException, setSelectedException] = useState<MockException | null>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showWaiveModal, setShowWaiveModal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [waiverReason, setWaiverReason] = useState('');
  const [approvalWarning, setApprovalWarning] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Get exceptions from invoices
  const exceptions = invoices.reduce((acc: MockException[], invoice) => {
    return [...acc, ...invoice.exceptions];
  }, []);

  // Sort by creation time (FIFO) and apply status + search filter
  const filteredExceptions = exceptions
    .filter(exc => filter === 'ALL' || exc.status === filter)
    .filter(exc => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const invoice = getInvoiceForException(exc);
      return [
        exc.reason,
        exc.description,
        exc.detail,
        exc.resolution_notes,
        invoice?.invoice_number,
        invoice?.vendor_name,
      ].filter(Boolean).some(field => String(field).toLowerCase().includes(q));
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  const handleResolve = async () => {
    if (!selectedException || !resolution.trim() || !user) return;

    try {
      const result = await resolveException(selectedException.invoice_id, selectedException.id, resolution);
      setSelectedException(null);
      setShowResolveModal(false);
      setResolution('');
      if (result?.approvalWarning) {
        setApprovalWarning(result.approvalWarning);
      }
    } catch (error) {
      console.error('Failed to resolve exception:', error);
    }
  };

  const handleWaive = async () => {
    if (!selectedException || !waiverReason.trim() || !user) return;

    try {
      const res = await exceptionApi.waive(selectedException.id, waiverReason);
      setSelectedException(null);
      setShowWaiveModal(false);
      setWaiverReason('');
      if (res.data?.approvalWarning) {
        setApprovalWarning(res.data.approvalWarning);
      }
    } catch (error) {
      console.error('Failed to waive exception:', error);
    }
  };

  // getStatusStyle is imported from lib/statusStyle.ts

  // Get invoice for an exception
  const getInvoiceForException = (exception: MockException) => {
    return invoices.find(inv => inv.id === exception.invoice_id);
  };

  // Get invoice for selected exception
  const selectedInvoice = selectedException ? getInvoiceForException(selectedException) : null;

  const filterTabs: { key: ExceptionFilter; label: string }[] = [
    { key: 'OPEN', label: 'Active' },
    { key: 'RESOLVED', label: 'Resolved' },
    { key: 'WAIVED', label: 'Waived' },
    { key: 'ALL', label: 'All' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading exceptions...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10">
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link to="/" className="transition-colors" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
              </Link>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Exception Manager</h1>
            </div>
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {exceptions.filter(exc => exc.status === 'OPEN').length} active / {exceptions.length} total
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          {/* Approval warning banner */}
          {approvalWarning && (
            <div className="mb-4 p-4 rounded-xl flex items-start gap-3" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>{approvalWarning}</p>
              </div>
              <button
                onClick={() => setApprovalWarning(null)}
                className="transition-colors"
                style={{ color: 'color-mix(in srgb, var(--accent-amber) 60%, transparent)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-amber)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'color-mix(in srgb, var(--accent-amber) 60%, transparent)'; }}
              >
                <XCircle className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          )}

          {/* Search bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by invoice number, vendor, exception reason..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none text-sm transition-all"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <XCircle className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mb-4">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setFilter(tab.key); setSelectedException(null); }}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={filter === tab.key
                  ? { background: 'var(--accent-purple)', color: '#fff', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 20%, transparent)' }
                  : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }
                }
                onMouseEnter={(e) => { if (filter !== tab.key) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                onMouseLeave={(e) => { if (filter !== tab.key) { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
              >
                {tab.label}
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full" style={{ background: filter === tab.key ? 'rgba(255,255,255,0.2)' : 'var(--bg-card-hover)' }}>
                  {exceptions.filter(exc => tab.key === 'ALL' || exc.status === tab.key).length}
                </span>
              </button>
            ))}
          </div>

          {filteredExceptions.length === 0 ? (
            <div className="p-8 text-center rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
              <div className="inline-flex p-4 rounded-2xl mb-3" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color)' }}>
                <CheckCircle className="h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No {filter === 'ALL' ? '' : filter.toLowerCase()} exceptions</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filter === 'OPEN' ? 'All active exceptions have been resolved or waived.' : 'No exceptions found for this filter.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Exception List */}
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {filter === 'OPEN' ? 'Active Exceptions' : `${filter.charAt(0) + filter.slice(1).toLowerCase()} Exceptions`}
                    <span className="ml-2 text-sm font-normal" style={{ color: 'var(--text-muted)' }}>(oldest first)</span>
                  </h2>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {filteredExceptions.map((exception: MockException, idx) => {
                    const invoice = getInvoiceForException(exception);
                    if (!invoice) return null;
                    return (
                      <div
                        key={exception.id}
                        onClick={() => setSelectedException(exception)}
                        className="p-4 cursor-pointer transition-colors"
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
                          background: selectedException?.id === exception.id ? 'var(--bg-card-hover)' : undefined,
                        }}
                        onMouseEnter={(e) => { if (selectedException?.id !== exception.id) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                        onMouseLeave={(e) => { if (selectedException?.id !== exception.id) e.currentTarget.style.background = ''; }}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                          <AlertTriangle className="h-5 w-5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{exception.reason}</span>
                        </div>
                        <span className="px-2 py-1 text-xs font-medium rounded-full" style={getStatusStyle(exception.status)}>
                          {exception.status}
                        </span>
                      </div>
                      <div className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Invoice: {invoice.invoice_number}
                      </div>
                      <div className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Vendor: {invoice.vendor_name}
                      </div>
                      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Amount: {invoice.currency} {invoice.total_amount.toFixed(2)}
                      </div>
                      <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                        Created: {new Date(exception.created_at).toLocaleString()}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Exception Detail */}
              {selectedException && selectedInvoice && (
                <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                  <div className="p-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Exception Details</h2>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Reason</label>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedException.reason}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedException.description}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice</label>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.invoice_number}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</label>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedInvoice.vendor_name}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Amount</label>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {selectedInvoice.currency} {selectedInvoice.total_amount.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Created</label>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {new Date(selectedException.created_at).toLocaleString()}
                      </div>
                    </div>
                    {selectedException.resolution_notes && (
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Resolution</label>
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedException.resolution_notes}</div>
                      </div>
                    )}
                    {selectedException.resolved_at && (
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Resolved At</label>
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          {new Date(selectedException.resolved_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                    {selectedException.resolved_by && (
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Resolved By</label>
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedException.resolved_by}</div>
                      </div>
                    )}
                    {selectedException.status === 'OPEN' && (
                      <div className="space-y-2 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <button
                          onClick={() => setShowResolveModal(true)}
                          className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-semibold text-sm"
                          style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px var(--accent-lime-glow)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-lime)'; }}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                          Resolve Exception
                        </button>
                        <button
                          onClick={() => setShowWaiveModal(true)}
                          className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm"
                          style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 20%, transparent)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 10%, transparent)'; }}
                        >
                          <XCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="max-w-md w-full mx-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Resolve Exception
              </h3>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Please describe how this exception was resolved..."
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowResolveModal(false);
                    setResolution('');
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolve}
                  disabled={!resolution.trim()}
                  className="px-4 py-2 rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-semibold"
                  style={!resolution.trim()
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-lime)', color: 'var(--bg-base)' }
                  }
                  onMouseEnter={(e) => { if (resolution.trim()) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                  onMouseLeave={(e) => { if (resolution.trim()) e.currentTarget.style.background = 'var(--accent-lime)'; }}
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="max-w-md w-full mx-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Waive Exception
              </h3>
              <textarea
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="Please provide a reason for waiving this exception..."
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowWaiveModal(false);
                    setWaiverReason('');
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleWaive}
                  disabled={!waiverReason.trim()}
                  className="px-4 py-2 rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-medium"
                  style={!waiverReason.trim()
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-blue)', color: '#fff' }
                  }
                  onMouseEnter={(e) => { if (waiverReason.trim()) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
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
