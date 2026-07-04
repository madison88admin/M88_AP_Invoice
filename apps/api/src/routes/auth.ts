import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { validateNextGenCredentials } from '../services/nextGenAuthService';

const router = Router() as Router;

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

export default router;
