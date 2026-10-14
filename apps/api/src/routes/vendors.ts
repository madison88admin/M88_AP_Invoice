import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { getVendorSuggestions } from '../services/vendorMatchingService';
import prisma, { isDbEnabled } from '../config/database';
import { UserRole } from '@ap-invoice/shared';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { maskBankAccount } from '../utils/sensitiveData';
import upload from '../middleware/upload';
import { uploadToStorage } from '../services/supabaseStorageService';
import {
  findDuplicateVendors,
  findBankAccountReuse,
  alertBankAccountReuse,
  requestVendorBankUpdate,
  listVendorBankChangeRequests,
  approveVendorBankChange,
  rejectVendorBankChange,
  recordVendorBankVersion,
  normalizeVendorName,
  normalizeSupportingDocuments,
} from '../services/vendorControlService';

const router: Router = Router();

const BANK_FIELDS = ['bank_name', 'swift_code', 'account_number', 'iban', 'sort_code', 'aba_routing_number', 'bank_name_alt', 'bank_address', 'account_number_alt', 'swift_code_alt', 'intermediary_bank_name', 'intermediary_bank_swift', 'has_multiple_accounts'];
const FULL_BANK_DETAIL_ROLES = [
  UserRole.ACCOUNTING_SUPERVISOR,
  UserRole.ACCOUNTING_ASSOCIATE,
  UserRole.IT_ADMIN,
  UserRole.SUPERADMIN,
];
const ACCOUNTING_ROLES = [UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN];

// Upload validated evidence against an existing bank-change request. The
// request still follows the Associate → Supervisor approval workflow, while
// this endpoint stores the actual file rather than a bare text reference.
router.post('/:id/bank-change-evidence', authenticate, upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError('A supporting document file is required', 400);
    const requestId = String(req.body.request_id || '').trim();
    if (!requestId) throw new AppError('request_id is required', 400);
    const request = await prisma.vendorBankChangeRequest.findFirst({ where: { id: requestId, vendor_id: req.params.id } });
    if (!request) throw new AppError('Bank change request not found for this vendor', 404);
    if (![UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN].includes(req.user!.role as any)) {
      throw new AppError('Not authorized to upload bank-change evidence', 403);
    }
    const storagePath = await uploadToStorage(req.file.buffer, `bank-change-evidence/${req.params.id}/${req.file.originalname}`, req.file.mimetype);
    if (!storagePath) throw new AppError('Evidence storage is unavailable; the request was not changed.', 503);
    const evidence = {
      file_name: req.file.originalname,
      storage_path: storagePath,
      sha256: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
      mime_type: req.file.mimetype,
      uploaded_at: new Date().toISOString(),
      uploaded_by: req.user!.id,
      source: 'BANK_CHANGE_EVIDENCE_UPLOAD',
    };
    const existing = normalizeSupportingDocuments(request.supporting_documents);
    const updated = await prisma.vendorBankChangeRequest.update({
      where: { id: request.id },
      data: { supporting_documents: [...existing, evidence] as any },
    });
    res.status(201).json({ request: updated, evidence });
  } catch (error) { next(error); }
});

/**
 * Bank account numbers are masked for general users, but Purchasing
 * Coordinators and Accounting need the verified value to reconcile invoices,
 * correct extraction, and release payments. Keep the policy at the API
 * boundary so every permitted screen receives the same value and other roles
 * never receive the unmasked account number by accident.
 */
const serializeVendorBankFields = (vendor: any, role?: UserRole) => {
  const canViewFullBankDetails = Boolean(role && FULL_BANK_DETAIL_ROLES.includes(role));
  const purchasingOnly = role === UserRole.PURCHASING_COORDINATOR || role === UserRole.PURCHASING_MANAGER;
  return {
    ...vendor,
    bank_name: purchasingOnly ? undefined : vendor.bank_name,
    bank_address: purchasingOnly ? undefined : vendor.bank_address,
    swift_code: purchasingOnly ? undefined : (canViewFullBankDetails ? vendor.swift_code : undefined),
    swift_code_alt: purchasingOnly ? undefined : (canViewFullBankDetails ? vendor.swift_code_alt : undefined),
    account_number: purchasingOnly ? undefined : (canViewFullBankDetails ? vendor.account_number : maskBankAccount(vendor.account_number)),
    account_number_alt: purchasingOnly ? undefined : (canViewFullBankDetails
      ? vendor.account_number_alt
      : (vendor.account_number_alt || []).map(maskBankAccount)),
    iban: purchasingOnly ? undefined : (canViewFullBankDetails ? vendor.iban : maskBankAccount(vendor.iban)),
    sort_code: purchasingOnly ? undefined : vendor.sort_code,
    aba_routing_number: purchasingOnly ? undefined : vendor.aba_routing_number,
    intermediary_bank_name: purchasingOnly ? undefined : vendor.intermediary_bank_name,
    intermediary_bank_swift: purchasingOnly ? undefined : vendor.intermediary_bank_swift,
  };
};

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

router.post('/bank-change-requests/:id/approve', authorize(UserRole.ACCOUNTING_SUPERVISOR), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await approveVendorBankChange(req.params.id, req.user!.id, req.user!.name || 'Unknown');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/bank-change-requests/:id/reject', authorize(UserRole.ACCOUNTING_SUPERVISOR), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await rejectVendorBankChange(req.params.id, req.user!.id, req.user!.name || 'Unknown', req.body?.reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Bank Details Masterlist — must be before /:id
router.get('/bank-details/masterlist', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: Request, res: Response, next: NextFunction) => {
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

    const result = vendors.map(v => serializeVendorBankFields({
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
      // Keep these raw until serializeVendorBankFields applies the role-aware
      // mask exactly once. Double-masking here would make an authorized edit
      // round-trip save the masked value back over the real account number.
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
    }, (req as AuthRequest).user?.role));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Return the complete bank record for the edit form. The serializer applies
// the same role-aware masking policy as the masterlist, so authorized
// Accounting/Purchasing users can see the real account number instead of
// accidentally saving a masked display value back to the vendor.
router.get('/:id/bank-details', authorize(...FULL_BANK_DETAIL_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor) throw new AppError('Vendor not found', 404);
    res.json(serializeVendorBankFields(vendor, req.user?.role));
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isDbEnabled()) return res.json([]);
    const { search, limit } = req.query;
    const where: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { beneficiary_name: { contains: term, mode: 'insensitive' } },
        { name_aliases: { hasSome: [term] } },
      ];
    }
    const vendors = await prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit ? parseInt(limit as string) : undefined,
    });
    res.json(vendors.map(v => serializeVendorBankFields(v, (req as AuthRequest).user?.role)));
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
    res.json(serializeVendorBankFields(vendor, (req as AuthRequest).user?.role));
  } catch (error) {
    next(error);
  }
});

router.post('/', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
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

// Vendor deletion is permanent. It is deliberately blocked when dependent
// invoice or vendor-bill-stub records exist so accounting history cannot be
// deleted accidentally. Bank-change requests are allowed to cascade.
router.delete('/bulk', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids: string[] = Array.from(new Set(
      rawIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim())
    ));
    if (ids.length === 0) {
      throw new AppError('At least one vendor must be selected', 400);
    }

    const vendors = await prisma.vendor.findMany({
      where: { id: { in: ids }, is_active: true },
      select: {
        id: true,
        name: true,
        _count: { select: { invoices: true, vendor_bill_stubs: true } },
      },
    });
    if (vendors.length !== ids.length) {
      throw new AppError('One or more selected vendors were not found or are already deleted', 404);
    }

    const blocked = vendors.filter((vendor) => vendor._count.invoices > 0 || vendor._count.vendor_bill_stubs > 0);
    if (blocked.length > 0) {
      const details = blocked.map((vendor) => {
        const dependencies = [
          vendor._count.invoices > 0 ? `${vendor._count.invoices} invoice(s)` : '',
          vendor._count.vendor_bill_stubs > 0 ? `${vendor._count.vendor_bill_stubs} vendor bill stub(s)` : '',
        ].filter(Boolean).join(' and ');
        return `${vendor.name} (${dependencies})`;
      }).join('; ');
      return res.status(409).json({
        error: {
          message: `Permanent deletion is blocked for linked vendors: ${details}. Remove or reassign the dependent records first.`,
          status: 409,
        },
        blocked_vendors: blocked.map((vendor) => ({
          id: vendor.id,
          name: vendor.name,
          invoice_count: vendor._count.invoices,
          vendor_bill_stub_count: vendor._count.vendor_bill_stubs,
        })),
      });
    }

    const result = await prisma.vendor.deleteMany({ where: { id: { in: ids } } });
    res.json({ message: `${result.count} vendor(s) deleted permanently`, deleted_count: result.count });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        is_active: true,
        _count: { select: { invoices: true, vendor_bill_stubs: true } },
      },
    });
    if (!vendor) {
      throw new AppError('Vendor not found', 404);
    }
    if (!vendor.is_active) {
      return res.json({ message: 'Vendor is already deleted', deleted_count: 0 });
    }

    if (vendor._count.invoices > 0 || vendor._count.vendor_bill_stubs > 0) {
      const dependencies = [
        vendor._count.invoices > 0 ? `${vendor._count.invoices} invoice(s)` : '',
        vendor._count.vendor_bill_stubs > 0 ? `${vendor._count.vendor_bill_stubs} vendor bill stub(s)` : '',
      ].filter(Boolean).join(' and ');
      return res.status(409).json({
        error: {
          message: `Permanent deletion is blocked because ${vendor.name} has ${dependencies}. Remove or reassign the dependent records first.`,
          status: 409,
        },
      });
    }

    await prisma.vendor.delete({ where: { id: req.params.id } });
    res.json({ message: 'Vendor deleted permanently', deleted_count: 1 });
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

    // Accounting Associate is the maker, never the approver.  The generic
    // vendor PATCH endpoint used to bypass the persisted bank-change request
    // queue, so a second Associate could silently activate a bank change.
    if (userRole === UserRole.ACCOUNTING_ASSOCIATE && changedBankFields.length > 0) {
      return res.status(403).json({
        error: {
          message: 'Accounting Associate cannot directly apply bank changes. Submit a bank-change request for Accounting Supervisor approval.',
          status: 403,
        },
      });
    }

    // Guard against accidental alias erasure: a client that round-trips the
    // vendor object with an empty name_aliases field (e.g. a form that does
    // not display aliases) would otherwise wipe the OCR alias set and push
    // every subsequent intake back into VENDOR_NOT_FOUND. Clearing aliases
    // deliberately requires sending a non-empty replacement array.
    if (Array.isArray(updateData.name_aliases) && updateData.name_aliases.length === 0
        && Array.isArray(currentVendor.name_aliases) && currentVendor.name_aliases.length > 0) {
      delete updateData.name_aliases;
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

    const { name, beneficiary_name, bank_name, swift_code, account_number, iban, sort_code, aba_routing_number, bank_name_alt, bank_address, account_number_alt, swift_code_alt, intermediary_bank_name, intermediary_bank_swift, reason, phone_validation_confirmation, supporting_documents } = req.body;
    if (!reason || !reason.trim()) {
      throw new AppError('A reason for the bank update request is required', 400);
    }
    if (!String(phone_validation_confirmation || '').trim()) {
      throw new AppError('Purchasing phone-validation confirmation is required', 400);
    }
    const hasSupportingDocuments = Array.isArray(supporting_documents)
      ? supporting_documents.length > 0
      : typeof supporting_documents === 'string' ? supporting_documents.trim().length > 0 : Boolean(supporting_documents);
    if (!hasSupportingDocuments) {
      throw new AppError('At least one supporting document reference is required', 400);
    }

    const candidates = [
      { field: 'name', value: name },
      { field: 'beneficiary_name', value: beneficiary_name },
      { field: 'bank_name', value: bank_name },
      { field: 'swift_code', value: swift_code },
      { field: 'account_number', value: account_number },
      { field: 'iban', value: iban },
      { field: 'sort_code', value: sort_code },
      { field: 'aba_routing_number', value: aba_routing_number },
      { field: 'bank_name_alt', value: bank_name_alt },
      { field: 'bank_address', value: bank_address },
      { field: 'account_number_alt', value: account_number_alt },
      { field: 'swift_code_alt', value: swift_code_alt },
      { field: 'intermediary_bank_name', value: intermediary_bank_name },
      { field: 'intermediary_bank_swift', value: intermediary_bank_swift },
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
        { field: c.field, requested_value: Array.isArray(c.value) ? JSON.stringify(c.value) : String(c.value), reason, phone_validation_confirmation, supporting_documents },
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

// ─── BANK DETAILS UPDATE (new invoices only) ────────────────────────────────
// Update the vendor master used by new intake. Existing invoice records keep
// their confirmed bank-detail snapshots and are never overwritten here.
router.patch('/:id/bank-details', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendorId = req.params.id;
    const { name, beneficiary_name, bank_name, swift_code, account_number, bank_name_alt, bank_address, account_number_alt, swift_code_alt, iban, sort_code, aba_routing_number, intermediary_bank_name, intermediary_bank_swift } = req.body;

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) {
      throw new AppError('Vendor not found', 404);
    }

    let normalizedName: string | undefined;
    if (name !== undefined) {
      normalizedName = String(name ?? '').trim();
      if (!normalizedName) {
        throw new AppError('Vendor name is required', 400);
      }
      if (normalizeVendorName(normalizedName) !== normalizeVendorName(vendor.name)) {
        const dupes = await findDuplicateVendors(normalizedName, vendorId);
        if (dupes.length > 0) {
          return res.status(409).json({
            error: {
              message: `Duplicate vendor detected: "${dupes[0].name}" already exists (ID ${dupes[0].id}). Use the existing vendor or refine the name instead.`,
              status: 409,
            },
          });
        }
      }
    }

    const bankFieldChangesRequested = BANK_FIELDS.some((field) => req.body[field] !== undefined && field !== 'name' && field !== 'beneficiary_name');
    const masterChangeFields = ['name', 'beneficiary_name', ...BANK_FIELDS.filter((field) => !['name', 'beneficiary_name'].includes(field))];
    const masterChangeRequested = masterChangeFields.some((field) => req.body[field] !== undefined);

    // The Accounting Associate is the maker, not the approver. A submitted
    // edit becomes a persisted change request and cannot overwrite the active
    // Vendor Master version or connected invoice snapshots.
    if (req.user?.role === UserRole.ACCOUNTING_ASSOCIATE && masterChangeRequested) {
      const reason = String(req.body.reason || '').trim();
      const phoneValidation = String(req.body.phone_validation_confirmation || '').trim();
      if (!reason) throw new AppError('A reason for the vendor/bank change is required.', 400);
      if (!phoneValidation) throw new AppError('Purchasing phone-validation confirmation is required.', 400);
      const supportingDocuments = req.body.supporting_documents;
      const hasSupportingDocuments = Array.isArray(supportingDocuments)
        ? supportingDocuments.length > 0
        : typeof supportingDocuments === 'string' ? supportingDocuments.trim().length > 0 : Boolean(supportingDocuments);
      if (!hasSupportingDocuments) throw new AppError('At least one supporting document reference is required.', 400);
      const requested = masterChangeFields
        .filter((field) => req.body[field] !== undefined && String(req.body[field]) !== String((vendor as any)[field] ?? ''))
        .map((field) => ({ field, value: Array.isArray(req.body[field]) ? JSON.stringify(req.body[field]) : String(req.body[field]) }));
      const requests = [];
      for (const item of requested) {
        const result = await requestVendorBankUpdate(vendorId, {
          field: item.field,
          requested_value: item.value,
          reason,
          phone_validation_confirmation: phoneValidation,
          supporting_documents: req.body.supporting_documents,
        }, req.user!.id, req.user!.name || 'Accounting Associate', req.user!.role);
        requests.push(result.request);
      }
      return res.status(202).json({
        message: 'Vendor/bank change submitted for Accounting Supervisor approval. The active master record and invoice snapshots were not changed.',
        vendor_id: vendorId,
        status: 'PENDING_SUPERVISOR_APPROVAL',
        requests,
      });
    }

    // Bank changes are locked while any linked invoice is in active review/payment.
    // Accounting Associates must use the request/approval queue above; only an
    // authorized supervisor (or system administrator) can directly update the
    // Vendor Master, and this route never rewrites invoice snapshots.
    const activeInvoice = await prisma.invoice.findFirst({
      where: { vendor_id: vendorId, status: { in: ['PENDING_ACCOUNTING', 'APPROVED', 'PAYMENT_SCHEDULED', 'POSTED_TO_QB', 'PAYMENT_CONFIRMATION_SENT', 'PAID'] as any } },
      select: { invoice_number: true, status: true },
    });
    if (activeInvoice && bankFieldChangesRequested) {
      throw new AppError(`Bank details are locked while invoice ${activeInvoice.invoice_number} is ${activeInvoice.status}. Submit a bank-change request instead.`, 409);
    }

    // Phase 11: requester != approver — the user applying a bank change cannot
    // be the requester of an open request for the same vendor.
    const pendingOwnRequest = await prisma.vendorBankChangeRequest.findFirst({
      where: { vendor_id: vendorId, status: 'PENDING', requested_by_id: req.user!.id },
    });
    if (pendingOwnRequest && bankFieldChangesRequested) {
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
    if (normalizedName !== undefined) {
      vendorUpdate.name = normalizedName;
    }
    if (beneficiary_name !== undefined) {
      const normalizedBeneficiary = String(beneficiary_name ?? '').trim();
      vendorUpdate.beneficiary_name = normalizedBeneficiary || null;
    }
    const bankUpdateFields = { bank_name, swift_code, account_number, bank_name_alt, bank_address, account_number_alt, swift_code_alt, iban, sort_code, aba_routing_number, intermediary_bank_name, intermediary_bank_swift };
    for (const [key, value] of Object.entries(bankUpdateFields)) {
      if (value !== undefined) {
        vendorUpdate[key] = value;
      }
    }

    // Update only the vendor master. Existing invoice bank fields and their
    // immutable invoice/payment snapshots are deliberately not overwritten.
    await prisma.vendor.update({
      where: { id: vendorId },
      data: vendorUpdate,
    });
    if (bankFieldChangesRequested || Object.prototype.hasOwnProperty.call(vendorUpdate, 'beneficiary_name')) {
      await recordVendorBankVersion(vendorId, req.user!.id);
    }

    const invoicesUpdated = 0;

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
    const beneficiaryOnlyUpdate = changedFields.length === 1 && changedFields[0] === 'beneficiary_name';
    const vendorNameOnlyUpdate = changedFields.length === 1 && changedFields[0] === 'name';
    await prisma.auditLog.create({
      data: {
        action: vendorNameOnlyUpdate
          ? 'VENDOR_NAME_UPDATED'
          : changedFields.includes('beneficiary_name') && !changedFields.some((field) => BANK_FIELDS.includes(field))
          ? 'VENDOR_BENEFICIARY_UPDATED'
          : 'VENDOR_BANK_UPDATED',
        performed_by: req.user!.id,
        note: `Vendor "${normalizedName || vendor.name}" ${vendorNameOnlyUpdate ? 'vendor name' : beneficiaryOnlyUpdate ? 'beneficiary name' : 'bank details'} updated by ${req.user!.role}. Fields: ${changedFields.join(', ')}. Existing invoice bank snapshots were not changed.`,
      },
    }).catch(() => { /* audit log failure should not block the update */ });

    res.json({
      message: vendorNameOnlyUpdate
        ? `Vendor name updated to "${normalizedName}". Existing invoice bank snapshots were not changed.`
        : beneficiaryOnlyUpdate
        ? `Beneficiary name updated for vendor "${normalizedName || vendor.name}". Existing invoice bank snapshots were not changed.`
        : `Vendor bank details updated for "${normalizedName || vendor.name}". Existing invoice bank snapshots were not changed.`,
      vendor_id: vendorId,
      updated_fields: changedFields,
      invoices_updated: invoicesUpdated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
