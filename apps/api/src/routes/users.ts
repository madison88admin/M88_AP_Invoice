import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditLogService';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const router = Router() as Router;

// All routes require authentication + SUPERADMIN or IT_ADMIN
router.use(authenticate);
router.use(authorize(UserRole.SUPERADMIN, UserRole.IT_ADMIN));

// ─── File-based user storage ───
const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function ensureDataFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    // Seed with the known users from DEMO_USERS
    const seedUsers: StoredUser[] = [
      { id: '1', name: 'Wyssa', email: 'wyssa.martinez@madison88.com', role: 'ACCOUNTING_ASSOCIATE', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '2', name: 'AL', email: 'al@madison88.com', role: 'ACCOUNTING_SUPERVISOR', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '3', name: 'Joy', email: 'joy.yco@madison88.com', role: 'PURCHASING_COORDINATOR', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '4', name: 'Maricon', email: 'maricon.alvarez@madison88.com', role: 'PURCHASING_COORDINATOR', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '5', name: 'Maricar', email: 'maricar.tanaleon@madison88.com', role: 'PURCHASING_MANAGER', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '6', name: 'Maryann', email: 'maryann.delmonte@madison88.com', role: 'PURCHASING_MANAGER', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '7', name: 'Maryan', email: 'maryan.untiveros@madison88.com', role: 'MLO_ACCOUNT_HOLDER', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '8', name: 'Edwin', email: 'edwin.garcia@madison88.com', role: 'PLANNING_MANAGER', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '9', name: 'Glecie', email: 'glecie.yumena@madison88.com', role: 'PLANNING_MANAGER', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '10', name: 'Lindsey', email: 'lindsey.castro@madison88.com', role: 'SR_MANAGER_GLOBAL_PRODUCTION', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '11', name: 'Polly', email: 'polly.madison@madison88.com', role: 'MS_POLLY', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: '12', name: 'JC', email: 'jc@madison88.com', role: 'SUPERADMIN', passwordHash: hashPassword('madison88'), active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(seedUsers, null, 2));
  }
}

function readUsers(): StoredUser[] {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  ensureDataFile();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Sanitize user for API response (never expose password hash)
function sanitizeUser(u: StoredUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

const VALID_ROLES = Object.values(UserRole);

// ─── Routes ───

/**
 * GET /api/users
 * List all users
 */
router.get('/', (req: Request, res: Response) => {
  const users = readUsers().map(sanitizeUser);
  res.json({ users });
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
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = readUsers().find(u => u.id === req.params.id);
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

    const users = readUsers();
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      throw new AppError('A user with this email already exists', 409);
    }

    const newUser: StoredUser = {
      id: generateId(),
      name,
      email: email.toLowerCase(),
      role,
      passwordHash: hashPassword(password),
      active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeUsers(users);

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
    const users = readUsers();
    const user = users.find(u => u.id === req.params.id);

    if (!user) throw new AppError('User not found', 404);

    const changes: string[] = [];

    if (name !== undefined && name !== user.name) {
      user.name = name;
      changes.push(`name → ${name}`);
    }

    if (email !== undefined && email.toLowerCase() !== user.email) {
      if (users.some(u => u.id !== user.id && u.email.toLowerCase() === email.toLowerCase())) {
        throw new AppError('A user with this email already exists', 409);
      }
      user.email = email.toLowerCase();
      changes.push(`email → ${email}`);
    }

    if (role !== undefined && role !== user.role) {
      if (!VALID_ROLES.includes(role as UserRole)) {
        throw new AppError(`Invalid role. Valid roles: ${VALID_ROLES.join(', ')}`, 400);
      }
      user.role = role;
      changes.push(`role → ${role}`);
    }

    if (active !== undefined && active !== user.active) {
      user.active = active;
      changes.push(`active → ${active}`);
    }

    if (password !== undefined && password.length > 0) {
      user.passwordHash = hashPassword(password);
      changes.push('password changed');
    }

    user.updatedAt = new Date().toISOString();
    writeUsers(users);

    if (changes.length > 0) {
      await logAudit({
        performed_by: (req as any).user?.name || 'unknown',
        action: 'USER_UPDATED',
        note: `Updated user ${user.name} (${user.email}): ${changes.join(', ')}`,
      });
    }

    res.json({ user: sanitizeUser(user) });
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
    const users = readUsers();
    const user = users.find(u => u.id === req.params.id);

    if (!user) throw new AppError('User not found', 404);

    // Prevent self-deletion
    if ((req as any).user?.email === user.email) {
      throw new AppError('You cannot delete your own account', 400);
    }

    // Prevent deleting the last SUPERADMIN
    if (user.role === 'SUPERADMIN') {
      const superAdmins = users.filter(u => u.role === 'SUPERADMIN' && u.active);
      if (superAdmins.length <= 1) {
        throw new AppError('Cannot delete the last SuperAdmin account', 400);
      }
    }

    const filtered = users.filter(u => u.id !== req.params.id);
    writeUsers(filtered);

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
