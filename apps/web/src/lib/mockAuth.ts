// TODO: TEMPORARY MOCK AUTH — replace with Azure AD / MSAL SSO
// once Supabase backend is connected. See BRD section on
// Authentication (Azure AD / Microsoft 365 SSO via MSAL).
// Do not deploy this hardcoded user list to production.

export interface MockUser {
  email: string;
  password: string;
  name: string;
  role: string;
  title?: string;
  brand_scope?: 'TOP_10' | 'OTHER';
}

export const MOCK_USERS: MockUser[] = [
  {
    email: "superadmin@madison88.com",
    password: "madison88",
    name: "Super Admin",
    role: "SUPERADMIN",
    title: "System Administrator"
  },
  {
    email: "wyssa.martinez@madison88.com",
    password: "madison88",
    name: "Wyssa Elaine Martinez",
    role: "ACCOUNTING_ASSOCIATE",
    title: "Accounting Associate"
  },
  {
    email: "joy.yco@madison88.com",
    password: "madison88",
    name: "Joy Yco",
    role: "PURCHASING_COORDINATOR",
    title: "Purchasing Coordinator"
  },
  {
    email: "maricon.alvarez@madison88.com",
    password: "madison88",
    name: "Maricon Alvarez",
    role: "PURCHASING_COORDINATOR",
    title: "Purchasing Coordinator"
  },
  {
    email: "maricar.tanaleon@madison88.com",
    password: "madison88",
    name: "Maricar Tanaleon",
    role: "PURCHASING_MANAGER",
    title: "Purchasing Manager"
  },
  {
    email: "maryann.delmonte@madison88.com",
    password: "madison88",
    name: "Mary Ann Del Monte",
    role: "PURCHASING_MANAGER",
    title: "Purchasing Manager"
  },
  {
    email: "mary.delmonte@madison88.com",
    password: "madison88",
    name: "Mary Del Monte",
    role: "ACCOUNTING_SUPERVISOR",
    title: "Accounting Supervisor"
  },
  {
    email: "edwin.garcia@madison88.com",
    password: "madison88",
    name: "Edwin Garcia",
    role: "PLANNING_MANAGER",
    brand_scope: "TOP_10",
    title: "Associate Operations Manager & Lead Process Improvement Analyst"
  },
  {
    email: "glecie.yumena@madison88.com",
    password: "madison88",
    name: "Glecie Yumena",
    role: "PLANNING_MANAGER",
    brand_scope: "OTHER",
    title: "Planning Manager"
  },
  {
    email: "lindsey.schindler@madison88.com",
    password: "madison88",
    name: "Lindsey Schindler",
    role: "SR_MANAGER_GLOBAL_PRODUCTION",
    title: "Senior Manager, Global Production Operations"
  },
  {
    email: "cc@madison88.com",
    password: "madison88",
    name: "Chris Cantasano",
    role: "CFO",
    title: "CFO"
  },
  {
    email: "polly@madison88.com",
    password: "madison88",
    name: "Polly",
    role: "MS_POLLY",
    title: "President"
  },
  {
    email: "paul.avendano@madison88.com",
    password: "madison88",
    name: "Paul Avendaño",
    role: "IT_ADMIN",
    title: "IT Admin"
  },
  {
    email: "jc@madison88.com",
    password: "madison88",
    name: "JC",
    role: "IT_ADMIN",
    title: "IT Admin"
  }
];

const SESSION_KEY = 'mock_session';
const TOKEN_KEY = 'auth_token';

// Simple JWT-like token generation for mock auth
const generateMockToken = (user: MockUser): string => {
  const payload = {
    id: user.email,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  return btoa(JSON.stringify(payload)); // Base64 encode as simple token
};

export const mockAuth = {
  login: (email: string, password: string): MockUser | null => {
    const user = MOCK_USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (user) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      // Also store as auth_token for API compatibility
      const token = generateMockToken(user);
      localStorage.setItem(TOKEN_KEY, token);
      return user;
    }
    return null;
  },

  logout: () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  },

  getCurrentUser: (): MockUser | null => {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      try {
        return JSON.parse(session);
      } catch {
        return null;
      }
    }
    return null;
  },

  isAuthenticated: (): boolean => {
    return localStorage.getItem(SESSION_KEY) !== null;
  }
};

export type Role = MockUser['role'];
