import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { validateNextGenCredentials } from '../services/nextGenAuthService';
import { logAudit } from '../services/auditLogService';

const router = Router() as Router;

/**
 * Demo users for quick login buttons. Only enabled when ENABLE_DEMO_LOGIN=true.
 * These accounts are intentionally NOT authenticated against NextGen.
 */
const DEMO_USERS = [
  { email: 'wyssa.martinez@madison88.com', name: 'Wyssa', role: 'ACCOUNTING_ASSOCIATE', password: 'madison88' },
  { email: 'al@madison88.com', name: 'AL', role: 'ACCOUNTING_SUPERVISOR', password: 'madison88' },
  { email: 'joy.yco@madison88.com', name: 'Joy', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'maricon.alvarez@madison88.com', name: 'Maricon', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'maricar.tanaleon@madison88.com', name: 'Maricar', role: 'PURCHASING_MANAGER', password: 'madison88' },
  { email: 'maryann.delmonte@madison88.com', name: 'Maryann', role: 'PURCHASING_MANAGER', password: 'madison88' },
  { email: 'edwin.garcia@madison88.com', name: 'Edwin', role: 'PLANNING_MANAGER', password: 'madison88', brand_scope: 'TOP_10' as const },
  { email: 'glecie.yumena@madison88.com', name: 'Glecie', role: 'PLANNING_MANAGER', password: 'madison88', brand_scope: 'OTHER' as const },
  { email: 'lindsey.castro@madison88.com', name: 'Lindsey', role: 'SR_MANAGER_GLOBAL_PRODUCTION', password: 'madison88' },
  { email: 'polly.madison@madison88.com', name: 'Polly', role: 'MS_POLLY', password: 'madison88' },
  { email: 'jc@madison88.com', name: 'JC', role: 'IT_ADMIN', password: 'madison88' },
];

const isDemoLoginEnabled = () => process.env.ENABLE_DEMO_LOGIN === 'true' || process.env.NODE_ENV === 'development';

function buildAuthResponse(user: any, id: string) {
  const brandScope = user.role === 'PLANNING_MANAGER' ? (user.brand_scope || undefined) : undefined;
  const email = user.email;
  const token = jwt.sign(
    {
      id,
      email,
      name: user.name,
      role: user.role,
      brand_scope: brandScope,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' }
  );

  return {
    token,
    user: {
      id,
      email,
      name: user.name,
      role: user.role,
      title: user.role.replace(/_/g, ' '),
      brand_scope: brandScope,
    },
  };
}

/**
 * Extract a NextGen username from an email address.
 * e.g. wyssa.martinez@madison88.com -> Wyssa, joy.yco@madison88.com -> Joy
 */
function extractUsernameFromEmail(email: string): string {
  const localPart = email.trim().split('@')[0];
  const firstName = localPart.split('.')[0];
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

/**
 * Map NextGen usernames to AP Invoice roles.
 * Configure via NEXTGEN_USER_ROLES env variable as JSON, e.g.:
 * {"Glecie":"PLANNING_MANAGER","Joy":"PURCHASING_COORDINATOR"}
 * Falls back to IT_ADMIN if no mapping is found for a user.
 */
function getRoleForUsername(username: string): UserRole {
  const envMap = process.env.NEXTGEN_USER_ROLES;
  let roleMap: Record<string, string> = {};
  if (envMap) {
    try {
      roleMap = JSON.parse(envMap);
    } catch {
      // ignore invalid JSON and fall back to default map
    }
  }

  const defaultMap: Record<string, string> = {
    'Glecie': 'PLANNING_MANAGER',
    'Edwin': 'PLANNING_MANAGER',
    'Joy': 'PURCHASING_COORDINATOR',
    'Maricon': 'PURCHASING_COORDINATOR',
    'Maricar': 'PURCHASING_MANAGER',
    'Maryann': 'PURCHASING_MANAGER',
    'Mary': 'ACCOUNTING_SUPERVISOR',
    'Lindsey': 'SR_MANAGER_GLOBAL_PRODUCTION',
    'Chris': 'CFO',
    'Polly': 'MS_POLLY',
    'Paul': 'IT_ADMIN',
    'Jc': 'IT_ADMIN',
  };

  const normalized = username.trim();
  const lower = normalized.toLowerCase();
  const envKey = Object.keys(roleMap).find(k => k.toLowerCase() === lower);
  const defaultKey = Object.keys(defaultMap).find(k => k.toLowerCase() === lower);
  const role = (envKey && roleMap[envKey]) || (defaultKey && defaultMap[defaultKey]) || 'IT_ADMIN';
  return (role as UserRole) || UserRole.IT_ADMIN;
}

/**
 * Determine brand scope for planning managers based on the default MLO holder mapping.
 * Returns undefined for non-planning-manager roles.
 */
function getBrandScopeForUsername(username: string): 'TOP_10' | 'OTHER' | undefined {
  const defaultMap: Record<string, 'TOP_10' | 'OTHER' | undefined> = {
    'Edwin': 'TOP_10',
    'Glecie': 'OTHER',
  };
  return defaultMap[username.trim()] || undefined;
}

/**
 * POST /api/auth/login
 * Authenticate against NextGen using ASP.NET Forms credentials.
 * On success, returns a short-lived API JWT signed with JWT_SECRET.
 * The user's role is determined by NEXTGEN_USER_ROLES or the default map.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;
    if (!identifier || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const nextGenUsername = email ? extractUsernameFromEmail(email) : identifier;
    const valid = await validateNextGenCredentials(nextGenUsername, password);
    if (!valid) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const role = getRoleForUsername(nextGenUsername);
    const brandScope = role === 'PLANNING_MANAGER' ? getBrandScopeForUsername(nextGenUsername) : undefined;
    const userEmail = email || `${nextGenUsername.toLowerCase()}@madison88.com`;
    const token = jwt.sign(
      {
        id: nextGenUsername,
        email: userEmail,
        name: nextGenUsername,
        role,
        brand_scope: brandScope,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await logAudit({
      performed_by: nextGenUsername,
      action: 'USER_LOGIN',
      note: `User ${nextGenUsername} (${userEmail}) logged in via NextGen as ${role}`,
    });

    res.json({
      token,
      user: {
        id: nextGenUsername,
        email: userEmail,
        name: nextGenUsername,
        role,
        title: role.replace(/_/g, ' '),
        brand_scope: brandScope,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/demo-login
 * Bypass NextGen authentication for demo/development quick login buttons.
 * Only available when ENABLE_DEMO_LOGIN=true or NODE_ENV=development.
 */
router.post('/demo-login', async (req, res, next) => {
  try {
    if (!isDemoLoginEnabled()) {
      throw new AppError('Demo login is disabled', 403);
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const { email, password } = req.body;
    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const demoUser = DEMO_USERS.find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );

    if (!demoUser) {
      throw new AppError('Invalid demo credentials', 401);
    }

    await logAudit({
      performed_by: demoUser.name,
      action: 'USER_LOGIN_DEMO',
      note: `User ${demoUser.name} (${demoUser.email}) logged in via demo login as ${demoUser.role}`,
    });

    res.json(buildAuthResponse(demoUser, demoUser.name));
  } catch (error) {
    next(error);
  }
});

export default router;
