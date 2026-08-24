import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Building2, Search, Plus, Edit, Trash2, ArrowLeft, Building, Save, X, Lock, Send } from 'lucide-react';
import { MockVendor } from '../lib/mockData';
import { vendorApi } from '../lib/api';

export default function VendorManagement() {
  const { vendors } = useMockData();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedVendor, setSelectedVendor] = useState<MockVendor | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Partial<MockVendor>>({});
  const [saving, setSaving] = useState(false);
  const [isAddMode, setIsAddMode] = useState(false);
  const [showBankRequestModal, setShowBankRequestModal] = useState(false);
  const [bankRequestData, setBankRequestData] = useState({ bank_name: '', swift_code: '', account_number: '', reason: '' });
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [masterRequests, setMasterRequests] = useState<any[]>([]);

  const canAddVendor = user && ['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role);
  const canEditBankInfo = user && ['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role);
  const canEditVendor = user && ['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role);
  const canReviewVendor = user && ['ACCOUNTING_SUPERVISOR', 'IT_ADMIN', 'SUPERADMIN'].includes(user.role);

  const loadMasterRequests = async () => {
    if (!canReviewVendor) return;
    try { setMasterRequests((await vendorApi.getMasterChangeRequests()).data || []); } catch { setMasterRequests([]); }
  };

  const handleAdd = () => {
    setIsAddMode(true);
    setEditingVendor({
      name: '',
      name_aliases: [],
      supplier_location: '',
      expected_template: 'STANDARD',
      bank_name: '',
      swift_code: '',
      account_number: '',
      has_multiple_accounts: false,
    });
    setShowEditModal(true);
  };

  useEffect(() => {
    setLoading(false);
    void loadMasterRequests();
  }, [vendors]);

  const locations = Array.from(new Set(vendors.map(v => v.supplier_location).filter(Boolean))).sort();
  const classifications = Array.from(new Set(vendors.map(v => v.classification).filter(Boolean))).sort();

  const filteredVendors = vendors.filter(vendor => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      vendor.name.toLowerCase().includes(q) ||
      vendor.name_aliases.some(alias => alias.toLowerCase().includes(q)) ||
      (vendor.supplier_location || '').toLowerCase().includes(q) ||
      (vendor.classification || '').toLowerCase().includes(q);
    const matchesLocation = !locationFilter || vendor.supplier_location === locationFilter;
    const matchesClassification = !classificationFilter || vendor.classification === classificationFilter;
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? vendor.is_active !== false : vendor.is_active === false);
    return matchesSearch && matchesLocation && matchesClassification && matchesStatus;
  });

  const handleEdit = (vendor: MockVendor) => {
    setIsAddMode(false);
    setEditingVendor(vendor);
    setShowEditModal(true);
  };

  const handleSave = async () => {
    if (!user) return;

    if (isAddMode) {
      if (!editingVendor.name || !editingVendor.name.trim()) {
        showToast('Vendor name is required', 'error');
        return;
      }
      try {
        setSaving(true);
        const payload: any = {
          name: editingVendor.name.trim(),
          name_aliases: editingVendor.name_aliases || [],
          invoice_template_type: 'INVOICE',
          bank_name: editingVendor.bank_name || null,
          swift_code: editingVendor.swift_code || null,
          account_number: editingVendor.account_number || null,
          bank_name_alt: [],
          account_number_alt: [],
          swift_code_alt: [],
          is_active: true,
        };
        if (editingVendor.supplier_location) payload.supplier_location = editingVendor.supplier_location;
        await vendorApi.create(payload);
        showToast('Vendor added successfully', 'success');
        setShowEditModal(false);
        setEditingVendor({});
        setIsAddMode(false);
      } catch (error: any) {
        console.error('Failed to add vendor:', error);
        const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to add vendor';
        showToast(msg, 'error');
      } finally {
        setSaving(false);
      }
    } else {
      if (!editingVendor.id) return;
      if (!changeReason.trim()) {
        showToast('A reason is required. The change will be submitted for approval.', 'error');
        return;
      }
      try {
        setSaving(true);
        await vendorApi.update(editingVendor.id, { ...editingVendor, change_reason: changeReason.trim() });
        showToast('Vendor change submitted for independent approval', 'success');
        setShowEditModal(false);
        setEditingVendor({});
        setChangeReason('');
        await loadMasterRequests();
      } catch (error: any) {
        console.error('Failed to save vendor:', error);
        const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to save vendor';
        showToast(msg, 'error');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleAddAlias = () => {
    if (!editingVendor.name_aliases) {
      editingVendor.name_aliases = [];
    }
    const newAlias = prompt('Enter new alias:');
    if (newAlias && newAlias.trim()) {
      setEditingVendor({
        ...editingVendor,
        name_aliases: [...editingVendor.name_aliases, newAlias.trim()]
      });
    }
  };

  const handleRemoveAlias = (alias: string) => {
    setEditingVendor({
      ...editingVendor,
      name_aliases: editingVendor.name_aliases?.filter(a => a !== alias)
    });
  };

  const handleRequestBankUpdate = (vendor: MockVendor) => {
    setBankRequestData({
      bank_name: vendor.bank_name || '',
      swift_code: vendor.swift_code || '',
      account_number: vendor.account_number || '',
      reason: '',
    });
    setShowBankRequestModal(true);
  };

  const submitBankUpdateRequest = async () => {
    if (!selectedVendor) return;
    if (!bankRequestData.reason.trim()) {
      showToast('Please provide a reason for the bank update request', 'error');
      return;
    }
    try {
      setSubmittingRequest(true);
      await vendorApi.requestBankUpdate(selectedVendor.id, bankRequestData);
      showToast('Bank update request sent to Accounting team', 'success');
      setShowBankRequestModal(false);
      setBankRequestData({ bank_name: '', swift_code: '', account_number: '', reason: '' });
    } catch (error: any) {
      console.error('Failed to submit bank update request:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to send request';
      showToast(msg, 'error');
    } finally {
      setSubmittingRequest(false);
    }
  };

  return (
    <div>
          {canReviewVendor && masterRequests.length > 0 && <div className="p-5 mb-6 rounded-2xl" style={{ border: '1px solid var(--accent-amber)', background: 'color-mix(in srgb, var(--accent-amber) 8%, var(--bg-card))' }}>
            <h2 className="font-semibold mb-3">Pending Vendor Master Changes ({masterRequests.length})</h2>
            <div className="space-y-2">{masterRequests.map(request => <div key={request.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-card)' }}>
              <div><div className="font-medium">{request.vendor?.name}</div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{request.reason} · requested by {request.requested_by}</div></div>
              <div className="flex gap-2"><button onClick={async () => { await vendorApi.approveMasterChange(request.id); await loadMasterRequests(); }} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--accent-green)', color: 'white' }}>Approve</button><button onClick={async () => { const reason = prompt('Rejection reason:'); if (reason) { await vendorApi.rejectMasterChange(request.id, reason); await loadMasterRequests(); } }} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }}>Reject</button></div>
            </div>)}</div>
          </div>}
          {/* Search and Filter */}
          <div className="p-6 mb-6 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                <Search className="h-5 w-5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
              </div>
              <input
                type="text"
                placeholder="Search vendors by name or alias..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl focus:outline-none transition-all text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filteredVendors.length} vendors
              </div>
              {canAddVendor && (
                <button
                  onClick={handleAdd}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200"
                  style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px var(--accent-lime-glow)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 0 24px var(--accent-lime-glow)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 0 16px var(--accent-lime-glow)'; }}
                >
                  <Plus className="h-4 w-4" />
                  Add Vendor
                </button>
              )}
            </div>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Filter</span>
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value="">All Locations</option>
                {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
              <select
                value={classificationFilter}
                onChange={(e) => setClassificationFilter(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value="">All Classifications</option>
                {classifications.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-2 rounded-lg text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {(locationFilter || classificationFilter || statusFilter !== 'all') && (
                <button
                  onClick={() => { setLocationFilter(''); setClassificationFilter(''); setStatusFilter('all'); }}
                  className="text-xs font-medium px-2 py-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--accent-purple)' }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Vendor List */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            {loading ? (
              <div className="px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>Loading vendors...</div>
            ) : (
              <div>
                {filteredVendors.map((vendor, idx) => (
                  <div
                    key={vendor.id}
                    className="px-6 py-4 cursor-pointer transition-colors"
                    style={{ borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none' }}
                    onClick={() => setSelectedVendor(vendor)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="p-3 rounded-xl shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
                          <Building className="h-5 w-5" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{vendor.name}</h3>
                            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px]" style={{ background: 'var(--bg-elevated)', color: vendor.governance_status === 'REJECTED' ? 'var(--accent-red)' : vendor.governance_status === 'PENDING' ? 'var(--accent-amber)' : 'var(--accent-green)' }}>{vendor.governance_status || 'APPROVED'}</span>
                            {vendor.is_active === false && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-amber) 14%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 25%, transparent)' }}>
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                            {vendor.supplier_location || 'No location'}
                            {vendor.name_aliases.length > 0 && <> · {vendor.name_aliases.length} alias{vendor.name_aliases.length === 1 ? '' : 'es'}</>}
                            {vendor.classification ? ` · ${vendor.classification}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {canReviewVendor && vendor.governance_status === 'PENDING' && <>
                          <button onClick={async (e) => { e.stopPropagation(); await vendorApi.approvePending(vendor.id); window.location.reload(); }} className="px-2 py-1 rounded-lg text-xs" style={{ background: 'var(--accent-green)', color: 'white' }}>Approve</button>
                          <button onClick={async (e) => { e.stopPropagation(); const reason = prompt('Rejection reason:'); if (reason) { await vendorApi.rejectPending(vendor.id, reason); window.location.reload(); } }} className="px-2 py-1 rounded-lg text-xs" style={{ color: 'var(--accent-red)', border: '1px solid var(--accent-red)' }}>Reject</button>
                        </>}
                        {canEditVendor && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(vendor);
                          }}
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-purple)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = ''; }}
                        >
                          <Edit className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vendor Detail Panel */}
          {selectedVendor && (
            <div className="fixed right-0 top-0 h-full w-96 overflow-y-auto z-50" style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)', boxShadow: '-20px 0 60px rgba(0,0,0,0.15)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Vendor Details</h3>
                  <button
                    onClick={() => setSelectedVendor(null)}
                    className="transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <X className="h-5 w-5" strokeWidth={1.75} />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendor Name</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.name}</p>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Name Aliases</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedVendor.name_aliases.map((alias, idx) => (
                        <span key={idx} className="px-2 py-1 text-xs rounded-md" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                          {alias}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Supplier Location</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.supplier_location || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Classification</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.classification || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Status</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.is_active === false ? 'Inactive' : 'Active'}</p>
                  </div>

                  {selectedVendor.contact_email && (
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Contact Email</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.contact_email}</p>
                    </div>
                  )}

                  {(selectedVendor.vat_number || selectedVendor.bir_tin || selectedVendor.eori_number || selectedVendor.gstin_number) && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent-purple)' }}>Tax IDs</p>
                      <div className="space-y-1.5">
                        {selectedVendor.vat_number && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>VAT: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.vat_number}</span></p>}
                        {selectedVendor.bir_tin && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>BIR TIN: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.bir_tin}</span></p>}
                        {selectedVendor.eori_number && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>EORI: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.eori_number}</span></p>}
                        {selectedVendor.gstin_number && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>GSTIN: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.gstin_number}</span></p>}
                      </div>
                    </div>
                  )}
                  {!canEditBankInfo && (
                    <button
                      onClick={() => handleRequestBankUpdate(selectedVendor)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--accent-amber)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-amber) 10%, transparent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                    >
                      <Send className="h-4 w-4" strokeWidth={1.75} />
                      Request Bank Info Update
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
          <div className="max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{isAddMode ? 'Add Vendor' : 'Edit Vendor'}</h3>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingVendor({});
                  }}
                  className="transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <X className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Vendor Name</label>
                  <input
                    type="text"
                    value={editingVendor.name || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Name Aliases</label>
                  <div className="space-y-2">
                    {editingVendor.name_aliases?.map((alias, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={alias}
                          onChange={(e) => {
                            const newAliases = [...editingVendor.name_aliases!];
                            newAliases[idx] = e.target.value;
                            setEditingVendor({ ...editingVendor, name_aliases: newAliases });
                          }}
                          className="flex-1 px-3 py-2 rounded-xl focus:outline-none text-sm"
                          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                        />
                        <button
                          onClick={() => handleRemoveAlias(alias)}
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: 'var(--accent-red)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={handleAddAlias}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors"
                      style={{ color: 'var(--accent-purple)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-purple) 10%, transparent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.75} />
                      Add Alias
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Bank Name</label>
                    {!isAddMode && <Lock className="h-3 w-3" style={{ color: 'var(--text-subtle)' }} />}
                  </div>
                  <input
                    type="text"
                    value={editingVendor.bank_name || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, bank_name: e.target.value })}
                    disabled={!isAddMode}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>SWIFT Code</label>
                    {!isAddMode && <Lock className="h-3 w-3" style={{ color: 'var(--text-subtle)' }} />}
                  </div>
                  <input
                    type="text"
                    value={editingVendor.swift_code || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, swift_code: e.target.value })}
                    disabled={!isAddMode}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Account Number</label>
                    {!isAddMode && <Lock className="h-3 w-3" style={{ color: 'var(--text-subtle)' }} />}
                  </div>
                  <input
                    type="text"
                    value={editingVendor.account_number || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, account_number: e.target.value })}
                    disabled={!isAddMode}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                {!isAddMode && (
                  <div className="px-3 py-2 rounded-xl text-xs flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)', color: 'var(--text-secondary)' }}>
                    <Lock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-amber)' }} />
                    <span>Bank information is managed by the Accounting team. Use the "Request Bank Info Update" button in the vendor detail panel to request changes.</span>
                  </div>
                )}
                {!isAddMode && <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Change reason <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                  <textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} rows={2} placeholder="Required for independent Vendor Master approval" className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} />
                </div>}
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingVendor({});
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl transition-colors disabled:cursor-not-allowed flex items-center gap-2 text-sm font-semibold"
                  style={saving
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-lime)', color: 'var(--bg-base)' }
                  }
                  onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                  onMouseLeave={(e) => { if (!saving) e.currentTarget.style.background = 'var(--accent-lime)'; }}
                >
                  <Save className="h-4 w-4" strokeWidth={1.75} />
                  {saving ? 'Saving...' : isAddMode ? 'Add Vendor' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank Update Request Modal */}
      {showBankRequestModal && selectedVendor && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
          <div className="max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Request Bank Info Update</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Vendor: {selectedVendor.name}</p>
                </div>
                <button
                  onClick={() => {
                    setShowBankRequestModal(false);
                    setBankRequestData({ bank_name: '', swift_code: '', account_number: '', reason: '' });
                  }}
                  className="transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <X className="h-5 w-5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="px-3 py-2 mb-4 rounded-xl text-xs flex items-start gap-2" style={{ background: 'color-mix(in srgb, var(--accent-amber) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)', color: 'var(--text-secondary)' }}>
                <Send className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-amber)' }} />
                <span>This request will be sent to the Accounting team for review. Fill in the proposed bank details and a reason for the update.</span>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Proposed Bank Name</label>
                  <input
                    type="text"
                    value={bankRequestData.bank_name}
                    onChange={(e) => setBankRequestData({ ...bankRequestData, bank_name: e.target.value })}
                    placeholder="e.g. HSBC HK"
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Proposed SWIFT Code</label>
                  <input
                    type="text"
                    value={bankRequestData.swift_code}
                    onChange={(e) => setBankRequestData({ ...bankRequestData, swift_code: e.target.value })}
                    placeholder="e.g. HSBCHKHH"
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Proposed Account Number</label>
                  <input
                    type="text"
                    value={bankRequestData.account_number}
                    onChange={(e) => setBankRequestData({ ...bankRequestData, account_number: e.target.value })}
                    placeholder="e.g. 123-456789-001"
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Reason for Update <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                  <textarea
                    value={bankRequestData.reason}
                    onChange={(e) => setBankRequestData({ ...bankRequestData, reason: e.target.value })}
                    placeholder="Explain why the bank information needs to be updated..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm resize-none"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowBankRequestModal(false);
                    setBankRequestData({ bank_name: '', swift_code: '', account_number: '', reason: '' });
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitBankUpdateRequest}
                  disabled={submittingRequest}
                  className="px-4 py-2 rounded-xl transition-colors disabled:cursor-not-allowed flex items-center gap-2 text-sm font-semibold"
                  style={submittingRequest
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-amber)', color: 'var(--bg-base)' }
                  }
                >
                  <Send className="h-4 w-4" strokeWidth={1.75} />
                  {submittingRequest ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
