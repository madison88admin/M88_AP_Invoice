import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import {
  ArrowLeft, Settings as SettingsIcon, Users, Server, Shield,
  Activity, Database, Cpu, RefreshCw, ExternalLink,
} from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const [healthData, setHealthData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await api.get('/health/engines');
      setHealthData(res.data);
    } catch (err) {
      console.error('Failed to fetch system health:', err);
    } finally {
      setLoading(false);
    }
  };

  const configCards = [
    {
      icon: Users,
      title: 'User Management',
      desc: 'Manage user accounts, roles, and permissions',
      link: '/users',
      color: 'var(--accent-purple)',
    },
    {
      icon: Shield,
      title: 'Role Permissions',
      desc: 'View role-based access control configuration',
      color: 'var(--accent-blue)',
    },
    {
      icon: Server,
      title: 'System Status',
      desc: 'Monitor engine health and integrations',
      color: 'var(--accent-lime)',
    },
    {
      icon: Database,
      title: 'Database',
      desc: 'Database connection and configuration',
      color: 'var(--accent-amber)',
    },
  ];

  return (
    <div className="max-w-5xl">
          {/* Config Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {configCards.map((card, idx) => {
              const content = (
                <div
                  className="p-5 rounded-2xl transition-all duration-200 animate-list-item card-lift"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    animationDelay: `${idx * 60}ms`,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = `color-mix(in srgb, ${card.color} 30%, transparent)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl flex-shrink-0" style={{ background: `color-mix(in srgb, ${card.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${card.color} 25%, transparent)` }}>
                      <card.icon className="h-5 w-5" style={{ color: card.color }} strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{card.title}</h3>
                        {card.link && <ExternalLink className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />}
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{card.desc}</p>
                    </div>
                  </div>
                </div>
              );

              if (card.link) {
                return <Link key={card.title} to={card.link} className="block">{content}</Link>;
              }
              return <div key={card.title}>{content}</div>;
            })}
          </div>

          {/* System Health */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
                <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Engine Health</h2>
              </div>
              <button
                onClick={fetchHealth}
                disabled={loading}
                className="p-2 rounded-lg transition-all"
                style={{ background: 'transparent', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 animate-fade-in">
                <div className="h-8 w-8 rounded-full border-2 animate-spin" style={{ borderTopColor: 'var(--accent-purple)', borderRightColor: 'var(--accent-purple)', borderBottomColor: 'transparent', borderLeftColor: 'transparent' }} />
                <p className="text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>Checking engines...</p>
              </div>
            ) : healthData ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {/* Gemini */}
                <HealthRow
                  icon={Cpu}
                  name="Gemini OCR"
                  status={healthData.engines?.gemini?.available ? 'online' : 'offline'}
                  details={`Model: ${healthData.engines?.gemini?.model || 'N/A'} · Configured: ${healthData.engines?.gemini?.configured ? 'Yes' : 'No'}`}
                />
                {/* Groq */}
                <HealthRow
                  icon={Cpu}
                  name="Groq OCR"
                  status={healthData.engines?.groq?.available ? 'online' : 'offline'}
                  details={`Configured: ${healthData.engines?.groq?.configured ? 'Yes' : 'No'}`}
                />
                {/* NextGen */}
                <HealthRow
                  icon={Server}
                  name="NextGen Integration"
                  status={healthData.engines?.nextgen?.configured ? 'online' : 'offline'}
                  details={`Configured: ${healthData.engines?.nextgen?.configured ? 'Yes' : 'No'}`}
                />
                {/* Database */}
                <HealthRow
                  icon={Database}
                  name="Database"
                  status={healthData.engines?.database?.connected ? 'online' : 'offline'}
                  details={`Enabled: ${healthData.engines?.database?.enabled ? 'Yes' : 'No'} · Connected: ${healthData.engines?.database?.connected ? 'Yes' : 'No'}`}
                />
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Failed to load system health</p>
              </div>
            )}
          </div>

          {/* Current User Info */}
          <div className="mt-6 p-5 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Your Session</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-full text-sm font-bold" style={{ background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))', color: '#fff' }}>
                {user?.name?.slice(0, 2).toUpperCase() || '??'}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user?.email} · {user?.role.replace(/_/g, ' ')}</p>
              </div>
            </div>
          </div>
    </div>
  );
}

function HealthRow({ icon: Icon, name, status, details }: { icon: any; name: string; status: 'online' | 'offline'; details: string }) {
  const isOnline = status === 'online';
  return (
    <div className="flex items-center gap-4 px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
        <Icon className="h-4 w-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{name}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{details}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: isOnline ? 'var(--accent-lime)' : 'var(--text-muted)' }} />
        <span className="text-xs font-medium" style={{ color: isOnline ? 'var(--accent-lime)' : 'var(--text-muted)' }}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  );
}
