import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { validateNextGenCredentials } from '../services/nextGenAuthService';

const router = Router() as Router;

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
    'MaryAnn': 'PURCHASING_MANAGER',
    'Mary': 'ACCOUNTING_SUPERVISOR',
    'Lindsey': 'SR_MANAGER_GLOBAL_PRODUCTION',
    'Chris': 'CFO',
    'Polly': 'MS_POLLY',
    'Paul': 'IT_ADMIN',
    'JC': 'IT_ADMIN',
  };

  const normalized = username.trim();
  const role = roleMap[normalized] || defaultMap[normalized] || 'IT_ADMIN';
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
    const { username, password } = req.body;
    if (!username || !password) {
      throw new AppError('Username and password are required', 400);
    }

    const valid = await validateNextGenCredentials(username, password);
    if (!valid) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const role = getRoleForUsername(username);
    const brandScope = role === 'PLANNING_MANAGER' ? getBrandScopeForUsername(username) : undefined;
    const email = `${username.toLowerCase()}@madison88.com`;
    const token = jwt.sign(
      {
        id: username,
        email,
        name: username,
        role,
        brand_scope: brandScope,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: username,
        email,
        name: username,
        role,
        title: role.replace(/_/g, ' '),
        brand_scope: brandScope,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
