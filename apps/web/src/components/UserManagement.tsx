import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { userApi } from '../lib/api';
import {
  ArrowLeft, Users, Search, Plus, Edit, Trash2, Save, X,
  Shield, Mail, Lock, User as UserIcon, Loader2, AlertCircle,
  CheckCircle, Eye, EyeOff, Power,
} from 'lucide-react';

interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  SUPERADMIN: 'var(--accent-purple)',
  IT_ADMIN: 'var(--accent-violet)',
  ACCOUNTING_ASSOCIATE: 'var(--accent-blue)',
  ACCOUNTING_SUPERVISOR: 'var(--accent-blue)',
  PURCHASING_COORDINATOR: 'var(--accent-lime)',
  PURCHASING_MANAGER: 'var(--accent-lime)',
  MLO_ACCOUNT_HOLDER: 'var(--accent-amber)',
  PLANNING_MANAGER: 'var(--accent-amber)',
  SR_MANAGER_GLOBAL_PRODUCTION: 'var(--accent-red)',
  MS_POLLY: 'var(--accent-violet)',
  CFO: 'var(--accent-purple)',
  PRESIDENT: 'var(--accent-red)',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<UserAccount | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Add/Edit form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'ACCOUNTING_ASSOCIATE',
    password: '',
    active: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const usersRes = await userApi.getAll();
      setUsers(usersRes.data.users);

      // Fetch roles separately so users still load if roles fails
      try {
        const rolesRes = await userApi.getRoles();
        setRoles(rolesRes.data.roles);
      } catch {
        // Fallback to hardcoded roles from UserRole enum
        setRoles([
          'SUPERADMIN', 'ADMIN', 'ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR',
          'PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER',
          'PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY',
          'CFO', 'PRESIDENT', 'IT_ADMIN',
        ]);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setToast({ type: 'error', message: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  const openAddModal = () => {
    setFormData({ name: '', email: '', role: 'ACCOUNTING_ASSOCIATE', password: '', active: true });
    setFormError('');
    setShowAddModal(true);
  };

  const openEditModal = (user: UserAccount) => {
    setFormData({ name: user.name, email: user.email, role: user.role, password: '', active: user.active });
    setFormError('');
    setEditingUser(user);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingUser(null);
    setFormError('');
    setShowPassword(false);
  };

  const handleSave = async () => {
    setFormError('');

    if (!formData.name.trim() || !formData.email.trim()) {
      setFormError('Name and email are required');
      return;
    }

    if (showAddModal && !formData.password) {
      setFormError('Password is required for new users');
      return;
    }

    if (formData.password && formData.password.length < 4) {
      setFormError('Password must be at least 4 characters');
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        const updates: any = {};
        if (formData.name !== editingUser.name) updates.name = formData.name;
        if (formData.email !== editingUser.email) updates.email = formData.email;
        if (formData.role !== editingUser.role) updates.role = formData.role;
        if (formData.active !== editingUser.active) updates.active = formData.active;
        if (formData.password) updates.password = formData.password;

        await userApi.update(editingUser.id, updates);
        setToast({ type: 'success', message: `Updated ${formData.name}` });
      } else {
        await userApi.create({
          name: formData.name,
          email: formData.email,
          role: formData.role,
          password: formData.password,
          active: formData.active,
        });
        setToast({ type: 'success', message: `Created ${formData.name}` });
      }

      closeModal();
      await fetchUsers();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || 'Failed to save user';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setSaving(true);
    try {
      await userApi.delete(deleteConfirm.id);
      setToast({ type: 'success', message: `Deleted ${deleteConfirm.name}` });
      setDeleteConfirm(null);
      await fetchUsers();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || 'Failed to delete user';
      setToast({ type: 'error', message: msg });
      setDeleteConfirm(null);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: UserAccount) => {
    try {
      await userApi.update(user.id, { active: !user.active });
      setToast({ type: 'success', message: `${user.name} ${!user.active ? 'activated' : 'deactivated'}` });
      await fetchUsers();
    } catch (err: any) {
      setToast({ type: 'error', message: 'Failed to update user status' });
    }
  };

  return (
    <div>
        <div className="flex items-center justify-end mb-4">
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200"
              style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px var(--accent-lime-glow)' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 0 24px var(--accent-lime-glow)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 0 16px var(--accent-lime-glow)'; }}
            >
              <Plus className="h-4 w-4" />
              Add User
            </button>
          </div>

        <div>
          {/* Stats Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total Users', value: users.length, color: 'var(--accent-purple)' },
              { label: 'Active', value: users.filter(u => u.active).length, color: 'var(--accent-lime)' },
              { label: 'Inactive', value: users.filter(u => !u.active).length, color: 'var(--text-muted)' },
              { label: 'Admins', value: users.filter(u => u.role === 'SUPERADMIN' || u.role === 'IT_ADMIN').length, color: 'var(--accent-violet)' },
            ].map((stat, idx) => (
              <div
                key={stat.label}
                className="p-4 rounded-2xl animate-list-item card-lift"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', animationDelay: `${idx * 60}ms` }}
              >
                <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{stat.label}</p>
                <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="p-4 mb-4 rounded-2xl" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                <Search className="h-5 w-5" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
              </div>
              <input
                type="text"
                placeholder="Search by name, email, or role..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl focus:outline-none transition-all text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
              />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{filteredUsers.length} users</span>
            </div>
          </div>

          {/* User Table */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: 'var(--accent-purple)' }} />
                  <div className="h-10 w-10 rounded-full border-2 animate-spin" style={{ borderTopColor: 'var(--accent-purple)', borderRightColor: 'var(--accent-purple)', borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
                </div>
                <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading users...</p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-16 text-center">
                <Users className="h-12 w-12 mx-auto mb-3 animate-soft-bounce" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No users found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>User</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Role</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Created</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user, idx) => (
                      <tr
                        key={user.id}
                        className="transition-colors animate-list-item"
                        style={{ borderBottom: '1px solid var(--border-color)', animationDelay: `${idx * 30}ms` }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        {/* User cell with avatar */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex items-center justify-center w-10 h-10 rounded-full text-xs font-bold flex-shrink-0"
                              style={{
                                background: `linear-gradient(135deg, ${ROLE_COLORS[user.role] || 'var(--accent-purple)'}, color-mix(in srgb, ${ROLE_COLORS[user.role] || 'var(--accent-purple)'} 50%, var(--bg-base)))`,
                                color: 'var(--bg-base)',
                              }}
                            >
                              {getInitials(user.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                {user.name}
                                {currentUser?.email === user.email && (
                                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)', color: 'var(--accent-lime)' }}>You</span>
                                )}
                              </p>
                              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Role badge */}
                        <td className="px-4 py-4">
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                            style={{
                              background: `color-mix(in srgb, ${ROLE_COLORS[user.role] || 'var(--accent-purple)'} 12%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${ROLE_COLORS[user.role] || 'var(--accent-purple)'} 25%, transparent)`,
                              color: ROLE_COLORS[user.role] || 'var(--accent-purple)',
                            }}
                          >
                            <Shield className="h-3 w-3" />
                            {user.role.replace(/_/g, ' ')}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium"
                            style={{ color: user.active ? 'var(--accent-lime)' : 'var(--text-muted)' }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: user.active ? 'var(--accent-lime)' : 'var(--text-muted)' }} />
                            {user.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        {/* Created date */}
                        <td className="px-4 py-4">
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(user.createdAt)}</span>
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleActive(user)}
                              disabled={currentUser?.email === user.email}
                              className="p-2 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                              style={{ background: 'transparent', border: '1px solid var(--border-color)' }}
                              title={user.active ? 'Deactivate user' : 'Activate user'}
                              onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.borderColor = 'var(--accent-amber)'; } }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                            >
                              <Power className="h-4 w-4" style={{ color: user.active ? 'var(--accent-amber)' : 'var(--text-muted)' }} strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={() => openEditModal(user)}
                              className="p-2 rounded-lg transition-all"
                              style={{ background: 'transparent', border: '1px solid var(--border-color)' }}
                              title="Edit user"
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.borderColor = 'var(--accent-blue)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                            >
                              <Edit className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(user)}
                              disabled={currentUser?.email === user.email}
                              className="p-2 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                              style={{ background: 'transparent', border: '1px solid var(--border-color)' }}
                              title="Delete user"
                              onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.borderColor = 'var(--accent-red)'; } }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                            >
                              <Trash2 className="h-4 w-4" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingUser) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-backdrop"
          style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 animate-modal-in"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))' }}>
                  {editingUser ? <Edit className="h-5 w-5 text-white" /> : <Plus className="h-5 w-5 text-white" />}
                </div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {editingUser ? 'Edit User' : 'Add New User'}
                </h2>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none transition-all text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    placeholder="Juan Dela Cruz"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none transition-all text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    placeholder="juan@madison88.com"
                  />
                </div>
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Role
                </label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl focus:outline-none transition-all text-sm appearance-none cursor-pointer"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                  >
                    {roles.map(r => (
                      <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Password {editingUser && <span className="normal-case font-normal">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl focus:outline-none transition-all text-sm"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; }}
                    placeholder={editingUser ? '••••••••' : 'Enter password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, active: !formData.active })}
                  className="relative w-11 h-6 rounded-full transition-all duration-200"
                  style={{ background: formData.active ? 'var(--accent-lime)' : 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200"
                    style={{ left: formData.active ? '22px' : '2px' }}
                  />
                </button>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Account active</span>
              </div>

              {/* Error */}
              {formError && (
                <div className="rounded-xl p-3 animate-fade-in-up flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                  <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--accent-red)' }} />
                  <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{formError}</p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-xl font-medium text-sm transition-all"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px var(--accent-lime-glow)' }}
                  onMouseEnter={(e) => { if (!saving) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 0 24px var(--accent-lime-glow)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 0 16px var(--accent-lime-glow)'; }}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-backdrop"
          style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 animate-modal-in"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)' }}>
                <Trash2 className="h-8 w-8" style={{ color: 'var(--accent-red)' }} />
              </div>
              <div>
                <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Delete User?</h3>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Are you sure you want to delete <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{deleteConfirm.name}</span>? This action cannot be undone.
                </p>
              </div>
              <div className="flex items-center gap-3 w-full pt-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2.5 rounded-xl font-medium text-sm transition-all"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: 'var(--accent-red)', color: '#fff' }}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl animate-slide-in-right"
          style={{
            background: 'var(--bg-card)',
            border: `1px solid color-mix(in srgb, ${toast.type === 'success' ? 'var(--accent-lime)' : 'var(--accent-red)'} 30%, transparent)`,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="h-5 w-5" style={{ color: 'var(--accent-lime)' }} />
          ) : (
            <AlertCircle className="h-5 w-5" style={{ color: 'var(--accent-red)' }} />
          )}
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{toast.message}</p>
        </div>
      )}
    </div>
  );
}
