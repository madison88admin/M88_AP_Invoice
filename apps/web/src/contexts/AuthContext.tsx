import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  title?: string;
  brand_scope?: 'TOP_10' | 'OTHER';
}

interface AuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<boolean>;
  demoLogin: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
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

const SESSION_KEY = 'auth_session';

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const session = localStorage.getItem(SESSION_KEY);
    const isJwt = !!token && token.split('.').length === 3;
    if (session && isJwt) {
      try {
        const currentUser = JSON.parse(session) as AuthUser;
        setUser(currentUser);
        setIsAuthenticated(true);
      } catch {
        localStorage.removeItem('auth_token');
        localStorage.removeItem(SESSION_KEY);
      }
    } else {
      localStorage.removeItem('auth_token');
      localStorage.removeItem(SESSION_KEY);
    }
    setIsLoading(false);
  }, []);

  const handleAuthResponse = (response: any): boolean => {
    const { token, user } = response.data;
    localStorage.setItem('auth_token', token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    setUser(user as AuthUser);
    setIsAuthenticated(true);
    return true;
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await api.post('/api/auth/login', { email, password });
      return handleAuthResponse(response);
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const demoLogin = async (email: string, password: string): Promise<boolean> => {
    try {
      const response = await api.post('/api/auth/demo-login', { email, password });
      return handleAuthResponse(response);
    } catch (error) {
      console.error('Demo login failed:', error);
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, demoLogin, logout, isAuthenticated, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
