import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from './auditLogService';
import { inAppNotificationService } from './inAppNotificationService';
import { UserRole } from '@ap-invoice/shared';

const REQUESTABLE_STATUSES = new Set([
  'APPROVED',
  'PENDING_ACCOUNTING',
]);

function parseDueDate(value: unknown): Date {
  const date = new Date(String(value || ''));
  if (!value || Number.isNaN(date.getTime())) throw new AppError('A valid requested due date is required.', 400);
  date.setHours(23, 59, 59, 999);
  return date;
}

function ensureDateOrder(invoiceDate: Date | null, dueDate: Date) {
  if (invoiceDate && dueDate.getTime() < new Date(invoiceDate).setHours(0, 0, 0, 0)) {
    throw new AppError('Requested due date cannot be earlier than the invoice date.', 400);
  }
}

async function getInvoiceOrThrow(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { vendor: true } });
  if (!invoice) throw new AppError('Invoice not found', 404);
  return invoice;
}

export async function requestInvoiceDueDateChange(input: {
  invoiceId: string;
  requestedDueDate: unknown;
  reason: unknown;
  userId: string;
  userName: string;
}) {
  const invoice = await getInvoiceOrThrow(input.invoiceId);
  if (!REQUESTABLE_STATUSES.has(String(invoice.status))) {
    throw new AppError('Due-date changes can only be requested after Purchasing approval and before Accounting posting.', 409);
  }
  const requestedDueDate = parseDueDate(input.requestedDueDate);
  ensureDateOrder(invoice.invoice_date, requestedDueDate);
  const reason = String(input.reason || '').trim();
  if (!reason) throw new AppError('A reason for the due-date change is required.', 400);
  if (invoice.due_date && requestedDueDate.getTime() === new Date(invoice.due_date).getTime()) {
    throw new AppError('The requested due date is the same as the current due date.', 400);
  }

  const existing = await prisma.invoiceDueDateChangeRequest.findFirst({
    where: { invoice_id: invoice.id, status: 'PENDING' },
    orderBy: { created_at: 'desc' },
  });
  if (existing) throw new AppError('A due-date change request is already pending for this invoice.', 409);

  const request = await prisma.invoiceDueDateChangeRequest.create({
    data: {
      invoice_id: invoice.id,
      current_due_date: invoice.due_date,
      requested_due_date: requestedDueDate,
      reason,
      requested_by: input.userName,
      requested_by_id: input.userId,
      status: 'PENDING',
    },
  });

  await logAudit({
    invoice_id: invoice.id,
    performed_by: input.userId,
    actor_role: UserRole.PURCHASING_COORDINATOR,
    action: 'INVOICE_DUE_DATE_CHANGE_REQUESTED',
    note: `Due date change requested by ${input.userName}: ${invoice.due_date?.toISOString().slice(0, 10) || '—'} → ${requestedDueDate.toISOString().slice(0, 10)}. Reason: ${reason}`,
    metadata: { request_id: request.id, current_due_date: invoice.due_date, requested_due_date: requestedDueDate },
  });
  await inAppNotificationService.create({
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    vendor_name: invoice.vendor?.name || invoice.vendor_name_raw || 'Unknown',
    title: 'Invoice Due-Date Change Request',
    message: `${input.userName} requested due date ${requestedDueDate.toISOString().slice(0, 10)} for invoice ${invoice.invoice_number}. Reason: ${reason}`,
    type: 'warning',
    category: 'approval',
    target_role: UserRole.ACCOUNTING_ASSOCIATE,
  });
  return request;
}

export async function listInvoiceDueDateChangeRequests(status?: string) {
  return prisma.invoiceDueDateChangeRequest.findMany({
    where: status ? { status } : undefined,
    include: { invoice: { include: { vendor: true } } },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
}

export async function listInvoiceDueDateChangeRequestsForInvoice(invoiceId: string) {
  await getInvoiceOrThrow(invoiceId);
  return prisma.invoiceDueDateChangeRequest.findMany({ where: { invoice_id: invoiceId }, orderBy: { created_at: 'desc' } });
}

export async function approveInvoiceDueDateChange(requestId: string, userId: string, userName: string) {
  const request = await prisma.invoiceDueDateChangeRequest.findUnique({ where: { id: requestId }, include: { invoice: { include: { vendor: true } } } });
  if (!request) throw new AppError('Due-date change request not found', 404);
  if (request.status !== 'PENDING') throw new AppError(`Request already ${request.status}`, 400);
  if (request.requested_by_id && request.requested_by_id === userId) throw new AppError('The requester cannot approve their own due-date change request.', 403);
  if (!REQUESTABLE_STATUSES.has(String(request.invoice.status))) throw new AppError('This invoice has already moved beyond the due-date change window.', 409);
  const activePayment = await prisma.payment.findFirst({ where: { invoice_id: request.invoice_id, status: { notIn: ['CANCELLED', 'VOIDED'] } }, select: { id: true } });
  if (activePayment) throw new AppError('The invoice already has an active payment and its due date cannot be changed.', 409);

  await prisma.$transaction([
    prisma.invoice.update({ where: { id: request.invoice_id }, data: { due_date: request.requested_due_date } }),
    prisma.invoiceDueDateChangeRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', reviewed_by: userName, reviewed_by_id: userId, reviewed_at: new Date() } }),
  ]);
  await logAudit({ invoice_id: request.invoice_id, performed_by: userId, actor_role: UserRole.ACCOUNTING_ASSOCIATE, action: 'INVOICE_DUE_DATE_CHANGE_APPROVED', note: `Due date changed by ${userName}: ${request.current_due_date?.toISOString().slice(0, 10) || '—'} → ${request.requested_due_date.toISOString().slice(0, 10)}.`, metadata: { request_id: request.id } });
  return { success: true, message: `Due date updated to ${request.requested_due_date.toISOString().slice(0, 10)}.` };
}

export async function rejectInvoiceDueDateChange(requestId: string, userId: string, userName: string, reason?: string) {
  const request = await prisma.invoiceDueDateChangeRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new AppError('Due-date change request not found', 404);
  if (request.status !== 'PENDING') throw new AppError(`Request already ${request.status}`, 400);
  await prisma.invoiceDueDateChangeRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', reviewed_by: userName, reviewed_by_id: userId, reviewed_at: new Date() } });
  await logAudit({ invoice_id: request.invoice_id, performed_by: userId, actor_role: UserRole.ACCOUNTING_ASSOCIATE, action: 'INVOICE_DUE_DATE_CHANGE_REJECTED', note: `Due-date change rejected by ${userName}.${reason ? ` Reason: ${reason}` : ''}`, metadata: { request_id: request.id } });
  return { success: true, message: 'Due-date change request rejected.' };
}
