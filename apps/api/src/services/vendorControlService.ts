import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { bankAccountFingerprint, maskBankAccount } from '../utils/sensitiveData';
import { inAppNotificationService } from './inAppNotificationService';
import { logAudit } from './auditLogService';
import { UserRole } from '@ap-invoice/shared';

/**
 * Phase 11 vendor-master controls:
 * - duplicate vendor check on create/rename
 * - critical bank-account-reuse alert on create/apply
 * - requester != approver on every vendor bank change (persisted request queue)
 */

const BANK_FIELDS = ['name', 'beneficiary_name', 'bank_name', 'swift_code', 'account_number', 'iban', 'sort_code', 'aba_routing_number', 'bank_name_alt', 'bank_address', 'account_number_alt', 'swift_code_alt', 'intermediary_bank_name', 'intermediary_bank_swift', 'has_multiple_accounts'];

/** Normalize bank-change evidence into auditable structured references. */
export function normalizeSupportingDocuments(value: unknown): Array<Record<string, unknown>> {
  const entries = Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value.trim()] : [];
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      return { reference: entry.trim(), source: 'MANUAL_REFERENCE' };
    }
    if (!entry || typeof entry !== 'object') {
      throw new AppError('Each supporting document must be a file/reference object.', 400);
    }
    const item = entry as Record<string, unknown>;
    const reference = item.storage_path || item.url || item.reference || item.file_name || item.name;
    if (!reference) throw new AppError('Each supporting document must include a reference or storage path.', 400);
    return {
      file_name: item.file_name || item.name || null,
      storage_path: item.storage_path || item.url || null,
      reference: String(reference),
      sha256: item.sha256 || item.hash || null,
      uploaded_at: item.uploaded_at || new Date().toISOString(),
      source: item.source || 'BANK_CHANGE_EVIDENCE',
    };
  });
}

export async function recordVendorBankVersion(vendorId: string, actorId?: string, sourceRequestId?: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return null;
  const latest = await prisma.vendorBankVersion.findFirst({ where: { vendor_id: vendorId }, orderBy: { version: 'desc' }, select: { version: true } });
  await prisma.vendorBankVersion.updateMany({ where: { vendor_id: vendorId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
  return prisma.vendorBankVersion.create({
    data: {
      vendor_id: vendorId,
      version: (latest?.version || 0) + 1,
      status: 'ACTIVE',
      beneficiary_name: vendor.beneficiary_name,
      bank_name: vendor.bank_name,
      bank_address: vendor.bank_address,
      account_number: vendor.account_number,
      swift_code: vendor.swift_code,
      iban: vendor.iban,
      sort_code: vendor.sort_code,
      aba_routing_number: vendor.aba_routing_number,
      intermediary_bank_name: vendor.intermediary_bank_name,
      intermediary_bank_swift: vendor.intermediary_bank_swift,
      approved_by: actorId || null,
      approval_timestamp: actorId ? new Date() : null,
      source_request_id: sourceRequestId || null,
    },
  });
}

export function normalizeVendorName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Active vendors whose normalized name equals the input (case/space-insensitive). */
export async function findDuplicateVendors(name: string, excludeId?: string) {
  const normalized = normalizeVendorName(name);
  if (!normalized) return [];
  const candidates = await prisma.vendor.findMany({
    where: { is_active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true },
  });
  return candidates.filter(v => normalizeVendorName(v.name) === normalized);
}

/** Active vendors (other than vendorId) whose account number matches the input, including alt accounts. */
export async function findBankAccountReuse(vendorId: string | undefined, accountNumber?: string | null) {
  const fingerprint = bankAccountFingerprint(accountNumber);
  if (!fingerprint) return [];
  const vendors = await prisma.vendor.findMany({
    where: { is_active: true, ...(vendorId ? { id: { not: vendorId } } : {}) },
    select: { id: true, name: true, account_number: true, account_number_alt: true },
  });
  return vendors.filter(v =>
    bankAccountFingerprint(v.account_number) === fingerprint ||
    (v.account_number_alt || []).some(a => bankAccountFingerprint(a) === fingerprint)
  );
}

/** Raise a CRITICAL in-app alert + audit row when a bank account would be reused across vendors. */
export async function alertBankAccountReuse(vendorName: string, accountNumber: string | null | undefined, matches: { id: string; name: string }[], actorId?: string) {
  if (matches.length === 0) return;
  const masked = maskBankAccount(accountNumber) || '—';
  const detail = `Masked account ${masked} is assigned to vendor "${vendorName}" and is already used by: ${matches.map(v => v.name).join(', ')}.`;
  await inAppNotificationService.create({
    vendor_name: vendorName,
    title: 'Critical: Bank Account Reuse Detected',
    message: detail,
    type: 'error',
    category: 'exception',
    target_role: UserRole.ACCOUNTING_SUPERVISOR as any,
  });
  await inAppNotificationService.create({
    vendor_name: vendorName,
    title: 'Critical: Bank Account Reuse Detected',
    message: detail,
    type: 'error',
    category: 'exception',
    target_role: UserRole.ACCOUNTING_ASSOCIATE as any,
  });
  await logAudit({
    performed_by: actorId || 'system',
    action: 'BANK_ACCOUNT_REUSE_ALERT',
    note: detail,
    metadata: { vendor_name: vendorName, masked_account: masked, matches: matches.map(v => v.name) },
  }).catch(() => {});
}

/** Validate that a requested bank field is one of the allowed vendor bank fields. */
export function assertBankField(field: string) {
  if (!BANK_FIELDS.includes(field)) {
    throw new AppError(`Invalid bank field: ${field}. Allowed: ${BANK_FIELDS.join(', ')}`, 400);
  }
}

/**
 * Persist a vendor-master bank change request. The requester can never approve
 * it themselves — approveVendorBankChange / rejectVendorBankChange enforce
 * requester != approver.
 */
export async function requestVendorBankUpdate(
  vendorId: string,
  input: { field: string; current_value?: string; requested_value: string; reason: string; phone_validation_confirmation?: string; supporting_documents?: unknown },
  userId: string,
  userName: string,
  userRole?: string
) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  assertBankField(input.field);
  if (!input.reason || !input.reason.trim()) throw new AppError('A reason for the bank update request is required', 400);
  if (userRole === UserRole.ACCOUNTING_ASSOCIATE) {
    if (!input.phone_validation_confirmation?.trim()) {
      throw new AppError('Purchasing phone-validation confirmation is required.', 400);
    }
    const documents = normalizeSupportingDocuments(input.supporting_documents);
    if (documents.length === 0) {
      throw new AppError('At least one supporting document reference is required for a bank change.', 400);
    }
    input.supporting_documents = documents;
  }
  const current = String((vendor as any)[input.field] ?? '');
  if (current === String(input.requested_value ?? '')) {
    throw new AppError(`No change detected: ${input.field} is already "${current || 'empty'}"`, 400);
  }

  const request = await prisma.vendorBankChangeRequest.create({
    data: {
      vendor_id: vendorId,
      field: input.field,
      current_value: input.current_value ?? (current || null),
      requested_value: input.requested_value,
      reason: input.reason.trim(),
      phone_validation_confirmation: input.phone_validation_confirmation?.trim() || null,
      supporting_documents: normalizeSupportingDocuments(input.supporting_documents) as any,
      requested_by: userName,
      requested_by_id: userId,
      status: 'PENDING',
    },
  });

  await logAudit({
    performed_by: userId,
    action: 'VENDOR_BANK_UPDATE_REQUESTED',
    note: `Vendor "${vendor.name}" bank change requested by ${userName}. Field: ${input.field}. Current: "${current || '—'}" → Requested: "${input.requested_value}". Reason: ${input.reason.trim()}`,
    metadata: { vendor_id: vendorId, request_id: request.id, field: input.field },
  }).catch(() => {});

  await inAppNotificationService.create({
    vendor_name: vendor.name,
    title: 'Bank Info Update Request',
    message: `${userName}${userRole ? ` (${userRole})` : ''} requested a bank update for vendor "${vendor.name}".\nField: ${input.field}\nCurrent: "${current || '—'}" → "${input.requested_value}"\nReason: ${input.reason.trim()}`,
    type: 'warning',
    category: 'stage',
    target_role: UserRole.ACCOUNTING_SUPERVISOR as any,
  });
  await inAppNotificationService.create({
    vendor_name: vendor.name,
    title: 'Bank Info Update Request',
    message: `${userName} requested a bank update for vendor "${vendor.name}".\nField: ${input.field}\nCurrent: "${current || '—'}" → "${input.requested_value}"\nReason: ${input.reason.trim()}`,
    type: 'warning',
    category: 'stage',
    target_role: UserRole.ACCOUNTING_ASSOCIATE as any,
  });

  return {
    success: true,
    message: 'Bank update request submitted. Accounting has been notified.',
    request: {
      id: request.id,
      vendor_id: vendorId,
      vendor_name: vendor.name,
      field: input.field,
      current_value: input.current_value ?? (current || null),
      requested_value: input.requested_value,
      requested_by: userName,
      status: request.status,
    },
  };
}

export async function listVendorBankChangeRequests(status?: string) {
  const requests = await prisma.vendorBankChangeRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { created_at: 'desc' },
    take: 100,
    include: { vendor: { select: { id: true, name: true } } },
  });
  return requests.map(r => ({
    id: r.id,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor?.name || 'Unknown',
    field: r.field,
    current_value: r.current_value,
    requested_value: r.requested_value,
    reason: r.reason,
    requested_by: r.requested_by,
    phone_validation_confirmation: r.phone_validation_confirmation,
    supporting_documents: r.supporting_documents,
    status: r.status,
    reviewed_by: r.reviewed_by,
    reviewed_at: r.reviewed_at,
    created_at: r.created_at,
  }));
}

export async function approveVendorBankChange(requestId: string, userId: string, userName: string) {
  const request = await prisma.vendorBankChangeRequest.findUnique({
    where: { id: requestId },
    include: { vendor: true },
  });
  if (!request) throw new AppError('Bank change request not found', 404);
  if (request.status !== 'PENDING') throw new AppError(`Request already ${request.status}`, 400);
  if (request.requested_by_id && request.requested_by_id === userId) {
    throw new AppError('Bank change requester cannot approve their own request', 403);
  }

  const arrayFields = new Set(['bank_name_alt', 'account_number_alt', 'swift_code_alt']);
  const approvedValue: any = arrayFields.has(request.field)
    ? (() => { try { return JSON.parse(request.requested_value); } catch { return [request.requested_value]; } })()
    : request.requested_value;

  // Reuse alert BEFORE applying: the new account must not belong to another vendor.
  if (request.field === 'account_number') {
    const reuse = await findBankAccountReuse(request.vendor_id, request.requested_value);
    if (reuse.length > 0) {
      await alertBankAccountReuse(request.vendor.name, request.requested_value, reuse, userId);
      throw new AppError(`Approval blocked: account is already used by: ${reuse.map(v => v.name).join(', ')}.`, 409);
    }
  }

  await prisma.$transaction([
    prisma.vendor.update({
      where: { id: request.vendor_id },
      data: { [request.field]: approvedValue, bank_verified_at: new Date(), updated_at: new Date() },
    }),
    prisma.vendorBankChangeRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', reviewed_by: userName, reviewed_at: new Date() },
    }),
  ]);
  await recordVendorBankVersion(request.vendor_id, userId, requestId);

  // A newly approved master version must not rewrite invoice snapshots. Open
  // invoices are explicitly reassessed instead so Accounting can confirm the
  // correct version before posting or payment selection.
  // Keep the reassessment step isolated from the approval transaction.  This
  // also lets lightweight service/unit-test Prisma doubles omit the optional
  // invoice model while the production client always executes it.
  const openReassessment = typeof (prisma as any).invoice?.updateMany === 'function'
    ? await (prisma as any).invoice.updateMany({
      where: {
        vendor_id: request.vendor_id,
        status: { notIn: ['PAID', 'CANCELLED', 'REJECTED'] as any },
      },
      data: { bank_match_status: 'PENDING_VENDOR_CHANGE_REVIEW' },
    })
    : { count: 0 };

  await logAudit({
    performed_by: userId,
    action: 'VENDOR_BANK_UPDATE_APPROVED',
    note: `Vendor "${request.vendor.name}" bank change approved by ${userName}. Field: ${request.field}. New value: "${request.requested_value}"`,
    metadata: {
      vendor_id: request.vendor_id,
      request_id: requestId,
      field: request.field,
      before_value: request.current_value,
      after_value: approvedValue,
      phone_validation_confirmation: request.phone_validation_confirmation,
      supporting_documents: request.supporting_documents,
      active_invoice_snapshots_unchanged: true,
      open_invoices_reassessed: openReassessment.count,
    },
  }).catch(() => {});

  return { success: true, message: `Bank change approved and applied to vendor "${request.vendor.name}".` };
}

export async function rejectVendorBankChange(requestId: string, userId: string, userName: string, reason?: string) {
  const request = await prisma.vendorBankChangeRequest.findUnique({ where: { id: requestId }, include: { vendor: true } });
  if (!request) throw new AppError('Bank change request not found', 404);
  if (request.status !== 'PENDING') throw new AppError(`Request already ${request.status}`, 400);
  if (request.requested_by_id && request.requested_by_id === userId) {
    throw new AppError('Bank change requester cannot review their own request', 403);
  }

  await prisma.vendorBankChangeRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED', reviewed_by: userName, reviewed_at: new Date() },
  });

  await logAudit({
    performed_by: userId,
    action: 'VENDOR_BANK_UPDATE_REJECTED',
    note: `Vendor "${request.vendor.name}" bank change rejected by ${userName}.${reason ? ` Reason: ${reason}` : ''}`,
    metadata: { vendor_id: request.vendor_id, request_id: requestId },
  }).catch(() => {});

  return { success: true, message: 'Bank change request rejected.' };
}

export { BANK_FIELDS };
