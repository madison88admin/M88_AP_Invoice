import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-md w-full text-center">
        <h1 className="text-7xl font-bold mb-2" style={{ color: 'var(--accent-purple)' }}>404</h1>
        <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Page not found</p>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
          style={{ background: 'var(--accent-purple)', color: 'var(--text-inverse)' }}
        >
          <Home className="h-4 w-4" strokeWidth={1.75} />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
