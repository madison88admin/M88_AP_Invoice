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

router.get('/master-change-requests', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await prisma.vendorMasterChangeRequest.findMany({
      where: typeof req.query.status === 'string' ? { status: req.query.status } : undefined,
      include: { vendor: { select: { id: true, name: true, governance_status: true } } },
      orderBy: { created_at: 'desc' },
    }));
  } catch (error) { next(error); }
});

router.post('/master-change-requests/:id/approve', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.vendorMasterChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== 'PENDING') throw new AppError('Pending Vendor Master change not found', 404);
    if (request.requested_by_id === req.user!.id) throw new AppError('Requester cannot approve their own Vendor Master change', 403);
    const proposed = request.proposed_data as Record<string, any>;
    if (BANK_FIELDS.some(field => field in proposed)) throw new AppError('Bank fields require the separate bank-change approval workflow', 400);
    const [vendor] = await prisma.$transaction([
      prisma.vendor.update({ where: { id: request.vendor_id }, data: { ...proposed, governance_status: 'APPROVED', governance_reviewed_by: req.user!.name, governance_reviewed_at: new Date(), governance_rejection_reason: null } }),
      prisma.vendorMasterChangeRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', reviewed_by: req.user!.name, reviewed_by_id: req.user!.id, reviewed_at: new Date() } }),
    ]);
    res.json({ message: 'Vendor Master change approved', vendor });
  } catch (error) { next(error); }
});

router.post('/master-change-requests/:id/reject', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.vendorMasterChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== 'PENDING') throw new AppError('Pending Vendor Master change not found', 404);
    if (request.requested_by_id === req.user!.id) throw new AppError('Requester cannot reject their own Vendor Master change', 403);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new AppError('Rejection reason is required', 400);
    res.json(await prisma.vendorMasterChangeRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', reviewed_by: req.user!.name, reviewed_by_id: req.user!.id, reviewed_at: new Date(), rejection_reason: reason } }));
  } catch (error) { next(error); }
});

router.post('/pending/:id/approve', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor || vendor.governance_status !== 'PENDING') throw new AppError('Pending vendor not found', 404);
    if (vendor.governance_requested_by === req.user!.name || vendor.governance_requested_by === req.user!.id) throw new AppError('Requester cannot approve their own vendor', 403);
    res.json(await prisma.vendor.update({ where: { id: vendor.id }, data: { governance_status: 'APPROVED', is_active: true, governance_reviewed_by: req.user!.name, governance_reviewed_at: new Date(), governance_rejection_reason: null } }));
  } catch (error) { next(error); }
});

router.post('/pending/:id/reject', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor || vendor.governance_status !== 'PENDING') throw new AppError('Pending vendor not found', 404);
    if (vendor.governance_requested_by === req.user!.name || vendor.governance_requested_by === req.user!.id) throw new AppError('Requester cannot reject their own vendor', 403);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new AppError('Rejection reason is required', 400);
    res.json(await prisma.vendor.update({ where: { id: vendor.id }, data: { governance_status: 'REJECTED', is_active: false, governance_reviewed_by: req.user!.name, governance_reviewed_at: new Date(), governance_rejection_reason: reason } }));
  } catch (error) { next(error); }
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
        governance_status: 'PENDING',
        governance_requested_by: req.user!.name || req.user!.id,
        governance_requested_at: new Date(),
        is_active: false,
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

    res.status(201).json({ ...vendor, message: 'Vendor created as PENDING and requires independent approval before use.' });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
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

    if (changedBankFields.length > 0) throw new AppError('Inline bank edits are locked. Submit a bank update request for independent approval.', 403);
    BANK_FIELDS.forEach(field => delete updateData[field]);
    const reason = String(updateData.change_reason || updateData.reason || '').trim();
    if (!reason) throw new AppError('A reason is required for Vendor Master changes', 400);
    ['id', 'created_at', 'updated_at', 'governance_status', 'governance_requested_by', 'governance_requested_at', 'governance_reviewed_by', 'governance_reviewed_at', 'governance_rejection_reason', 'change_reason', 'reason'].forEach(field => delete updateData[field]);
    const request = await prisma.vendorMasterChangeRequest.create({ data: {
      vendor_id: currentVendor.id,
      proposed_data: updateData,
      reason,
      requested_by: req.user!.name || req.user!.id,
      requested_by_id: req.user!.id,
    } });
    res.status(202).json({ message: 'Vendor Master change submitted for independent approval', request });
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
    throw new AppError('Inline bank updates are locked. Use the bank-change request approval workflow.', 403);
  } catch (error) {
    next(error);
  }
});

export default router;
