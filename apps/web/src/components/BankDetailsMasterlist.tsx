import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { vendorApi } from '../lib/api';
import { Landmark, Search, Edit, Save, X, ArrowLeft, CheckCircle2, AlertCircle, Landmark as BankIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface BankDetailsEntry {
  id: string;
  name: string;
  beneficiary_name: string | null;
  classification: string | null;
  supplier_location: string | null;
  bank_name: string | null;
  bank_name_alt: string | null;
  bank_address: string | null;
  swift_code: string | null;
  swift_code_alt: string | null;
  account_number: string | null;
  account_number_alt: string | null;
  iban: string | null;
  sort_code: string | null;
  aba_routing_number: string | null;
  intermediary_bank_name: string | null;
  intermediary_bank_swift: string | null;
  has_multiple_accounts: boolean;
  bank_verified_at: string | null;
  invoice_count: number;
}

export default function BankDetailsMasterlist() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [bankDetails, setBankDetails] = useState<BankDetailsEntry[]>([]);
  const [search, setSearch] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<BankDetailsEntry | null>(null);
  const [editData, setEditData] = useState<Partial<BankDetailsEntry>>({});
  const [saving, setSaving] = useState(false);

  const canEditBank = user && ['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role);

  useEffect(() => {
    loadBankDetails();
  }, []);

  const loadBankDetails = async () => {
    try {
      setLoading(true);
      const res = await vendorApi.getBankDetails();
      setBankDetails(res.data);
    } catch (err: any) {
      showToast('Failed to load bank details', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filtered = bankDetails.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.beneficiary_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.bank_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.swift_code || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.account_number || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (entry: BankDetailsEntry) => {
    setEditingEntry(entry);
    setEditData({
      bank_name: entry.bank_name,
      bank_name_alt: entry.bank_name_alt,
      bank_address: entry.bank_address,
      swift_code: entry.swift_code,
      swift_code_alt: entry.swift_code_alt,
      account_number: entry.account_number,
      account_number_alt: entry.account_number_alt,
      iban: entry.iban,
      sort_code: entry.sort_code,
      aba_routing_number: entry.aba_routing_number,
      intermediary_bank_name: entry.intermediary_bank_name,
      intermediary_bank_swift: entry.intermediary_bank_swift,
    });
    setShowEditModal(true);
  };

  const handleSave = async () => {
    if (!editingEntry) return;
    setSaving(true);
    try {
      const res = await vendorApi.updateBankDetails(editingEntry.id, editData);
      showToast(res.data.message, 'success');
      setShowEditModal(false);
      setEditingEntry(null);
      setEditData({});
      await loadBankDetails();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update bank details', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setShowEditModal(false);
    setEditingEntry(null);
    setEditData({});
  };

  const editField = (label: string, field: keyof BankDetailsEntry, type: string = 'text') => (
    <div>
      <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        type={type}
        value={(editData[field] as string) || ''}
        onChange={(e) => setEditData({ ...editData, [field]: e.target.value })}
        className="w-full p-2 rounded-lg text-sm mt-1"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
      />
    </div>
  );

  return (
    <div className="p-6 space-y-4" style={{ color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' }}>
            <Landmark className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Bank Details Masterlist</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Centralized bank information linked to vendor masterlist. Changes propagate to all related invoices.
            </p>
          </div>
        </div>
        <Link to="/" className="flex items-center gap-2 text-sm hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
        <Search className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Search by vendor, bank, SWIFT, or account number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: 'var(--text-primary)' }}
        />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} vendor{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Info banner */}
      {canEditBank && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}>
          <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>
            Click the <strong>Edit</strong> button on any vendor row to update bank details. Changes will propagate to all linked invoices.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg" style={{ background: 'var(--bg-card)' }}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading bank details...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No vendors found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th className="text-left p-3 font-semibold">Vendor</th>
                <th className="text-left p-3 font-semibold">Bank Name</th>
                <th className="text-left p-3 font-semibold">SWIFT Code</th>
                <th className="text-left p-3 font-semibold">Account Number</th>
                <th className="text-center p-3 font-semibold">Invoices</th>
                <th className="text-center p-3 font-semibold">Verified</th>
                {canEditBank && <th className="text-center p-3 font-semibold">Action</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-color)' }} className="hover:opacity-80">
                  {/* Vendor name */}
                  <td className="p-3">
                    <div className="font-medium">{entry.name}</div>
                    {entry.classification && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{entry.classification}</div>
                    )}
                    {entry.beneficiary_name && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Beneficiary: {entry.beneficiary_name}</div>
                    )}
                  </td>

                  {/* Bank Name */}
                  <td className="p-3">
                    <div>{entry.bank_name || '-'}</div>
                    {entry.has_multiple_accounts && entry.bank_name_alt && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt: {entry.bank_name_alt}</div>
                    )}
                  </td>

                  {/* SWIFT Code */}
                  <td className="p-3">
                    <div>{entry.swift_code || '-'}</div>
                    {entry.has_multiple_accounts && entry.swift_code_alt && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt: {entry.swift_code_alt}</div>
                    )}
                  </td>

                  {/* Account Number */}
                  <td className="p-3">
                    <div>{entry.account_number || '-'}</div>
                    {entry.has_multiple_accounts && entry.account_number_alt && (
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt: {entry.account_number_alt}</div>
                    )}
                  </td>

                  {/* Invoice count */}
                  <td className="p-3 text-center">
                    <span
                      className="px-2 py-1 rounded-full text-xs font-medium"
                      style={{
                        background: entry.invoice_count > 0 ? 'color-mix(in srgb, var(--accent-lime) 15%, transparent)' : 'var(--bg-elevated)',
                        color: entry.invoice_count > 0 ? 'var(--accent-lime)' : 'var(--text-muted)',
                      }}
                    >
                      {entry.invoice_count}
                    </span>
                  </td>

                  {/* Verified badge */}
                  <td className="p-3 text-center">
                    {entry.bank_verified_at ? (
                      <CheckCircle2 className="h-4 w-4 mx-auto" style={{ color: 'var(--accent-lime)' }} />
                    ) : (
                      <AlertCircle className="h-4 w-4 mx-auto" style={{ color: 'var(--accent-amber)' }} />
                    )}
                  </td>

                  {/* Action button — prominent Edit button */}
                  {canEditBank && (
                    <td className="p-3 text-center">
                      <button
                        onClick={() => handleEdit(entry)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: 'var(--accent-blue)',
                          color: 'var(--text-inverse)',
                        }}
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit Bank
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={handleCancel}
        >
          <div
            className="rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' }}>
                  <BankIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Edit Bank Details</h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {editingEntry.name} — changes will propagate to {editingEntry.invoice_count} invoice(s)
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancel}
                className="p-2 rounded-lg hover:opacity-80"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Primary Bank Account */}
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Primary Bank Account</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {editField('Bank Name', 'bank_name')}
                  {editField('SWIFT Code', 'swift_code')}
                  {editField('Account Number', 'account_number')}
                  {editField('IBAN', 'iban')}
                  {editField('Bank Address', 'bank_address')}
                  {editField('Sort Code', 'sort_code')}
                  {editField('ABA Routing Number', 'aba_routing_number')}
                </div>
              </div>

              {/* Intermediary Bank */}
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Intermediary Bank</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {editField('Intermediary Bank Name', 'intermediary_bank_name')}
                  {editField('Intermediary SWIFT Code', 'intermediary_bank_swift')}
                </div>
              </div>

              {/* Alternate Account (if applicable) */}
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                  Alternate Account {editingEntry.has_multiple_accounts ? '(Vendor has multiple accounts)' : '(optional)'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {editField('Alt Bank Name', 'bank_name_alt')}
                  {editField('Alt SWIFT Code', 'swift_code_alt')}
                  {editField('Alt Account Number', 'account_number_alt')}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: saving ? 'var(--bg-elevated)' : 'var(--accent-lime)',
                  color: saving ? 'var(--text-muted)' : 'var(--text-inverse)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
