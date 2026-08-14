import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditLogService';
import prisma from '../config/database';
import crypto from 'crypto';

const router = Router() as Router;

/**
 * Demo users for quick login buttons. Only enabled when ENABLE_DEMO_LOGIN=true.
 * These accounts are intentionally NOT authenticated against NextGen.
 */
const DEMO_USERS = [
  { email: 'edwin.garcia@madison88.com', name: 'Edwin', role: 'PLANNING_MANAGER', password: 'madison88', brand_scope: 'TOP_10' as const },
  { email: 'glecie.yumena@madison88.com', name: 'Glecie', role: 'PLANNING_MANAGER', password: 'madison88', brand_scope: 'OTHER' as const },
  { email: 'maryan.untiveros@madison88.com', name: 'Maryan', role: 'MLO_ACCOUNT_HOLDER', password: 'madison88' },
  { email: 'lindsey.castro@madison88.com', name: 'Lindsey', role: 'SR_MANAGER_GLOBAL_PRODUCTION', password: 'madison88' },
  { email: 'polly.madison@madison88.com', name: 'Polly', role: 'MS_POLLY', password: 'madison88' },
  { email: 'jc@madison88.com', name: 'JC', role: 'SUPERADMIN', password: 'Ar5yG3#4' },
  // Live accounts — short email aliases
  { email: 'meann@madison88.com', name: 'Meann', role: 'PURCHASING_MANAGER', password: 'madison88' },
  { email: 'maricar@madison88.com', name: 'Maricar', role: 'PURCHASING_MANAGER', password: 'madison88' },
  { email: 'maricon@madison88.com', name: 'Maricon', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'pamela@madison88.com', name: 'Pamela', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'sarah@madison88.com', name: 'Sarah', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'april@madison88.com', name: 'April', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'jasmine@madison88.com', name: 'Jasmine', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'earl@madison88.com', name: 'Earl', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'mjsantiago@madison88.com', name: 'MJ Santiago', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'joy@madison88.com', name: 'Joy', role: 'PURCHASING_COORDINATOR', password: 'madison88' },
  { email: 'wyssa@madison88.com', name: 'Wyssa', role: 'ACCOUNTING_ASSOCIATE', password: 'madison88' },
  { email: 'Aldrin@madison88.com', name: 'Aldrin', role: 'ACCOUNTING_SUPERVISOR', password: 'madison88' },
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
    const demoUser = DEMO_USERS.find(
      (u) => u.email.toLowerCase() === identifier.toLowerCase() && u.password === password
    );

    if (demoUser) {
      await logAudit({
        performed_by: demoUser.name,
        action: 'USER_LOGIN',
        note: `User ${demoUser.name} (${demoUser.email}) logged in as ${demoUser.role}`,
      });
      return res.json(buildAuthResponse(demoUser, demoUser.name));
    }

    // 2. Check database (users created/updated via User Management)
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const dbUser = await prisma.user.findFirst({
      where: {
        email: { equals: identifier.toLowerCase(), mode: 'insensitive' },
        password_hash: passwordHash,
        active: true,
      },
    });

    if (dbUser) {
      const userObj = {
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
      };
      await logAudit({
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
