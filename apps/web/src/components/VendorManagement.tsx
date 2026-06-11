import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Vendor, InvoiceType } from '@ap-invoice/shared';
import { vendorApi } from '../lib/api';
import { Building2, Search, Plus, Edit, Trash2, ArrowLeft, Building, Save, X } from 'lucide-react';

export default function VendorManagement() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Partial<Vendor>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadVendors();
  }, []);

  const loadVendors = async () => {
    try {
      setLoading(true);
      const response = await vendorApi.getAll();
      setVendors(response.data);
    } catch (error) {
      console.error('Failed to load vendors:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredVendors = vendors.filter(vendor =>
    vendor.name.toLowerCase().includes(search.toLowerCase()) ||
    vendor.name_aliases.some(alias => alias.toLowerCase().includes(search.toLowerCase()))
  );

  const handleEdit = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setShowEditModal(true);
  };

  const handleSave = async () => {
    if (!editingVendor.id) return;

    try {
      setSaving(true);
      await vendorApi.update(editingVendor.id, editingVendor);
      await loadVendors();
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
        <header style={{ background: 'rgba(10, 14, 30, 0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }} className="px-6 py-4 sticky top-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-slate-300 hover:text-white transition-colors">
                <ArrowLeft className="h-6 w-6" />
              </Link>
              <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)', boxShadow: '0 8px 32px rgba(236,72,153,0.3)' }}>
                <Building2 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Vendor Management</h1>
                <p className="text-xs text-slate-400">Manage vendor profiles and bank details</p>
              </div>
            </div>
          </div>
        </header>

        <main className="px-6 py-8">
          {/* Search and Filter */}
          <div style={{ background: 'rgba(255, 255, 255, 0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }} className="p-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Search vendors by name or alias..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all text-white placeholder-slate-400"
              />
              <div className="text-sm text-slate-400">
                {filteredVendors.length} vendors
              </div>
            </div>
          </div>

          {/* Vendor List */}
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}>
            {loading ? (
              <div className="px-6 py-12 text-center text-slate-400">Loading vendors...</div>
            ) : (
              <div className="divide-y divide-white/5">
                {filteredVendors.map((vendor) => (
                  <div
                    key={vendor.id}
                    className="px-6 py-4 cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 150ms ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                    onClick={() => setSelectedVendor(vendor)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl" style={{ background: 'rgba(236,72,153,0.15)' }}>
                          <Building className="h-5 w-5 text-pink-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white">{vendor.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-400">{vendor.currency}</span>
                            {vendor.name_aliases.length > 0 && (
                              <span className="text-xs text-slate-500">
                                Aliases: {vendor.name_aliases.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(vendor);
                          }}
                          className="p-2 text-slate-400 hover:text-blue-400 hover:bg-white/10 rounded-lg transition-colors"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vendor Detail Panel */}
          {selectedVendor && (
            <div className="fixed right-0 top-0 h-full w-96 overflow-y-auto z-20" style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderLeft: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)' }}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-white">Vendor Details</h3>
                  <button
                    onClick={() => setSelectedVendor(null)}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-400">Vendor Name</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Currency</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.currency}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Expected Template</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.expected_template}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Name Aliases</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedVendor.name_aliases.map((alias, idx) => (
                        <span key={idx} className="px-2 py-1 bg-white/10 text-slate-300 text-xs rounded-md">
                          {alias}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Bank Name</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.bank_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">SWIFT Code</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.swift_code}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">USD Account</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.account_usd}</p>
                  </div>
                  {selectedVendor.account_hkd && (
                    <div>
                      <p className="text-sm text-slate-400">HKD Account</p>
                      <p className="text-sm font-medium text-white">{selectedVendor.account_hkd}</p>
                    </div>
                  )}
                  {selectedVendor.account_eur && (
                    <div>
                      <p className="text-sm text-slate-400">EUR Account</p>
                      <p className="text-sm font-medium text-white">{selectedVendor.account_eur}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-slate-400">Bank Address</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.bank_address || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Bank Code</p>
                    <p className="text-sm font-medium text-white">{selectedVendor.bank_code || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div style={{ background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} className="max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-white">Edit Vendor</h3>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingVendor({});
                  }}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Vendor Name</label>
                  <input
                    type="text"
                    value={editingVendor.name || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Currency</label>
                  <input
                    type="text"
                    value={editingVendor.currency || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, currency: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Expected Template</label>
                  <select
                    value={editingVendor.expected_template || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, expected_template: e.target.value as InvoiceType })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  >
                    {Object.values(InvoiceType).map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Name Aliases</label>
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
                          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                        />
                        <button
                          onClick={() => handleRemoveAlias(alias)}
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={handleAddAlias}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-pink-400 hover:bg-pink-500/20 rounded-lg transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      Add Alias
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={editingVendor.bank_name || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, bank_name: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">SWIFT Code</label>
                  <input
                    type="text"
                    value={editingVendor.swift_code || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, swift_code: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">USD Account</label>
                  <input
                    type="text"
                    value={editingVendor.account_usd || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, account_usd: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">HKD Account</label>
                  <input
                    type="text"
                    value={editingVendor.account_hkd || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, account_hkd: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">EUR Account</label>
                  <input
                    type="text"
                    value={editingVendor.account_eur || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, account_eur: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Bank Address</label>
                  <textarea
                    value={editingVendor.bank_address || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, bank_address: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Bank Code</label>
                  <input
                    type="text"
                    value={editingVendor.bank_code || ''}
                    onChange={(e) => setEditingVendor({ ...editingVendor, bank_code: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-white"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingVendor({});
                  }}
                  className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
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
