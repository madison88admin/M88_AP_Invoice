import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { getVendorSuggestions } from '../services/vendorMatchingService';
import prisma from '../config/database';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { maskBankAccount } from '../utils/sensitiveData';
import {
  findDuplicateVendors,
  findBankAccountReuse,
  alertBankAccountReuse,
  requestVendorBankUpdate,
  listVendorBankChangeRequests,
  approveVendorBankChange,
  rejectVendorBankChange,
  normalizeVendorName,
} from '../services/vendorControlService';

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

// ─── Vendor bank change request queue (Phase 11: requester != approver) ─────
// Must be registered before /:id to avoid route collisions.
router.get('/bank-change-requests', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listVendorBankChangeRequests(req.query.status as string | undefined));
  } catch (error) {
    next(error);
  }
});

router.post('/bank-change-requests/:id/approve', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await approveVendorBankChange(req.params.id, req.user!.id, req.user!.name || 'Unknown');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/bank-change-requests/:id/reject', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await rejectVendorBankChange(req.params.id, req.user!.id, req.user!.name || 'Unknown', req.body?.reason);
    res.json(result);
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
      account_number: maskBankAccount(v.account_number),
      account_number_alt: v.account_number_alt.map(maskBankAccount),
      iban: maskBankAccount(v.iban),
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
    res.json(vendors.map(v => ({ ...v, account_number: maskBankAccount(v.account_number), account_number_alt: v.account_number_alt.map(maskBankAccount), iban: maskBankAccount(v.iban) })));
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
    res.json({ ...vendor, account_number: maskBankAccount(vendor.account_number), account_number_alt: vendor.account_number_alt.map(maskBankAccount), iban: maskBankAccount(vendor.iban) });
  } catch (error) {
    next(error);
  }
});

router.post('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Phase 11: duplicate vendor check — block when an active vendor already
    // has the same normalized name (case/space-insensitive).
    if (req.body.name) {
      const dupes = await findDuplicateVendors(req.body.name);
      if (dupes.length > 0) {
        return res.status(409).json({
          error: {
            message: `Duplicate vendor detected: "${dupes[0].name}" already exists (ID ${dupes[0].id}). Use the existing vendor or refine the name instead.`,
            status: 409,
          },
        });
      }
    }

    const vendor = await prisma.vendor.create({
      data: {
        ...req.body,
        id: req.body.id || crypto.randomUUID(),
        name_aliases: req.body.name_aliases || [],
        bank_name_alt: req.body.bank_name_alt || [],
        account_number_alt: req.body.account_number_alt || [],
        swift_code_alt: req.body.swift_code_alt || [],
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Phase 11: critical bank-reuse alert when the new vendor uses an account
    // already assigned to another active vendor.
    if (req.body.account_number) {
      const reuse = await findBankAccountReuse(vendor.id, req.body.account_number);
      if (reuse.length > 0) {
        await alertBankAccountReuse(vendor.name, req.body.account_number, reuse, req.user?.id);
      }
    }

    res.status(201).json(vendor);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userRole = req.user?.role;
    const updateData = { ...req.body };

    const currentVendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!currentVendor) {
      throw new AppError('Vendor not found', 404);
    }

    // Phase 11: duplicate vendor check on rename
    if (updateData.name && normalizeVendorName(updateData.name) !== normalizeVendorName(currentVendor.name)) {
      const dupes = await findDuplicateVendors(updateData.name, req.params.id);
      if (dupes.length > 0) {
        return res.status(409).json({
          error: {
            message: `Duplicate vendor detected: "${dupes[0].name}" already exists (ID ${dupes[0].id}). Use the existing vendor or refine the name instead.`,
            status: 409,
          },
        });
      }
    }

    // Phase 11: critical bank-reuse alert when account fields change to an
    // account already assigned to another active vendor.
    const attemptedBankFields = BANK_FIELDS.filter(f => f in updateData);
    const changedBankFields = attemptedBankFields.filter(f => JSON.stringify((currentVendor as any)[f]) !== JSON.stringify(updateData[f]));
    if (changedBankFields.includes('account_number') && updateData.account_number) {
      const reuse = await findBankAccountReuse(req.params.id, updateData.account_number);
      if (reuse.length > 0) {
        await alertBankAccountReuse(currentVendor.name, updateData.account_number, reuse, req.user?.id);
      }
    }

    // If user is not accounting/IT, strip bank fields from the update
    if (userRole && !ACCOUNTING_ROLES.includes(userRole)) {
      if (changedBankFields.length > 0) {
        return res.status(403).json({ 
          error: { 
            message: 'You cannot modify bank information. Please submit a bank update request to the Accounting team.',
            status: 403 
          } 
        });
      }
      // Remove bank fields from update (no changes detected, but prevent setting them)
      BANK_FIELDS.forEach(f => delete updateData[f]);
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

// Request bank info update — any authenticated user can request. Persisted as a
// VendorBankChangeRequest so requester != approver is enforceable server-side.
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

    const candidates = [
      { field: 'bank_name', value: bank_name },
      { field: 'swift_code', value: swift_code },
      { field: 'account_number', value: account_number },
    ].filter(c => c.value !== undefined && String(c.value) !== String((vendor as any)[c.field] ?? ''));

    if (candidates.length === 0) {
      throw new AppError('No bank information changes detected in the request', 400);
    }

    const requesterName = req.user?.name || 'Unknown';
    const requesterRole = req.user?.role || 'Unknown';
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authenticated user ID missing', 401);
    }

    const requests: any[] = [];
    for (const c of candidates) {
      const result = await requestVendorBankUpdate(
        vendor.id,
        { field: c.field, requested_value: c.value, reason },
        userId,
        requesterName,
        requesterRole
      );
      requests.push(result.request);
    }

    res.json({ message: 'Bank update request(s) submitted — Accounting has been notified.', requests });
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

    // Bank changes are locked while any linked invoice is in active review/payment.
    // Users must use the bank-change request workflow so the snapshot and audit trail
    // cannot be changed underneath an in-flight payment.
    const activeInvoice = await prisma.invoice.findFirst({
      where: { vendor_id: vendorId, status: { in: ['PENDING_ACCOUNTING', 'APPROVED', 'PAYMENT_SCHEDULED', 'POSTED_TO_QB', 'PAYMENT_CONFIRMATION_SENT', 'PAID'] as any } },
      select: { invoice_number: true, status: true },
    });
    if (activeInvoice) {
      throw new AppError(`Bank details are locked while invoice ${activeInvoice.invoice_number} is ${activeInvoice.status}. Submit a bank-change request instead.`, 409);
    }

    // Phase 11: requester != approver — the user applying a bank change cannot
    // be the requester of an open request for the same vendor.
    const pendingOwnRequest = await prisma.vendorBankChangeRequest.findFirst({
      where: { vendor_id: vendorId, status: 'PENDING', requested_by_id: req.user!.id },
    });
    if (pendingOwnRequest) {
      throw new AppError('You cannot apply a bank change you requested. Ask another Accounting user to review and apply it.', 403);
    }

    // Phase 11: critical bank-reuse alert when the account number changes to
    // one already assigned to another active vendor.
    if (account_number !== undefined && account_number !== vendor.account_number && account_number) {
      const reuse = await findBankAccountReuse(vendorId, account_number);
      if (reuse.length > 0) {
        await alertBankAccountReuse(vendor.name, account_number, reuse, req.user?.id);
      }
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

    // Phase 11: auto-approve pending requests from OTHER users whose requested
    // value matches the applied field (the requester != approver rule already
    // blocked self-application above).
    const appliedFields: Record<string, any> = {};
    if (bank_name !== undefined) appliedFields.bank_name = bank_name;
    if (swift_code !== undefined) appliedFields.swift_code = swift_code;
    if (account_number !== undefined) appliedFields.account_number = account_number;
    const pendingRequests = await prisma.vendorBankChangeRequest.findMany({
      where: { vendor_id: vendorId, status: 'PENDING' },
    });
    for (const pending of pendingRequests) {
      if (pending.requested_by_id === req.user!.id) continue; // defensive: never self-approve
      if (pending.field in appliedFields && String(appliedFields[pending.field]) === String(pending.requested_value)) {
        await prisma.vendorBankChangeRequest.update({
          where: { id: pending.id },
          data: { status: 'APPROVED', reviewed_by: req.user!.name || 'Unknown', reviewed_at: new Date() },
        });
      }
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
