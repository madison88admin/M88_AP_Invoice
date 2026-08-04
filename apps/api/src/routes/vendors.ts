import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { getVendorSuggestions } from '../services/vendorMatchingService';
import prisma from '../config/database';
import { UserRole } from '@ap-invoice/shared';
import { inAppNotificationService } from '../services/inAppNotificationService';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

const router: Router = Router();

const BANK_FIELDS = ['bank_name', 'swift_code', 'account_number', 'iban', 'sort_code', 'aba_routing_number', 'bank_name_alt', 'bank_address', 'account_number_alt', 'swift_code_alt', 'intermediary_bank_name', 'intermediary_bank_swift', 'has_multiple_accounts'];
const ACCOUNTING_ROLES = [UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN];

router.use(authenticate);

// IMPORTANT: /suggestions and /bank-details/masterlist must come BEFORE /:id to avoid route collision
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

// Bank Details Masterlist — must be before /:id
router.get('/bank-details/masterlist', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
    });

    // Get invoice counts per vendor
    const invoiceCounts = await prisma.invoice.groupBy({
      by: ['vendor_id'],
      _count: { id: true },
      where: { vendor_id: { not: undefined } as any },
    });
    const countMap = new Map(invoiceCounts.map((c: any) => [c.vendor_id, c._count.id]));

    const result = vendors.map(v => ({
      id: v.id,
      name: v.name,
      beneficiary_name: v.beneficiary_name,
      classification: v.classification,
      supplier_location: v.supplier_location,
      bank_name: v.bank_name,
      bank_name_alt: v.bank_name_alt,
      bank_address: v.bank_address,
      swift_code: v.swift_code,
      swift_code_alt: v.swift_code_alt,
      account_number: v.account_number,
      account_number_alt: v.account_number_alt,
      iban: v.iban,
      sort_code: v.sort_code,
      aba_routing_number: v.aba_routing_number,
      intermediary_bank_name: v.intermediary_bank_name,
      intermediary_bank_swift: v.intermediary_bank_swift,
      has_multiple_accounts: v.has_multiple_accounts,
      bank_verified_at: v.bank_verified_at,
      invoice_count: countMap.get(v.id) || 0,
    }));

    res.json(result);
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

router.post('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.create({
      data: {
        ...req.body,
        id: req.body.id || crypto.randomUUID(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    res.status(201).json(vendor);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
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
      data: {
        ...updateData,
        updated_at: new Date(),
      },
    });
    res.json(vendor);
  } catch (error) {
    next(error);
  }
});

// Request bank info update — any authenticated user can request
router.post('/:id/request-bank-update', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
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

    // Create notification for accounting team
    await inAppNotificationService.create({
      vendor_name: vendor.name,
      title: 'Bank Info Update Request',
      message: `${requesterName} (${requesterRole}) requested a bank info update for vendor "${vendor.name}".\nReason: ${reason.trim()}\nRequested changes:\n${changes.join('\n')}`,
      type: 'warning',
      category: 'stage',
      target_role: UserRole.ACCOUNTING_SUPERVISOR,
    });

    // Also notify ACCOUNTING_ASSOCIATE
    await inAppNotificationService.create({
      vendor_name: vendor.name,
      title: 'Bank Info Update Request',
      message: `${requesterName} (${requesterRole}) requested a bank info update for vendor "${vendor.name}".\nReason: ${reason.trim()}\nRequested changes:\n${changes.join('\n')}`,
      type: 'warning',
      category: 'stage',
      target_role: UserRole.ACCOUNTING_ASSOCIATE,
    });

    res.json({ message: 'Bank update request sent to the Accounting team' });
  } catch (error) {
    next(error);
  }
});

// ─── BANK DETAILS UPDATE (propagate to invoices) ────────────────────────────
// Update vendor bank details AND propagate to all related invoices
router.patch('/:id/bank-details', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendorId = req.params.id;
    const { bank_name, swift_code, account_number, bank_name_alt, bank_address, account_number_alt, swift_code_alt, iban, sort_code, aba_routing_number, intermediary_bank_name, intermediary_bank_swift } = req.body;

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) {
      throw new AppError('Vendor not found', 404);
    }

    // Build update data for vendor
    const vendorUpdate: Record<string, any> = { updated_at: new Date() };
    const bankUpdateFields = { bank_name, swift_code, account_number, bank_name_alt, bank_address, account_number_alt, swift_code_alt, iban, sort_code, aba_routing_number, intermediary_bank_name, intermediary_bank_swift };
    for (const [key, value] of Object.entries(bankUpdateFields)) {
      if (value !== undefined) {
        vendorUpdate[key] = value;
      }
    }

    // Update vendor
    await prisma.vendor.update({
      where: { id: vendorId },
      data: vendorUpdate,
    });

    // Propagate bank changes to ALL invoices linked to this vendor
    const invoiceUpdate: Record<string, any> = {};
    if (bank_name !== undefined) invoiceUpdate.bank_name = bank_name;
    if (swift_code !== undefined) invoiceUpdate.swift_code = swift_code;
    if (account_number !== undefined) invoiceUpdate.account_number = account_number;

    let updatedInvoices = 0;
    if (Object.keys(invoiceUpdate).length > 0) {
      const result = await prisma.invoice.updateMany({
        where: { vendor_id: vendorId },
        data: { ...invoiceUpdate, updated_at: new Date() },
      });
      updatedInvoices = result.count;
    }

    // Create audit log
    const changedFields = Object.keys(vendorUpdate).filter(k => k !== 'updated_at');
    await prisma.auditLog.create({
      data: {
        action: 'VENDOR_BANK_UPDATED',
        performed_by: req.user!.id,
        note: `Vendor "${vendor.name}" bank details updated by ${req.user!.role}. Fields: ${changedFields.join(', ')}. Propagated to ${updatedInvoices} invoice(s).`,
      },
    }).catch(() => { /* audit log failure should not block the update */ });

    res.json({
      message: `Bank details updated for vendor "${vendor.name}" and propagated to ${updatedInvoices} invoice(s)`,
      vendor_id: vendorId,
      updated_fields: changedFields,
      invoices_updated: updatedInvoices,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
