import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditLogService';
import prisma from '../config/database';
import { hashPassword, verifyPassword } from '../services/passwordService';

const router = Router() as Router;

/**
 * Demo users for quick login buttons. Only enabled when ENABLE_DEMO_LOGIN=true.
 * These accounts are intentionally NOT authenticated against NextGen.
 */
type DemoUser = { email: string; name: string; role: string; password: string; brand_scope?: 'TOP_10' | 'OTHER' };

function getDemoUsers(): DemoUser[] {
  if (!isDemoLoginEnabled()) return [];
  // Local development can run without PostgreSQL. Keep this fallback strictly
  // development-only; production still requires DEMO_USERS_JSON or database users.
  if (!process.env.DEMO_USERS_JSON && process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL) {
    return [
      { email: 'maryan.untiveros@madison88.com', name: 'Maryan', role: UserRole.MLO_ACCOUNT_HOLDER, password: 'madison88' },
      { email: 'edwin.garcia@madison88.com', name: 'Edwin', role: UserRole.PLANNING_MANAGER, password: 'madison88' },
      { email: 'glecie.yumena@madison88.com', name: 'Glecie', role: UserRole.PLANNING_MANAGER, password: 'madison88' },
      { email: 'lindsey.castro@madison88.com', name: 'Lindsey', role: UserRole.SR_MANAGER_GLOBAL_PRODUCTION, password: 'madison88' },
      { email: 'polly.madison@madison88.com', name: 'Polly', role: UserRole.MS_POLLY, password: 'madison88' },
    ];
  }
  if (!process.env.DEMO_USERS_JSON) return [];
  try {
    const parsed = JSON.parse(process.env.DEMO_USERS_JSON);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const isDemoLoginEnabled = () => process.env.ENABLE_DEMO_LOGIN === 'true' || process.env.NODE_ENV === 'development';

async function auditIfDatabaseEnabled(data: Parameters<typeof logAudit>[0]) {
  if (process.env.DATABASE_URL) await logAudit(data);
}

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
 * POST /api/auth/login
 * Authenticate locally — demo users (ENABLE_DEMO_LOGIN) and users managed
 * in the system's User Management (APInvoice_User table).
 * On success, returns a short-lived API JWT signed with JWT_SECRET.
 * NOTE: Login intentionally does NOT validate against NextGen in real time;
 * all accounts are local so the flow is fast and never depends on NextGen uptime.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;
    if (!identifier || !password) {
      throw new AppError('Email and password are required', 400);
    }

    if (!process.env.JWT_SECRET) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    // 1. Check DEMO_USERS (live email accounts) first
    const demoUser = getDemoUsers().find(
      (u) => u.email.toLowerCase() === identifier.toLowerCase() && u.password === password
    );

    if (demoUser) {
      await auditIfDatabaseEnabled({
        performed_by: demoUser.name,
        action: 'USER_LOGIN',
        note: `User ${demoUser.name} (${demoUser.email}) logged in as ${demoUser.role}`,
      });
      return res.json(buildAuthResponse(demoUser, demoUser.name));
    }

    // 2. Check database (users created/updated via User Management)
    const dbUser = await prisma.user.findFirst({
      where: {
        email: { equals: identifier.toLowerCase(), mode: 'insensitive' },
        active: true,
      },
    });

    const passwordCheck = dbUser ? verifyPassword(password, dbUser.password_hash) : { valid: false, needsUpgrade: false };
    if (dbUser && passwordCheck.valid) {
      if (passwordCheck.needsUpgrade) {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { password_hash: hashPassword(password) },
        });
      }
      const userObj = {
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
      };
      await auditIfDatabaseEnabled({
        performed_by: dbUser.name,
        action: 'USER_LOGIN',
        note: `User ${dbUser.name} (${dbUser.email}) logged in as ${dbUser.role}`,
      });
      return res.json(buildAuthResponse(userObj, dbUser.id));
    }

    // No NextGen fallback — all accounts are local (demo users or User Management).
    throw new AppError('Invalid credentials', 401);
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

    const demoUser = getDemoUsers().find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );

    if (!demoUser) {
      throw new AppError('Invalid demo credentials', 401);
    }

    await auditIfDatabaseEnabled({
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
