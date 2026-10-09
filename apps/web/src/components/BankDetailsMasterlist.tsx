import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { vendorApi } from '../lib/api';
import { Landmark, Search, Edit, Save, X, ArrowLeft, CheckCircle2, AlertCircle, Landmark as BankIcon, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface BankDetailsEntry {
  id: string;
  name: string;
  beneficiary_name: string | null;
  classification: string | null;
  supplier_location: string | null;
  bank_name: string | null;
  bank_name_alt: string[];
  bank_address: string | null;
  swift_code: string | null;
  swift_code_alt: string[];
  account_number: string | null;
  account_number_alt: string[];
  iban: string | null;
  sort_code: string | null;
  aba_routing_number: string | null;
  intermediary_bank_name: string | null;
  intermediary_bank_swift: string | null;
  has_multiple_accounts: boolean;
  bank_verified_at: string | null;
  invoice_count: number;
}

interface NewVendorBankData {
  name: string;
  beneficiary_name: string;
  supplier_location: string;
  classification: string;
  bank_name: string;
  swift_code: string;
  account_number: string;
  iban: string;
  bank_address: string;
  intermediary_bank_name: string;
  intermediary_bank_swift: string;
  has_multiple_accounts: boolean;
  bank_name_alt: string;
  swift_code_alt: string;
  account_number_alt: string;
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVendorData, setNewVendorData] = useState<NewVendorBankData>({
    name: '', beneficiary_name: '', supplier_location: '', classification: '',
    bank_name: '', swift_code: '', account_number: '', iban: '', bank_address: '',
    intermediary_bank_name: '', intermediary_bank_swift: '', has_multiple_accounts: false,
    bank_name_alt: '', swift_code_alt: '', account_number_alt: '',
  });

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
      const asText = (value: unknown) => Array.isArray(value) ? value.join(', ') : String(value ?? '').trim();
      const asTextArray = (value: unknown) => asText(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const payload = {
        ...editData,
        bank_name_alt: asTextArray(editData.bank_name_alt),
        swift_code_alt: asTextArray(editData.swift_code_alt),
        account_number_alt: asTextArray(editData.account_number_alt),
      };
      const res = await vendorApi.updateBankDetails(editingEntry.id, payload);
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

  const handleDelete = async (entry: BankDetailsEntry) => {
    const linkedInvoiceWarning = entry.invoice_count > 0
      ? ` This vendor has ${entry.invoice_count} linked invoice${entry.invoice_count === 1 ? '' : 's'}; invoice history will be preserved.`
      : '';
    if (!window.confirm(`Delete ${entry.name} from the active bank details masterlist?${linkedInvoiceWarning} The vendor will be archived and can no longer be used for new intake.`)) return;

    setDeletingId(entry.id);
    try {
      const response = await vendorApi.delete(entry.id);
      showToast(response.data?.message || 'Vendor archived successfully', 'success');
      await loadBankDetails();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to delete vendor', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const resetAddForm = () => {
    setShowAddModal(false);
    setNewVendorData({
      name: '', beneficiary_name: '', supplier_location: '', classification: '',
      bank_name: '', swift_code: '', account_number: '', iban: '', bank_address: '',
      intermediary_bank_name: '', intermediary_bank_swift: '', has_multiple_accounts: false,
      bank_name_alt: '', swift_code_alt: '', account_number_alt: '',
    });
  };

  const handleAddCancel = () => {
    if (saving) return;
    resetAddForm();
  };

  const handleAddVendor = async () => {
    if (!newVendorData.name.trim()) {
      showToast('Vendor name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: newVendorData.name.trim(),
        beneficiary_name: newVendorData.beneficiary_name.trim() || null,
        supplier_location: newVendorData.supplier_location.trim() || null,
        classification: newVendorData.classification.trim() || null,
        invoice_template_type: 'INVOICE',
        bank_name: newVendorData.bank_name.trim() || null,
        swift_code: newVendorData.swift_code.trim() || null,
        account_number: newVendorData.account_number.trim() || null,
        iban: newVendorData.iban.trim() || null,
        bank_address: newVendorData.bank_address.trim() || null,
        intermediary_bank_name: newVendorData.intermediary_bank_name.trim() || null,
        intermediary_bank_swift: newVendorData.intermediary_bank_swift.trim() || null,
        has_multiple_accounts: newVendorData.has_multiple_accounts,
        bank_name_alt: newVendorData.bank_name_alt.trim() ? [newVendorData.bank_name_alt.trim()] : [],
        swift_code_alt: newVendorData.swift_code_alt.trim() ? [newVendorData.swift_code_alt.trim()] : [],
        account_number_alt: newVendorData.account_number_alt.trim() ? [newVendorData.account_number_alt.trim()] : [],
        name_aliases: [],
        is_active: true,
      };
      await vendorApi.create(payload);
      showToast('Vendor and bank details added successfully', 'success');
      resetAddForm();
      await loadBankDetails();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to add vendor', 'error');
    } finally {
      setSaving(false);
    }
  };

  const editField = (label: string, field: keyof BankDetailsEntry, type: string = 'text') => (
    <div>
      <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        type={type}
        value={Array.isArray(editData[field]) ? editData[field]!.join(', ') : String(editData[field] ?? '')}
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
        <div className="flex items-center gap-3">
          {canEditBank && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent-lime)', color: 'var(--text-inverse)' }}
            >
              <Plus className="h-4 w-4" /> Add Vendor &amp; Bank Details
            </button>
          )}
          <Link to="/" className="flex items-center gap-2 text-sm hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
        </div>
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
            Use <strong>Add Vendor &amp; Bank Details</strong> for a new supplier, <strong>Edit Bank</strong> to update an existing record, or <strong>Delete</strong> to archive an obsolete vendor. Linked invoice history is preserved.
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

                  {/* Actions */}
                  {canEditBank && (
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(entry)}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                          style={{ background: 'var(--accent-blue)', color: 'var(--text-inverse)' }}
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Edit Bank
                        </button>
                        <button
                          onClick={() => void handleDelete(entry)}
                          disabled={deletingId === entry.id}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 28%, transparent)' }}
                          title="Archive vendor from active bank details"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
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

      {/* Add Vendor + Bank Details Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={handleAddCancel}
        >
          <div
            className="rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))' }}>
                  <Plus className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Add Vendor &amp; Bank Details</h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>The vendor will be available for invoice intake after saving.</p>
                </div>
              </div>
              <button onClick={handleAddCancel} className="p-2 rounded-lg hover:opacity-80" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-5">
              <div>
                <h3 className="text-sm font-semibold mb-3">Vendor information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(['name', 'beneficiary_name', 'supplier_location', 'classification'] as const).map((field) => {
                    const labels: Record<string, string> = { name: 'Vendor name *', beneficiary_name: 'Beneficiary name', supplier_location: 'Supplier location', classification: 'Classification' };
                    return <div key={field}><label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{labels[field]}</label><input value={newVendorData[field]} onChange={(e) => setNewVendorData({ ...newVendorData, [field]: e.target.value })} className="w-full p-2 rounded-lg text-sm mt-1" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} /></div>;
                  })}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-3">Primary bank account</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(['bank_name', 'swift_code', 'account_number', 'iban', 'bank_address', 'intermediary_bank_name', 'intermediary_bank_swift'] as const).map((field) => {
                    const labels: Record<string, string> = { bank_name: 'Bank name', swift_code: 'SWIFT code', account_number: 'Account number', iban: 'IBAN', bank_address: 'Bank address', intermediary_bank_name: 'Intermediary bank name', intermediary_bank_swift: 'Intermediary SWIFT code' };
                    return <div key={field}><label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{labels[field]}</label><input value={newVendorData[field]} onChange={(e) => setNewVendorData({ ...newVendorData, [field]: e.target.value })} className="w-full p-2 rounded-lg text-sm mt-1" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} /></div>;
                  })}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3"><input id="multiple-bank-accounts" type="checkbox" checked={newVendorData.has_multiple_accounts} onChange={(e) => setNewVendorData({ ...newVendorData, has_multiple_accounts: e.target.checked })} /><label htmlFor="multiple-bank-accounts" className="text-sm font-semibold">Vendor has an alternate bank account</label></div>
                {newVendorData.has_multiple_accounts && <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(['bank_name_alt', 'swift_code_alt', 'account_number_alt'] as const).map((field) => <input key={field} placeholder={field === 'bank_name_alt' ? 'Alternate bank name' : field === 'swift_code_alt' ? 'Alternate SWIFT code' : 'Alternate account number'} value={newVendorData[field]} onChange={(e) => setNewVendorData({ ...newVendorData, [field]: e.target.value })} className="p-2 rounded-lg text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />)}
                </div>}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={handleAddCancel} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={handleAddVendor} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: saving ? 'var(--bg-elevated)' : 'var(--accent-lime)', color: saving ? 'var(--text-muted)' : 'var(--text-inverse)' }}><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Add Vendor'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
