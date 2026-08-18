import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditLogService';
import prisma from '../config/database';
import crypto from 'crypto';
import { hashPassword } from '../services/passwordService';

const router = Router() as Router;

// All routes require authentication + SUPERADMIN or IT_ADMIN
router.use(authenticate);
router.use(authorize(UserRole.SUPERADMIN, UserRole.IT_ADMIN));

// Sanitize user for API response (never expose password hash)
function sanitizeUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    createdAt: u.created_at?.toISOString?.() || u.created_at,
    updatedAt: u.updated_at?.toISOString?.() || u.updated_at,
  };
}

const VALID_ROLES = Object.values(UserRole);

// ─── Routes ───

/**
 * GET /api/users
 * List all users
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { created_at: 'asc' } });
    res.json({ users: users.map(sanitizeUser) });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/roles/list
 * Get all available roles (must be before /:id to avoid conflict)
 */
router.get('/roles/list', (_req: Request, res: Response) => {
  res.json({ roles: VALID_ROLES });
});

/**
 * GET /api/users/:id
 * Get a single user
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError('User not found', 404);
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users
 * Create a new user
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, role, password, active = true } = req.body;

    if (!name || !email || !role || !password) {
      throw new AppError('Name, email, role, and password are required', 400);
    }

    if (!VALID_ROLES.includes(role as UserRole)) {
      throw new AppError(`Invalid role. Valid roles: ${VALID_ROLES.join(', ')}`, 400);
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
    });
    if (existing) {
      throw new AppError('A user with this email already exists', 409);
    }

    const now = new Date();
    const newUser = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name,
        email: email.toLowerCase(),
        role,
        password_hash: hashPassword(password),
        active,
        created_at: now,
        updated_at: now,
      },
    });

    await logAudit({
      performed_by: (req as any).user?.name || 'unknown',
      action: 'USER_CREATED',
      note: `Created user ${name} (${email}) with role ${role}`,
    });

    res.status(201).json({ user: sanitizeUser(newUser) });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/users/:id
 * Update user fields (name, email, role, active, password)
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, role, password, active } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });

    if (!user) throw new AppError('User not found', 404);

    const changes: string[] = [];
    const data: any = {};

    if (name !== undefined && name !== user.name) {
      data.name = name;
      changes.push(`name → ${name}`);
    }

    if (email !== undefined && email.toLowerCase() !== user.email) {
      const conflict = await prisma.user.findFirst({
        where: {
          id: { not: user.id },
          email: { equals: email.toLowerCase(), mode: 'insensitive' },
        },
      });
      if (conflict) {
        throw new AppError('A user with this email already exists', 409);
      }
      data.email = email.toLowerCase();
      changes.push(`email → ${email}`);
    }

    if (role !== undefined && role !== user.role) {
      if (!VALID_ROLES.includes(role as UserRole)) {
        throw new AppError(`Invalid role. Valid roles: ${VALID_ROLES.join(', ')}`, 400);
      }
      data.role = role;
      changes.push(`role → ${role}`);
    }

    if (active !== undefined && active !== user.active) {
      data.active = active;
      changes.push(`active → ${active}`);
    }

    if (password !== undefined && password.length > 0) {
      data.password_hash = hashPassword(password);
      changes.push('password changed');
    }

    if (changes.length > 0) {
      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: {
          ...data,
          updated_at: new Date(),
        },
      });

      await logAudit({
        performed_by: (req as any).user?.name || 'unknown',
        action: 'USER_UPDATED',
        note: `Updated user ${updated.name} (${updated.email}): ${changes.join(', ')}`,
      });

      res.json({ user: sanitizeUser(updated) });
    } else {
      res.json({ user: sanitizeUser(user) });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/users/:id
 * Delete a user
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });

    if (!user) throw new AppError('User not found', 404);

    // Prevent self-deletion
    if ((req as any).user?.email === user.email) {
      throw new AppError('You cannot delete your own account', 400);
    }

    // Prevent deleting the last SUPERADMIN
    if (user.role === 'SUPERADMIN') {
      const superAdmins = await prisma.user.count({
        where: { role: 'SUPERADMIN', active: true },
      });
      if (superAdmins <= 1) {
        throw new AppError('Cannot delete the last SuperAdmin account', 400);
      }
    }

    await prisma.user.delete({ where: { id: req.params.id } });

    await logAudit({
      performed_by: (req as any).user?.name || 'unknown',
      action: 'USER_DELETED',
      note: `Deleted user ${user.name} (${user.email})`,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
