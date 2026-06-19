// TODO: TEMPORARY MOCK AUTH — replace with Azure AD / MSAL SSO
// once Supabase backend is connected. See BRD section on
// Authentication (Azure AD / Microsoft 365 SSO via MSAL).
// Do not deploy this hardcoded user list to production.

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { mockAuth, MockUser } from '../lib/mockAuth';

interface AuthContextType {
  user: MockUser | null;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<MockUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check for existing session on mount
    const currentUser = mockAuth.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      setIsAuthenticated(true);
    }
  }, []);

  const login = (email: string, password: string): boolean => {
    const loggedInUser = mockAuth.login(email, password);
    if (loggedInUser) {
      setUser(loggedInUser);
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    mockAuth.logout();
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
};
