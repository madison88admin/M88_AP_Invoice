import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { getVendorSuggestions } from '../services/vendorMatchingService';
import prisma from '../config/database';
import { UserRole } from '@ap-invoice/shared';
import { inAppNotificationService } from '../services/inAppNotificationService';
import { AppError } from '../middleware/errorHandler';
import upload from '../middleware/upload';

const router: Router = Router();

const BANK_FIELDS = ['bank_name', 'swift_code', 'account_number', 'iban', 'sort_code', 'aba_routing_number', 'bank_name_alt', 'bank_address', 'account_number_alt', 'swift_code_alt', 'intermediary_bank_name', 'intermediary_bank_swift', 'has_multiple_accounts'];
const ACCOUNTING_ROLES = [UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN];
const VENDOR_CREATOR_ROLES = [UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE];

router.use(authenticate);

// IMPORTANT: /suggestions must come BEFORE /:id to avoid route collision
router.get('/suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, limit } = req.query;
    const suggestions = await getVendorSuggestions(
      search as string || '',
      limit ? parseInt(limit as string) : 5
    );
    res.json(suggestions);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendors = await prisma.vendor.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(vendors);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
    });
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    res.json(vendor);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user || !VENDOR_CREATOR_ROLES.includes(req.user.role)) {
      throw new AppError('Only Accounting can add vendors', 403);
    }
    const vendor = await prisma.vendor.create({
      data: req.body,
    });
    res.status(201).json(vendor);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.PURCHASING_MANAGER, UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userRole = req.user?.role;
    const updateData = { ...req.body };

    // If user is not accounting/IT, strip bank fields from the update
    if (userRole && !ACCOUNTING_ROLES.includes(userRole)) {
      const attemptedBankFields = BANK_FIELDS.filter(f => f in updateData);
      if (attemptedBankFields.length > 0) {
        // Check if any bank field actually changed from current values
        const currentVendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
        if (currentVendor) {
          const hasBankChanges = attemptedBankFields.some(f => {
            const current = (currentVendor as any)[f];
            const newVal = updateData[f];
            return JSON.stringify(current) !== JSON.stringify(newVal);
          });
          if (hasBankChanges) {
            return res.status(403).json({
              error: {
                message: 'You cannot modify bank information. Please submit a bank update request to the Accounting team.',
                status: 403
              }
            });
          }
        }
        // Remove bank fields from update (no changes detected, but prevent setting them)
        BANK_FIELDS.forEach(f => delete updateData[f]);
      }
    }

    const vendor = await prisma.vendor.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json(vendor);
  } catch (error) {
    next(error);
  }
});

// Request bank info update — any authenticated user can request
// Accepts optional file attachment (bank letter / bank verification email)
router.post('/:id/request-bank-update', authenticate, upload.single('attachment'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor) {
      throw new AppError('Vendor not found', 404);
    }

    const { bank_name, swift_code, account_number, reason } = req.body;
    if (!reason || !reason.trim()) {
      throw new AppError('A reason for the bank update request is required', 400);
    }

    const requesterName = req.user?.name || 'Unknown';
    const requesterRole = req.user?.role || 'Unknown';

    // Build summary of requested changes
    const changes: string[] = [];
    if (bank_name !== undefined && bank_name !== vendor.bank_name) changes.push(`Bank Name: "${vendor.bank_name || 'N/A'}" → "${bank_name || 'N/A'}"`);
    if (swift_code !== undefined && swift_code !== vendor.swift_code) changes.push(`SWIFT Code: "${vendor.swift_code || 'N/A'}" → "${swift_code || 'N/A'}"`);
    if (account_number !== undefined && account_number !== vendor.account_number) changes.push(`Account Number: "${vendor.account_number || 'N/A'}" → "${account_number || 'N/A'}"`);

    if (changes.length === 0) {
      throw new AppError('No bank information changes detected in the request', 400);
    }

    // Handle file attachment
    let attachmentInfo = '';
    let attachmentName = '';
    let attachmentMime = '';
    if (req.file) {
      attachmentName = req.file.originalname;
      attachmentMime = req.file.mimetype;
      attachmentInfo = `\nAttachment: ${attachmentName} (${(req.file.size / 1024).toFixed(1)} KB)`;
    }

    // Create audit log entry for the bank update request
    await prisma.auditLog.create({
      data: {
        action: 'BANK_UPDATE_REQUEST',
        performed_by: requesterName,
        note: `Vendor: "${vendor.name}" | Requested by: ${requesterRole}\nReason: ${reason.trim()}\nRequested changes:\n${changes.join('\n')}${attachmentInfo}`,
      },
    });

    // Create notification for accounting team
    const notificationMessage = `${requesterName} (${requesterRole}) requested a bank info update for vendor "${vendor.name}".\nReason: ${reason.trim()}\nRequested changes:\n${changes.join('\n')}${attachmentInfo}`;

    await inAppNotificationService.create({
      vendor_name: vendor.name,
      title: 'Bank Info Update Request',
      message: notificationMessage,
      type: 'warning',
      category: 'stage',
      target_role: UserRole.ACCOUNTING_SUPERVISOR,
    });

    // Also notify ACCOUNTING_ASSOCIATE
    await inAppNotificationService.create({
      vendor_name: vendor.name,
      title: 'Bank Info Update Request',
      message: notificationMessage,
      type: 'warning',
      category: 'stage',
      target_role: UserRole.ACCOUNTING_ASSOCIATE,
    });

    res.json({ message: 'Bank update request sent to the Accounting team' });
  } catch (error) {
    next(error);
  }
});

export default router;
