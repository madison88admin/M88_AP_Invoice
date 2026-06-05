import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { exceptionApi } from '../lib/api';
import { AlertTriangle, CheckCircle, XCircle, Clock, ArrowLeft } from 'lucide-react';

interface Exception {
  id: string;
  reason: string;
  description: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  invoice: {
    id: string;
    invoice_number: string;
    amount: number;
    currency: string;
    vendor: {
      name: string;
    };
  };
}

export default function ExceptionManager() {
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedException, setSelectedException] = useState<Exception | null>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showWaiveModal, setShowWaiveModal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [waiverReason, setWaiverReason] = useState('');

  const loadExceptions = async () => {
    try {
      const response = await exceptionApi.getPending();
      setExceptions(response.data);
    } catch (error) {
      console.error('Failed to load exceptions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExceptions();
  }, []);

  const handleResolve = async () => {
    if (!selectedException || !resolution.trim()) return;

    try {
      await exceptionApi.resolve(selectedException.id, resolution);
      await loadExceptions();
      setSelectedException(null);
      setShowResolveModal(false);
      setResolution('');
    } catch (error) {
      console.error('Failed to resolve exception:', error);
    }
  };

  const handleWaive = async () => {
    if (!selectedException || !waiverReason.trim()) return;

    try {
      await exceptionApi.waive(selectedException.id, waiverReason);
      await loadExceptions();
      setSelectedException(null);
      setShowWaiveModal(false);
      setWaiverReason('');
    } catch (error) {
      console.error('Failed to waive exception:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      case 'RESOLVED':
        return 'bg-green-100 text-green-800';
      case 'WAIVED':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading exceptions...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link to="/" className="text-gray-600 hover:text-gray-900">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Exception Manager</h1>
            </div>
            <div className="text-sm text-gray-600">
              {exceptions.length} pending exceptions
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {exceptions.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Pending Exceptions</h3>
            <p className="text-gray-600">All exceptions have been resolved or waived.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Exception List */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b">
                <h2 className="text-lg font-semibold text-gray-900">Pending Exceptions</h2>
              </div>
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {exceptions.map((exception) => (
                  <div
                    key={exception.id}
                    onClick={() => setSelectedException(exception)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 ${
                      selectedException?.id === exception.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        <span className="font-medium text-gray-900">{exception.reason}</span>
                      </div>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(exception.status)}`}>
                        {exception.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mb-2">
                      Invoice: {exception.invoice.invoice_number}
                    </div>
                    <div className="text-sm text-gray-600 mb-2">
                      Vendor: {exception.invoice.vendor.name}
                    </div>
                    <div className="text-sm text-gray-600">
                      Amount: {exception.invoice.currency} {exception.invoice.amount.toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Created: {new Date(exception.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Exception Detail */}
            {selectedException && (
              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-semibold text-gray-900">Exception Details</h2>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <div className="text-gray-900">{selectedException.reason}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <div className="text-gray-900">{selectedException.description}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Invoice</label>
                    <div className="text-gray-900">{selectedException.invoice.invoice_number}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                    <div className="text-gray-900">{selectedException.invoice.vendor.name}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                    <div className="text-gray-900">
                      {selectedException.invoice.currency} {selectedException.invoice.amount.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Created</label>
                    <div className="text-gray-900">
                      {new Date(selectedException.created_at).toLocaleString()}
                    </div>
                  </div>
                  {selectedException.resolution && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
                      <div className="text-gray-900">{selectedException.resolution}</div>
                    </div>
                  )}
                  {selectedException.resolved_at && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Resolved At</label>
                      <div className="text-gray-900">
                        {new Date(selectedException.resolved_at).toLocaleString()}
                      </div>
                    </div>
                  )}

                  {selectedException.status === 'PENDING' && (
                    <div className="space-y-2 pt-4 border-t">
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

      {/* Resolve Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Resolve Exception
              </h3>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Please describe how this exception was resolved..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowResolveModal(false);
                    setResolution('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolve}
                  disabled={!resolution.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Waive Exception
              </h3>
              <textarea
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                placeholder="Please provide a reason for waiving this exception..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowWaiveModal(false);
                    setWaiverReason('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleWaive}
                  disabled={!waiverReason.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
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
