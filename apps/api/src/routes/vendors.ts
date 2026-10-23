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
const MASTER_REQUEST_TYPES = ['NEW_VENDOR', 'BANK_UPDATE'] as const;
const MASTER_BANK_FIELDS = ['beneficiary_name', 'bank_name', 'swift_code', 'account_number', 'iban', 'sort_code', 'aba_routing_number', 'bank_name_alt', 'bank_address', 'account_number_alt', 'swift_code_alt', 'intermediary_bank_name', 'intermediary_bank_swift', 'has_multiple_accounts'];
const SYNCABLE_INVOICE_STATUSES = ['RECEIVED', 'VALIDATION_PENDING', 'EXCEPTION_FLAGGED', 'PENDING_COORDINATOR', 'PENDING_ACCOUNTING'] as any;

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
// Supporting documents uploaded during vendor onboarding. This deliberately
// uses the same multer/storage path as bank-change evidence, but persists the
// file metadata against the newly-created vendor instead of a change request.
router.post('/:id/vendor-documents', authorize(...FULL_BANK_DETAIL_ROLES), upload.array('files', 10), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const files = (req.files || []) as Express.Multer.File[];
    if (files.length === 0) throw new AppError('At least one supporting document file is required', 400);

    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!vendor) throw new AppError('Vendor not found', 404);

    const uploaded: Array<Record<string, string>> = [];
    const failed: Array<{ file_name: string; reason: string }> = [];
    for (const file of files) {
      const storagePath = await uploadToStorage(
        file.buffer,
        `vendor-documents/${vendor.id}/${crypto.randomUUID()}_${file.originalname}`,
        file.mimetype,
      );
      if (!storagePath) {
        failed.push({ file_name: file.originalname, reason: 'Evidence storage is unavailable' });
        continue;
      }

      const document = await prisma.vendorDocument.create({
        data: {
          vendor_id: vendor.id,
          file_name: file.originalname,
          storage_path: storagePath,
          mime_type: file.mimetype,
          sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
          uploaded_by: req.user!.id,
        },
      });
      uploaded.push({
        id: document.id,
        file_name: document.file_name,
        mime_type: document.mime_type,
        created_at: document.created_at.toISOString(),
      });
    }

    if (uploaded.length === 0) throw new AppError('Supporting document upload failed; no document was saved.', 503);

    await prisma.auditLog.create({
      data: {
        action: 'VENDOR_ONBOARDING_DOCUMENT_UPLOADED',
        performed_by: req.user!.id,
        note: `Supporting document${uploaded.length === 1 ? '' : 's'} uploaded for vendor "${vendor.name}" during onboarding.`,
        metadata: { vendor_id: vendor.id, documents: uploaded, failed },
      },
    }).catch(() => { /* evidence upload must not fail after the document is stored */ });

    res.status(failed.length > 0 ? 207 : 201).json({ vendor_id: vendor.id, documents: uploaded, failed });
  } catch (error) { next(error); }
});

router.get('/:id/vendor-documents', authorize(...FULL_BANK_DETAIL_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!vendor) throw new AppError('Vendor not found', 404);
    const documents = await prisma.vendorDocument.findMany({
      where: { vendor_id: vendor.id },
      orderBy: { created_at: 'desc' },
      select: { id: true, document_type: true, file_name: true, mime_type: true, created_at: true, uploaded_by: true },
    });
    res.json(documents);
  } catch (error) { next(error); }
});

// ─── VENDOR MASTER REQUEST WORKFLOW ────────────────────────────────────────
// Purchasing Coordinator submits; Accounting Associate independently approves
// or rejects. A request is only applied after approval, so the active vendor
// master and invoice routing cannot be changed by the requester.
router.post('/master-requests', authorize(UserRole.PURCHASING_COORDINATOR), upload.single('attachment'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const requestType = String(req.body.request_type || '').trim().toUpperCase();
    if (!MASTER_REQUEST_TYPES.includes(requestType as any)) {
      throw new AppError('request_type must be NEW_VENDOR or BANK_UPDATE', 400);
    }

    let proposedData: Record<string, any>;
    try {
      const raw = typeof req.body.proposed_data === 'string' ? JSON.parse(req.body.proposed_data) : req.body.proposed_data;
      proposedData = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      throw new AppError('proposed_data must be valid JSON', 400);
    }

    const reason = String(req.body.reason || '').trim();
    const attachment = (req as any).file as Express.Multer.File | undefined;
    const supportingDocuments = String(proposedData.supporting_documents || '').trim();
    if (!reason) throw new AppError('A reason is required for the vendor-master request', 400);
    if (!attachment && !supportingDocuments) throw new AppError('Attach a supporting document or provide a supporting document reference', 400);

    if (requestType === 'NEW_VENDOR') {
      proposedData.name = String(proposedData.name || '').trim();
      if (!proposedData.name) throw new AppError('Vendor name is required', 400);
    } else {
      const vendorId = String(proposedData.vendor_id || '').trim();
      if (!vendorId) throw new AppError('vendor_id is required for a bank update request', 400);
      const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
      if (!vendor) throw new AppError('Vendor not found', 404);
      const changed = MASTER_BANK_FIELDS.some((field) => proposedData[field] !== undefined);
      if (!changed) throw new AppError('At least one bank detail change is required', 400);
    }

    const request = await prisma.vendorMasterChangeRequest.create({
      data: {
        request_type: requestType,
        vendor_id: requestType === 'BANK_UPDATE' ? String(proposedData.vendor_id) : null,
        proposed_data: proposedData,
        reason,
        attachment_filename: attachment?.originalname || null,
        attachment_data: attachment?.buffer || null,
        attachment_mimetype: attachment?.mimetype || null,
        requested_by: req.user!.name || 'Unknown',
        requested_by_id: req.user!.id,
      },
    });

    res.status(201).json({
      id: request.id,
      request_type: request.request_type,
      status: request.status,
      message: 'Vendor-master request submitted to Accounting Associate for approval.',
    });
  } catch (error) { next(error); }
});

router.get('/master-requests', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where: any = {};
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.user?.role === UserRole.PURCHASING_COORDINATOR) where.requested_by_id = req.user.id;
    const requests = await prisma.vendorMasterChangeRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 200,
      include: { vendor: { select: { id: true, name: true } } },
    });
    res.json(requests.map((request: any) => ({
      id: request.id,
      request_type: request.request_type,
      vendor_id: request.vendor_id,
      vendor_name: request.vendor?.name || request.proposed_data?.name || 'New vendor',
      proposed_data: request.proposed_data,
      reason: request.reason,
      requested_by: request.requested_by,
      requested_by_id: request.requested_by_id,
      status: request.status,
      reviewed_by: request.reviewed_by,
      reviewed_at: request.reviewed_at,
      synced_invoice_count: request.synced_invoice_count,
      has_attachment: Boolean(request.attachment_data),
      attachment_filename: request.attachment_filename,
      created_at: request.created_at,
    })));
  } catch (error) { next(error); }
});

router.get('/master-requests/:requestId/attachment', authorize(UserRole.PURCHASING_COORDINATOR, UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.vendorMasterChangeRequest.findUnique({ where: { id: req.params.requestId }, select: { requested_by_id: true, attachment_filename: true, attachment_data: true, attachment_mimetype: true } });
    if (!request || !request.attachment_data) throw new AppError('Attachment not found', 404);
    if (req.user?.role === UserRole.PURCHASING_COORDINATOR && request.requested_by_id !== req.user.id) throw new AppError('Not authorized to view this attachment', 403);
    res.setHeader('Content-Type', request.attachment_mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${request.attachment_filename || 'vendor-request-attachment'}"`);
    res.send(request.attachment_data);
  } catch (error) { next(error); }
});

router.post('/master-requests/:requestId/approve', authorize(UserRole.ACCOUNTING_ASSOCIATE), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.vendorMasterChangeRequest.findUnique({ where: { id: req.params.requestId } });
    if (!request) throw new AppError('Vendor-master request not found', 404);
    if (request.status !== 'PENDING') throw new AppError(`Request already ${request.status}`, 400);
    if (request.requested_by_id && request.requested_by_id === req.user!.id) throw new AppError('The requester cannot approve their own vendor-master request', 403);

    const proposed = (request.proposed_data || {}) as Record<string, any>;
    const vendorId = request.vendor_id || null;
    let syncedInvoiceCount = 0;
    let createdVendor: any = null;

    if (request.request_type === 'NEW_VENDOR') {
      const vendorName = String(proposed.name || '').trim();
      if (!vendorName) throw new AppError('Vendor name is missing from the request', 400);
      const duplicates = await findDuplicateVendors(vendorName);
      if (duplicates.length > 0) throw new AppError(`Duplicate vendor detected: "${duplicates[0].name}" already exists.`, 409);

      const vendorData: any = {
        id: crypto.randomUUID(),
        name: vendorName,
        beneficiary_name: proposed.beneficiary_name ? String(proposed.beneficiary_name).trim() : null,
        supplier_location: proposed.supplier_location ? String(proposed.supplier_location).trim() : null,
        classification: proposed.classification ? String(proposed.classification).trim() : null,
        invoice_template_type: 'INVOICE' as any,
        bank_name: proposed.bank_name ? String(proposed.bank_name).trim() : null,
        swift_code: proposed.swift_code ? String(proposed.swift_code).trim() : null,
        account_number: proposed.account_number ? String(proposed.account_number).trim() : null,
        iban: proposed.iban ? String(proposed.iban).trim() : null,
        bank_address: proposed.bank_address ? String(proposed.bank_address).trim() : null,
        intermediary_bank_name: proposed.intermediary_bank_name ? String(proposed.intermediary_bank_name).trim() : null,
        intermediary_bank_swift: proposed.intermediary_bank_swift ? String(proposed.intermediary_bank_swift).trim() : null,
        has_multiple_accounts: Boolean(proposed.has_multiple_accounts),
        bank_name_alt: proposed.bank_name_alt ? [String(proposed.bank_name_alt).trim()] : [],
        swift_code_alt: proposed.swift_code_alt ? [String(proposed.swift_code_alt).trim()] : [],
        account_number_alt: proposed.account_number_alt ? [String(proposed.account_number_alt).trim()] : [],
        name_aliases: Array.isArray(proposed.name_aliases) ? proposed.name_aliases : [],
        is_active: true,
        onboarded_by: req.user!.id,
      };

      const unknownVendor = await prisma.vendor.findFirst({ where: { name: 'UNKNOWN VENDOR' }, select: { id: true } });
      createdVendor = await prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.create({ data: vendorData });
        const candidates = unknownVendor ? await tx.invoice.findMany({
          where: { vendor_id: unknownVendor.id, status: { in: SYNCABLE_INVOICE_STATUSES } },
          select: { id: true, vendor_name_raw: true },
        }) : [];
        const matchingIds = candidates.filter((invoice) => normalizeVendorName(invoice.vendor_name_raw) === normalizeVendorName(vendor.name)).map((invoice) => invoice.id);
        if (matchingIds.length > 0) {
          await tx.invoice.updateMany({
            where: { id: { in: matchingIds } },
            data: {
              vendor_id: vendor.id,
              beneficiary_name: vendor.beneficiary_name || undefined,
              bank_name: vendor.bank_name || undefined,
              swift_code: vendor.swift_code || undefined,
              account_number: vendor.account_number || undefined,
            },
          });
        }
        syncedInvoiceCount = matchingIds.length;
        await tx.vendorMasterChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', vendor_id: vendor.id, reviewed_by: req.user!.name || 'Accounting Associate', reviewed_by_id: req.user!.id, reviewed_at: new Date(), synced_invoice_count: syncedInvoiceCount },
        });
        return vendor;
      });

      if (request.attachment_data && createdVendor) {
        const storagePath = await uploadToStorage(request.attachment_data, `vendor-documents/${createdVendor.id}/${crypto.randomUUID()}_${request.attachment_filename || 'supporting-document'}`, request.attachment_mimetype || 'application/octet-stream');
        if (storagePath) {
          await prisma.vendorDocument.create({ data: { vendor_id: createdVendor.id, file_name: request.attachment_filename || 'supporting-document', storage_path: storagePath, mime_type: request.attachment_mimetype || 'application/octet-stream', sha256: crypto.createHash('sha256').update(request.attachment_data).digest('hex'), uploaded_by: request.requested_by_id || req.user!.id } });
        }
      }
      await prisma.auditLog.create({ data: { action: 'VENDOR_MASTER_REQUEST_APPROVED', performed_by: req.user!.id, note: `New vendor "${createdVendor.name}" approved by ${req.user!.name || 'Accounting Associate'}; ${syncedInvoiceCount} invoice(s) assigned.` } }).catch(() => {});
    } else {
      if (!request.vendor_id) throw new AppError('Bank update request has no vendor', 400);
      const vendorUpdate: Record<string, any> = {};
      for (const field of MASTER_BANK_FIELDS) {
        if (proposed[field] !== undefined) {
          if (['bank_name_alt', 'swift_code_alt', 'account_number_alt'].includes(field)) {
            vendorUpdate[field] = Array.isArray(proposed[field])
              ? proposed[field].map((value: unknown) => String(value).trim()).filter(Boolean)
              : String(proposed[field] || '').split(',').map((value) => value.trim()).filter(Boolean);
          } else if (field === 'has_multiple_accounts') {
            vendorUpdate[field] = Boolean(proposed[field]);
          } else {
            vendorUpdate[field] = proposed[field];
          }
        }
      }
      if (Object.keys(vendorUpdate).length === 0) throw new AppError('No bank detail changes found in request', 400);
      const syncData: Record<string, any> = {};
      for (const field of ['beneficiary_name', 'bank_name', 'swift_code', 'account_number']) {
        if (vendorUpdate[field] !== undefined) syncData[field] = vendorUpdate[field];
      }
      syncedInvoiceCount = await prisma.$transaction(async (tx) => {
        await tx.vendor.update({ where: { id: request.vendor_id! }, data: { ...vendorUpdate, bank_verified_at: new Date() } });
        const result = Object.keys(syncData).length > 0 ? await tx.invoice.updateMany({ where: { vendor_id: request.vendor_id!, status: { in: SYNCABLE_INVOICE_STATUSES } }, data: syncData }) : { count: 0 };
        await tx.vendorMasterChangeRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', reviewed_by: req.user!.name || 'Accounting Associate', reviewed_by_id: req.user!.id, reviewed_at: new Date(), synced_invoice_count: result.count } });
        return result.count;
      });
      await recordVendorBankVersion(request.vendor_id, req.user!.id);
      await prisma.auditLog.create({ data: { action: 'VENDOR_MASTER_REQUEST_APPROVED', performed_by: req.user!.id, note: `Bank details request approved for vendor ${request.vendor_id}; ${syncedInvoiceCount} invoice(s) synchronized.` } }).catch(() => {});
    }

    res.json({ success: true, status: 'APPROVED', vendor_id: vendorId || createdVendor?.id, synced_invoice_count: syncedInvoiceCount, message: `Request approved. ${syncedInvoiceCount} matching invoice(s) synchronized.` });
  } catch (error) { next(error); }
});

router.post('/master-requests/:requestId/reject', authorize(UserRole.ACCOUNTING_ASSOCIATE), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.vendorMasterChangeRequest.findUnique({ where: { id: req.params.requestId } });
    if (!request) throw new AppError('Vendor-master request not found', 404);
    if (request.status !== 'PENDING') throw new AppError(`Request already ${request.status}`, 400);
    if (request.requested_by_id && request.requested_by_id === req.user!.id) throw new AppError('The requester cannot reject their own vendor-master request', 403);
    await prisma.vendorMasterChangeRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', reviewed_by: req.user!.name || 'Accounting Associate', reviewed_by_id: req.user!.id, reviewed_at: new Date() } });
    await prisma.auditLog.create({ data: { action: 'VENDOR_MASTER_REQUEST_REJECTED', performed_by: req.user!.id, note: `Vendor-master request rejected by ${req.user!.name || 'Accounting Associate'}.${req.body?.reason ? ` Reason: ${String(req.body.reason).trim()}` : ''}` } }).catch(() => {});
    res.json({ success: true, status: 'REJECTED', message: 'Vendor-master request rejected.' });
  } catch (error) { next(error); }
});

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
