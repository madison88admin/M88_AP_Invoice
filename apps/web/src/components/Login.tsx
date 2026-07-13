import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, Lock, Mail, Loader2, ArrowRight, Shield, Zap, FileCheck, Building2 } from 'lucide-react';

const QUICK_LOGINS = [
  { label: 'Wyssa', role: 'Accounting Associate', email: 'wyssa.martinez@madison88.com', password: 'madison88' },
  { label: 'AL', role: 'Accounting Supervisor', email: 'al@madison88.com', password: 'madison88' },
  { label: 'Joy', role: 'Coordinator', email: 'joy.yco@madison88.com', password: 'madison88' },
  { label: 'Maricon', role: 'Coordinator', email: 'maricon.alvarez@madison88.com', password: 'madison88' },
  { label: 'Maricar', role: 'Manager', email: 'maricar.tanaleon@madison88.com', password: 'madison88' },
  { label: 'Maryann', role: 'Manager', email: 'maryann.delmonte@madison88.com', password: 'madison88' },
  { label: 'Maryan', role: 'MLO Account Holder', email: 'maryan.untiveros@madison88.com', password: 'madison88' },
  { label: 'Edwin', role: 'Planning Mgr', email: 'edwin.garcia@madison88.com', password: 'madison88' },
  { label: 'Glecie', role: 'Planning Mgr', email: 'glecie.yumena@madison88.com', password: 'madison88' },
  { label: 'Lindsey', role: 'Sr Manager', email: 'lindsey.castro@madison88.com', password: 'madison88' },
  { label: 'Polly', role: 'Ms Polly', email: 'polly.madison@madison88.com', password: 'madison88' },
  { label: 'JC', role: 'SuperAdmin', email: 'jc@madison88.com', password: 'madison88' },
];

const FEATURES = [
  { icon: FileCheck, title: 'Automated Validation', desc: 'PO matching & exception flagging' },
  { icon: Zap, title: 'Multi-Stage Approvals', desc: 'Role-based signatory workflow' },
  { icon: Shield, title: 'Audit & Compliance', desc: 'Full traceability & SLA tracking' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, demoLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const success = await login(email, password);
    if (success) {
      navigate('/dashboard');
    } else {
      setError('Invalid email or password');
    }

    setLoading(false);
  };

  const applyQuickLogin = async (quickEmail: string, quickPassword: string) => {
    setEmail(quickEmail);
    setPassword(quickPassword);
    setError('');
    setLoading(true);
    const success = await demoLogin(quickEmail, quickPassword);
    if (success) {
      navigate('/dashboard');
    } else {
      setError('Demo login failed or is disabled');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-base)' }}>
      {/* Left Panel — Brand Showcase */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[50%] flex-col justify-between p-12 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0D0D0F 0%, #151518 50%, #1a1a22 100%)' }}>
        {/* Animated gradient mesh */}
        <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 20% 30%, rgba(108,92,231,0.25) 0%, transparent 50%), radial-gradient(ellipse at 80% 70%, rgba(198,255,61,0.12) 0%, transparent 50%), radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.15) 0%, transparent 60%)' }} />

        {/* Floating orbs */}
        <div className="absolute top-20 right-20 w-64 h-64 rounded-full opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--accent-purple) 0%, transparent 70%)', animation: 'drift1 12s ease-in-out infinite alternate' }} />
        <div className="absolute bottom-20 left-10 w-80 h-80 rounded-full opacity-10 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--accent-lime) 0%, transparent 70%)', animation: 'drift2 15s ease-in-out infinite alternate' }} />

        {/* Top — Logo & Brand */}
        <div className="relative z-10 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-2">
            <img src="/madison-logo.png" alt="Madison 88" className="h-12 w-auto" />
            <div>
              <h1 className="text-xl font-bold text-white">Madison 88</h1>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Business Solutions</p>
            </div>
          </div>
        </div>

        {/* Middle — Hero Text */}
        <div className="relative z-10 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
            AP Invoice<br />
            <span style={{ background: 'linear-gradient(135deg, var(--accent-lime), var(--accent-violet))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Automation Platform</span>
          </h2>
          <p className="text-base max-w-md" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Streamline your invoice processing with intelligent OCR, multi-stage approvals, and real-time analytics.
          </p>
        </div>

        {/* Bottom — Feature Highlights */}
        <div className="relative z-10 space-y-3 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          {FEATURES.map((feat, idx) => (
            <div
              key={feat.title}
              className="flex items-center gap-4 p-3 rounded-xl transition-all duration-200 animate-list-item"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', animationDelay: `${300 + idx * 80}ms` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.transform = 'translateX(4px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.transform = 'translateX(0)'; }}
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-purple) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
                <feat.icon className="w-5 h-5" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{feat.title}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{feat.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-20 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(108,92,231,0.2) 0%, transparent 70%)', animationDuration: '5s' }} />

        <div className="w-full max-w-md relative z-10 animate-fade-in-up">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8 justify-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 30px rgba(108,92,231,0.35)' }}>
              <LayoutDashboard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Madison 88</h1>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>AP Invoice System</p>
            </div>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Welcome back</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to your account to continue</p>
          </div>

          {/* Form Card */}
          <div className="rounded-2xl p-6 sm:p-8 animate-scale-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)' }}>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Email Address
                </label>
                <div className="relative group">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors" style={{ color: 'var(--text-muted)' }} />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl focus:outline-none transition-all text-sm"
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--text-primary)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    placeholder="you@madison88.com"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Password
                </label>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors" style={{ color: 'var(--text-muted)' }} />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl focus:outline-none transition-all text-sm"
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--text-primary)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl p-3 animate-fade-in-up flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent-red)' }} />
                  <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--accent-lime)',
                  color: 'var(--bg-base)',
                  boxShadow: '0 0 20px var(--accent-lime-glow), 0 4px 15px rgba(0,0,0,0.3)',
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = 'var(--accent-lime-hover)';
                    e.currentTarget.style.boxShadow = '0 0 30px var(--accent-lime-glow), 0 6px 20px rgba(0,0,0,0.4)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--accent-lime)';
                  e.currentTarget.style.boxShadow = '0 0 20px var(--accent-lime-glow), 0 4px 15px rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Sign in
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </button>
            </form>
          </div>

          {/* Quick Logins */}
          <div className="mt-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Demo Quick Login
              </p>
              <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[200px] overflow-y-auto pr-1">
              {QUICK_LOGINS.map((item, idx) => (
                <button
                  key={item.email}
                  type="button"
                  onClick={() => applyQuickLogin(item.email, item.password)}
                  disabled={loading}
                  className="px-3 py-2.5 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed animate-list-item text-left group"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    animationDelay: `${idx * 40}ms`,
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) {
                      e.currentTarget.style.background = 'var(--bg-card-hover)';
                      e.currentTarget.style.borderColor = 'var(--accent-lime)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-card)';
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{item.label}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{item.role}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
            Madison 88 Business Solutions · AP Invoice Automation
          </p>
        </div>
      </div>
    </div>
  );
}
