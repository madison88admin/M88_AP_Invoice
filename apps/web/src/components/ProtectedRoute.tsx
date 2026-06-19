// TODO: TEMPORARY MOCK AUTH — replace with Azure AD / MSAL SSO
// once Supabase backend is connected. See BRD section on
// Authentication (Azure AD / Microsoft 365 SSO via MSAL).
// Do not deploy this hardcoded user list to production.

import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
