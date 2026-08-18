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

const BANK_FIELDS = ['bank_name', 'swift_code', 'account_number', 'iban', 'sort_code', 'aba_routing_number', 'bank_name_alt', 'bank_address', 'account_number_alt', 'swift_code_alt', 'intermediary_bank_name', 'intermediary_bank_swift'];

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
  input: { field: string; current_value?: string; requested_value: string; reason: string },
  userId: string,
  userName: string,
  userRole?: string
) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  assertBankField(input.field);
  if (!input.reason || !input.reason.trim()) throw new AppError('A reason for the bank update request is required', 400);
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

  // Reuse alert BEFORE applying: the new account must not belong to another vendor.
  const reuse = await findBankAccountReuse(request.vendor_id, request.requested_value);
  if (reuse.length > 0) {
    await alertBankAccountReuse(request.vendor.name, request.requested_value, reuse, userId);
    throw new AppError(`Approval blocked: account is already used by: ${reuse.map(v => v.name).join(', ')}.`, 409);
  }

  await prisma.$transaction([
    prisma.vendor.update({
      where: { id: request.vendor_id },
      data: { [request.field]: request.requested_value, bank_verified_at: new Date(), updated_at: new Date() },
    }),
    prisma.vendorBankChangeRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', reviewed_by: userName, reviewed_at: new Date() },
    }),
  ]);

  await logAudit({
    performed_by: userId,
    action: 'VENDOR_BANK_UPDATE_APPROVED',
    note: `Vendor "${request.vendor.name}" bank change approved by ${userName}. Field: ${request.field}. New value: "${request.requested_value}"`,
    metadata: { vendor_id: request.vendor_id, request_id: requestId, field: request.field },
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
