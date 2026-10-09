import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FullPageSpinner } from './ui/Spinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Optional role gate for pages that must not be reachable by URL alone. */
  roles?: string[];
}

export default function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullPageSpinner label="Loading your workspace..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && (!user || !roles.includes(user.role))) {
    return <Navigate to="/" replace />;
  }

  return <div className="animate-page-in">{children}</div>;
}
