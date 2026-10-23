import { useCallback, useEffect, useState } from 'react';
import { Check, Download, FileText, Landmark, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { vendorApi } from '../lib/api';

interface VendorMasterRequest {
  id: string;
  request_type: 'NEW_VENDOR' | 'BANK_UPDATE';
  vendor_id: string | null;
  vendor_name: string;
  proposed_data: Record<string, any>;
  reason: string;
  requested_by: string;
  status: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  synced_invoice_count?: number;
  has_attachment: boolean;
  attachment_filename?: string | null;
  created_at: string;
}

const displayFields = ['beneficiary_name', 'bank_name', 'swift_code', 'account_number', 'iban', 'bank_address', 'intermediary_bank_name', 'intermediary_bank_swift', 'bank_name_alt', 'swift_code_alt', 'account_number_alt'];

export default function VendorMasterRequests() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState<VendorMasterRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const isAssociate = user?.role === 'ACCOUNTING_ASSOCIATE';

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const response = await vendorApi.getMasterRequests(isAssociate ? 'PENDING' : undefined);
      setRequests(response.data || []);
    } catch (error: any) {
      showToast(error?.response?.data?.error?.message || 'Failed to load vendor-master requests', 'error');
    } finally {
      setLoading(false);
    }
  }, [isAssociate, showToast]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const downloadAttachment = async (request: VendorMasterRequest) => {
    try {
      const response = await vendorApi.downloadMasterRequestAttachment(request.id);
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = request.attachment_filename || 'vendor-supporting-document';
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      showToast(error?.response?.data?.error?.message || 'Unable to download attachment', 'error');
    }
  };

  const approve = async (request: VendorMasterRequest) => {
    setActionId(request.id);
    try {
      const response = await vendorApi.approveMasterRequest(request.id);
      showToast(response.data?.message || 'Vendor-master request approved', 'success');
      await loadRequests();
    } catch (error: any) {
      showToast(error?.response?.data?.error?.message || 'Failed to approve vendor-master request', 'error');
    } finally {
      setActionId(null);
    }
  };

  const reject = async (request: VendorMasterRequest) => {
    const reason = window.prompt('Reason for rejection (optional):') || '';
    setActionId(`${request.id}:reject`);
    try {
      await vendorApi.rejectMasterRequest(request.id, reason.trim() || undefined);
      showToast('Vendor-master request rejected', 'success');
      await loadRequests();
    } catch (error: any) {
      showToast(error?.response?.data?.error?.message || 'Failed to reject vendor-master request', 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="p-6 space-y-4" style={{ color: 'var(--text-primary)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-amber), var(--accent-purple))' }}><Landmark className="h-6 w-6 text-white" /></div>
          <div><h1 className="text-xl font-bold">Vendor / Bank Requests</h1><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{isAssociate ? 'Review coordinator requests before they update the vendor master and matching invoices.' : 'Track your submitted vendor-master requests.'}</p></div>
        </div>
        <button type="button" onClick={() => void loadRequests()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      {loading ? <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>Loading requests...</div> : requests.length === 0 ? <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}>{isAssociate ? 'No pending vendor-master requests.' : 'No vendor-master requests submitted yet.'}</div> : (
        <div className="space-y-3">
          {requests.map((request) => {
            const proposed = request.proposed_data || {};
            const fieldEntries = displayFields.filter((field) => proposed[field] !== undefined && proposed[field] !== null && proposed[field] !== '').map((field) => [field, proposed[field]] as const);
            const pending = request.status === 'PENDING';
            return (
              <div key={request.id} className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3"><FileText className="h-5 w-5 mt-0.5" style={{ color: 'var(--accent-blue)' }} /><div><div className="flex items-center gap-2"><h2 className="font-semibold">{request.request_type === 'NEW_VENDOR' ? 'New vendor' : 'Bank details update'}: {request.vendor_name}</h2><span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: pending ? 'color-mix(in srgb, var(--accent-amber) 14%, transparent)' : request.status === 'APPROVED' ? 'color-mix(in srgb, var(--accent-lime) 14%, transparent)' : 'color-mix(in srgb, var(--accent-red) 14%, transparent)', color: pending ? 'var(--accent-amber)' : request.status === 'APPROVED' ? 'var(--accent-lime)' : 'var(--accent-red)' }}>{request.status}</span></div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Requested by {request.requested_by} · {new Date(request.created_at).toLocaleString()}</div></div></div>
                  {request.has_attachment && <button type="button" onClick={() => void downloadAttachment(request)} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' }}><Download className="h-3.5 w-3.5" /> {request.attachment_filename || 'Attachment'}</button>}
                </div>
                {fieldEntries.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">{fieldEntries.map(([field, value]) => <div key={field} className="rounded-lg p-2" style={{ background: 'var(--bg-elevated)' }}><div className="text-[11px] uppercase" style={{ color: 'var(--text-muted)' }}>{field.replace(/_/g, ' ')}</div><div className="text-sm break-words" style={{ color: 'var(--text-secondary)' }}>{Array.isArray(value) ? value.join(', ') : String(value)}</div></div>)}</div>}
                <div className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}><span className="text-xs" style={{ color: 'var(--text-muted)' }}>Reason: </span>{request.reason}</div>
                {request.synced_invoice_count ? <div className="text-xs mb-3" style={{ color: 'var(--accent-lime)' }}>{request.synced_invoice_count} matching invoice(s) synchronized after approval.</div> : null}
                {isAssociate && pending && <div className="flex justify-end gap-2"><button type="button" onClick={() => void approve(request)} disabled={actionId !== null} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-lime) 14%, transparent)', color: 'var(--accent-lime)' }}><Check className="h-3.5 w-3.5" />{actionId === request.id ? 'Approving...' : 'Approve & Sync'}</button><button type="button" onClick={() => void reject(request)} disabled={actionId !== null} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-red) 14%, transparent)', color: 'var(--accent-red)' }}><X className="h-3.5 w-3.5" />{actionId === `${request.id}:reject` ? 'Rejecting...' : 'Reject'}</button></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
