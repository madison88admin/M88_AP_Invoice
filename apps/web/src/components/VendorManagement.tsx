import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { Building2, Search, Plus, Edit, Trash2, ArrowLeft, Building, Save, X } from 'lucide-react';
import { MockVendor } from '../lib/mockData';
import { vendorApi } from '../lib/api';

export default function VendorManagement() {
  const { vendors } = useMockData();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<MockVendor | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Partial<MockVendor>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, [vendors]);

  const filteredVendors = vendors.filter(vendor =>
    vendor.name.toLowerCase().includes(search.toLowerCase()) ||
    vendor.name_aliases.some(alias => alias.toLowerCase().includes(search.toLowerCase()))
  );

  const handleEdit = (vendor: MockVendor) => {
    setEditingVendor(vendor);
    setShowEditModal(true);
  };

  const handleSave = async () => {
    if (!editingVendor.id || !user) return;

    try {
      setSaving(true);
      await vendorApi.update(editingVendor.id, editingVendor);
      setShowEditModal(false);
      setEditingVendor({});
    } catch (error) {
      console.error('Failed to save vendor:', error);
    } finally {
      setSaving(false);
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

  return (
    <div className="min-h-screen animate-page-in" style={{ background: 'var(--bg-base)' }}>
      <div className="relative z-10">
        <header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="transition-colors" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
              </Link>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 16px color-mix(in srgb, var(--accent-purple) 25%, transparent)' }}>
                <Building2 className="h-5 w-5 text-white" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Vendor Management</h1>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Manage vendor profiles and bank details</p>
              </div>
            </div>
          </div>
        </header>

        <main className="px-6 py-8">
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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
                          <Building className="h-5 w-5" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{vendor.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{vendor.name_aliases.length > 0 ? vendor.name_aliases.length + ' aliases' : 'No aliases'}</span>
                            {vendor.name_aliases.length > 0 && (
                              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                Aliases: {vendor.name_aliases.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {user && ['PURCHASING_COORDINATOR', 'ACCOUNTING_SUPERVISOR', 'IT_ADMIN'].includes(user.role) && (
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
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Bank Name</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.bank_name}</p>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>SWIFT Code</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.swift_code}</p>
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Account Number</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selectedVendor.account_number || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-backdrop">
          <div className="max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto rounded-2xl animate-modal-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Vendor</h3>
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
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bank Name</label>
                  <input
                    type="text"
                    value={editingVendor.bank_name || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, bank_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>SWIFT Code</label>
                  <input
                    type="text"
                    value={editingVendor.swift_code || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, swift_code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Account Number</label>
                  <input
                    type="text"
                    value={editingVendor.account_number || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, account_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                  />
                </div>
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
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
