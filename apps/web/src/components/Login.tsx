import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, Lock, Mail } from 'lucide-react';

const QUICK_LOGINS = [
  { label: 'Wyssa (Accounting)', email: 'wyssa.martinez@madison88.com', password: 'madison88' },
  { label: 'Joy (Coordinator)', email: 'joy.yco@madison88.com', password: 'madison88' },
  { label: 'Maricon (Coordinator)', email: 'maricon.alvarez@madison88.com', password: 'madison88' },
  { label: 'Maricar (Manager)', email: 'maricar.tanaleon@madison88.com', password: 'madison88' },
  { label: 'Maryann (Manager)', email: 'maryann.delmonte@madison88.com', password: 'madison88' },
  { label: 'Edwin (Planning Mgr)', email: 'edwin.garcia@madison88.com', password: 'madison88' },
  { label: 'Glecie (Planning Mgr)', email: 'glecie.yumena@madison88.com', password: 'madison88' },
  { label: 'Lindsey (Sr Manager)', email: 'lindsey.castro@madison88.com', password: 'madison88' },
  { label: 'Polly (President)', email: 'polly.madison@madison88.com', password: 'madison88' },
  { label: 'JC (IT Admin)', email: 'jc@madison88.com', password: 'madison88' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
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

  const applyQuickLogin = (quickEmail: string, quickPassword: string) => {
    setEmail(quickEmail);
    setPassword(quickPassword);
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl mb-4" style={{ background: 'var(--logo-bg)', boxShadow: '0 0 40px rgba(99,102,241,0.4)' }}>
            <LayoutDashboard className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Madison 88</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>AP Invoice System</p>
        </div>

        <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
          <h2 className="text-xl font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>Sign in</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 transition-all"
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
              <label htmlFor="password" className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 transition-all"
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
              <div className="rounded-lg p-3" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-purple-hover))',
                color: '#ffffff',
                boxShadow: '0 0 20px rgba(99,102,241,0.45), 0 4px 15px rgba(0,0,0,0.3)'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.boxShadow = '0 0 35px rgba(99,102,241,0.65), 0 4px 20px rgba(0,0,0,0.4)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 0 20px rgba(99,102,241,0.45), 0 4px 15px rgba(0,0,0,0.3)';
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
                  className="text-xs px-3 py-1 rounded-lg transition-all"
                  style={{
                    background: 'var(--bg-card-hover)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--input-bg)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-card-hover)';
                    e.currentTarget.style.color = 'var(--text-muted)';
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
