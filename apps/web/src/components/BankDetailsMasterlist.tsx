import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { vendorApi } from '../lib/api';
import { Landmark, Search, Edit, Save, X, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [editingId, setEditingId] = useState<string | null>(null);
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
    setEditingId(entry.id);
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
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await vendorApi.updateBankDetails(editingId, editData);
      showToast(res.data.message, 'success');
      setEditingId(null);
      setEditData({});
      await loadBankDetails();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update bank details', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditData({});
  };

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
            Editing bank details here updates the vendor masterlist AND automatically propagates to all linked invoices.
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
                <th className="text-left p-3 font-semibold">Beneficiary</th>
                <th className="text-left p-3 font-semibold">Bank Name</th>
                <th className="text-left p-3 font-semibold">SWIFT Code</th>
                <th className="text-left p-3 font-semibold">Account Number</th>
                <th className="text-left p-3 font-semibold">IBAN</th>
                <th className="text-left p-3 font-semibold">Intermediary Bank</th>
                <th className="text-center p-3 font-semibold">Invoices</th>
                <th className="text-center p-3 font-semibold">Verified</th>
                {canEditBank && <th className="text-center p-3 font-semibold">Actions</th>}
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
                  </td>
                  {/* Beneficiary */}
                  <td className="p-3">{entry.beneficiary_name || '-'}</td>

                  {/* Bank Name (editable) */}
                  <td className="p-3">
                    {editingId === entry.id ? (
                      <input
                        value={editData.bank_name || ''}
                        onChange={(e) => setEditData({ ...editData, bank_name: e.target.value })}
                        className="w-full p-1 rounded text-xs"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-blue)', color: 'var(--text-primary)' }}
                      />
                    ) : (
                      <div>
                        {entry.bank_name || '-'}
                        {entry.has_multiple_accounts && entry.bank_name_alt && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt: {entry.bank_name_alt}</div>
                        )}
                      </div>
                    )}
                  </td>

                  {/* SWIFT Code (editable) */}
                  <td className="p-3">
                    {editingId === entry.id ? (
                      <input
                        value={editData.swift_code || ''}
                        onChange={(e) => setEditData({ ...editData, swift_code: e.target.value })}
                        className="w-full p-1 rounded text-xs"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-blue)', color: 'var(--text-primary)' }}
                      />
                    ) : (
                      <div>
                        {entry.swift_code || '-'}
                        {entry.has_multiple_accounts && entry.swift_code_alt && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt: {entry.swift_code_alt}</div>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Account Number (editable) */}
                  <td className="p-3">
                    {editingId === entry.id ? (
                      <input
                        value={editData.account_number || ''}
                        onChange={(e) => setEditData({ ...editData, account_number: e.target.value })}
                        className="w-full p-1 rounded text-xs"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-blue)', color: 'var(--text-primary)' }}
                      />
                    ) : (
                      <div>
                        {entry.account_number || '-'}
                        {entry.has_multiple_accounts && entry.account_number_alt && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt: {entry.account_number_alt}</div>
                        )}
                      </div>
                    )}
                  </td>

                  {/* IBAN (editable) */}
                  <td className="p-3">
                    {editingId === entry.id ? (
                      <input
                        value={editData.iban || ''}
                        onChange={(e) => setEditData({ ...editData, iban: e.target.value })}
                        className="w-full p-1 rounded text-xs"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-blue)', color: 'var(--text-primary)' }}
                      />
                    ) : (
                      entry.iban || '-'
                    )}
                  </td>

                  {/* Intermediary Bank */}
                  <td className="p-3">
                    {editingId === entry.id ? (
                      <input
                        value={editData.intermediary_bank_name || ''}
                        onChange={(e) => setEditData({ ...editData, intermediary_bank_name: e.target.value })}
                        className="w-full p-1 rounded text-xs"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-blue)', color: 'var(--text-primary)' }}
                      />
                    ) : (
                      <div>
                        {entry.intermediary_bank_name || '-'}
                        {entry.intermediary_bank_swift && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>SWIFT: {entry.intermediary_bank_swift}</div>
                        )}
                      </div>
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

                  {/* Actions */}
                  {canEditBank && (
                    <td className="p-3 text-center">
                      {editingId === entry.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="p-1.5 rounded hover:opacity-80"
                            style={{ background: 'var(--accent-lime)', color: 'var(--bg-card)' }}
                            title="Save"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button
                            onClick={handleCancel}
                            disabled={saving}
                            className="p-1.5 rounded hover:opacity-80"
                            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(entry)}
                          className="p-1.5 rounded hover:opacity-80"
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                          title="Edit bank details"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Expandable edit fields for alt accounts */}
      {editingId && (
        <div className="p-4 rounded-lg space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h3 className="text-sm font-semibold">Additional Bank Fields</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Bank Address</label>
              <input
                value={editData.bank_address || ''}
                onChange={(e) => setEditData({ ...editData, bank_address: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt Bank Name</label>
              <input
                value={editData.bank_name_alt || ''}
                onChange={(e) => setEditData({ ...editData, bank_name_alt: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt SWIFT</label>
              <input
                value={editData.swift_code_alt || ''}
                onChange={(e) => setEditData({ ...editData, swift_code_alt: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Alt Account Number</label>
              <input
                value={editData.account_number_alt || ''}
                onChange={(e) => setEditData({ ...editData, account_number_alt: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Sort Code</label>
              <input
                value={editData.sort_code || ''}
                onChange={(e) => setEditData({ ...editData, sort_code: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>ABA Routing</label>
              <input
                value={editData.aba_routing_number || ''}
                onChange={(e) => setEditData({ ...editData, aba_routing_number: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Intermediary SWIFT</label>
              <input
                value={editData.intermediary_bank_swift || ''}
                onChange={(e) => setEditData({ ...editData, intermediary_bank_swift: e.target.value })}
                className="w-full p-2 rounded text-xs mt-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
