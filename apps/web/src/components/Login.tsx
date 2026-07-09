import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, Lock, Mail } from 'lucide-react';

const QUICK_LOGINS = [
  { label: 'Wyssa (Accounting Associate)', email: 'wyssa.martinez@madison88.com', password: 'madison88' },
  { label: 'AL (Accounting Supervisor)', email: 'al@madison88.com', password: 'madison88' },
  { label: 'Joy (Coordinator)', email: 'joy.yco@madison88.com', password: 'madison88' },
  { label: 'Maricon (Coordinator)', email: 'maricon.alvarez@madison88.com', password: 'madison88' },
  { label: 'Maricar (Manager)', email: 'maricar.tanaleon@madison88.com', password: 'madison88' },
  { label: 'Maryann (Manager)', email: 'maryann.delmonte@madison88.com', password: 'madison88' },
  { label: 'Maryan (MLO Account Holder)', email: 'maryan.untiveros@madison88.com', password: 'madison88' },
  { label: 'Edwin (Planning Mgr)', email: 'edwin.garcia@madison88.com', password: 'madison88' },
  { label: 'Glecie (Planning Mgr)', email: 'glecie.yumena@madison88.com', password: 'madison88' },
  { label: 'Lindsey (Sr Manager)', email: 'lindsey.castro@madison88.com', password: 'madison88' },
  { label: 'Polly (Ms Polly)', email: 'polly.madison@madison88.com', password: 'madison88' },
  { label: 'JC (IT Admin)', email: 'jc@madison88.com', password: 'madison88' },
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Radial glow behind logo */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(108,92,231,0.25) 0%, rgba(198,255,61,0.08) 40%, transparent 70%)' }} />

      <div className="w-full max-w-md p-8 relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 relative" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', boxShadow: '0 0 40px rgba(108,92,231,0.35)' }}>
            <LayoutDashboard className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Madison 88</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>AP Invoice System</p>
        </div>

        <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)' }}>
          <h2 className="text-xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>Sign in</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 transition-all"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--text-primary)'
                  }}
                  placeholder="Enter your Madison 88 email"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 transition-all"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--text-primary)'
                  }}
                  placeholder="Enter your password"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
                <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--accent-lime)',
                color: 'var(--bg-base)',
                boxShadow: '0 0 20px var(--accent-lime-glow), 0 4px 15px rgba(0,0,0,0.3)'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'var(--accent-lime-hover)';
                  e.currentTarget.style.boxShadow = '0 0 30px var(--accent-lime-glow), 0 4px 20px rgba(0,0,0,0.4)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--accent-lime)';
                e.currentTarget.style.boxShadow = '0 0 20px var(--accent-lime-glow), 0 4px 15px rgba(0,0,0,0.3)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-color)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Quick Login (development/demo only)
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_LOGINS.map((item) => (
                <button
                  key={item.email}
                  type="button"
                  onClick={() => applyQuickLogin(item.email, item.password)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-card-hover)';
                    e.currentTarget.style.borderColor = 'var(--accent-lime)';
                    e.currentTarget.style.color = 'var(--accent-lime)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
