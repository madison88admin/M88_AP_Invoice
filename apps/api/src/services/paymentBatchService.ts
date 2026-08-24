import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PaymentBatchStatus, InvoiceStatus, UserRole } from '@ap-invoice/shared';
import { PaymentExecutionInput, processPayment } from './postingService';
import { inAppNotificationService } from './inAppNotificationService';
import { logger } from '../utils/logger';
import { getApprovalReadiness } from './approvalReadinessService';

/**
 * Get the next Wednesday date from a given date
 */
function getNextWednesday(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (3 - day + 7) % 7; // 3 is Wednesday
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Check if today is Wednesday
 */
function isWednesday(date: Date = new Date()): boolean {
  return date.getDay() === 3; // 3 is Wednesday
}

/**
 * Get payments scheduled for the next Wednesday that have been selected by Accounting Associate
 */
export async function getPaymentsForNextWednesday() {
  const nextWednesday = getNextWednesday();
  const startOfDay = new Date(nextWednesday);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(nextWednesday);
  endOfDay.setHours(23, 59, 59, 999);

  const payments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
      payment_date: {
        gte: startOfDay,
        lte: endOfDay,
      },
      batch_id: null, // Not already in a batch
      selected_for_batch: true,
    },
    include: {
      invoice: {
        include: {
          vendor: true,
          invoice_lines: true,
        },
      },
    },
    orderBy: {
      payment_date: 'asc',
    },
  });

  return payments;
}

/**
 * Get scheduled payments available for batch selection
 */
export interface ScheduledPaymentFilters {
  vendorId?: string;
  currency?: string;
  dateFrom?: string; // payment_date range (existing)
  dateTo?: string;
  search?: string;
  // New filters
  dueMonth?: string; // 'YYYY-MM' — invoices due within that month (cut-off view)
  dueFrom?: string; // due_date range
  dueTo?: string;
  invoiceDateFrom?: string; // invoice_date range
  invoiceDateTo?: string;
  approvalFrom?: string; // manager approval date range (signatures.signed_at)
  approvalTo?: string;
  brand?: string;
  memo?: string; // qb_memo contains
  category?: string; // split/account e.g. TRIMS, YARN, SAMPLE_CHARGES
  aging?: string; // 'not-due' | '0-30' | '31-60' | '60+'
  status?: string; // explicit status view: 'FOR_PAYMENT' (supervisor queue), 'SCHEDULED', 'APPROVED_FOR_PAYMENT'
}

export async function getScheduledPaymentsForBatch(filters: ScheduledPaymentFilters = {}) {
  // No implicit payment-date bound: since payments auto-schedule on posting
  // with payment_date = invoice due date, past-due (overdue) invoices must
  // remain visible in the batch list. Only explicit dateFrom/dateTo bound it.
  const paymentDate: any = filters.dateFrom
    ? { gte: new Date(filters.dateFrom) }
    : {};
  if (filters.dateTo) paymentDate.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);

  // Due-date range: explicit dueFrom/dueTo, or the due-month cut-off (YYYY-MM)
  let dueDateRange: { gte?: Date; lte?: Date } = {};
  if (filters.dueFrom) dueDateRange.gte = new Date(filters.dueFrom);
  if (filters.dueTo) dueDateRange.lte = new Date(`${filters.dueTo}T23:59:59.999Z`);
  if (filters.dueMonth && /^\d{4}-\d{2}$/.test(filters.dueMonth)) {
    const [year, month] = filters.dueMonth.split('-').map(Number);
    dueDateRange = {
      gte: new Date(Date.UTC(year, month - 1, 1)),
      lte: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
  }
  const hasDueFilter = !!(filters.dueFrom || filters.dueTo || filters.dueMonth);

  let invoiceDateRange: { gte?: Date; lte?: Date } = {};
  if (filters.invoiceDateFrom) invoiceDateRange.gte = new Date(filters.invoiceDateFrom);
  if (filters.invoiceDateTo) invoiceDateRange.lte = new Date(`${filters.invoiceDateTo}T23:59:59.999Z`);

  let approvalRange: { gte?: Date; lte?: Date } = {};
  if (filters.approvalFrom) approvalRange.gte = new Date(filters.approvalFrom);
  if (filters.approvalTo) approvalRange.lte = new Date(`${filters.approvalTo}T23:59:59.999Z`);

  // Default view: batchable payments (SCHEDULED + supervisor-approved) PLUS
  // HELD_BELOW_100 payments whose due date falls within the applied cut-off
  // window (due-month / due-range) — the "appears when it falls within the
  // Associate's cut-off, on or before the due date" rule. An explicit status
  // filter switches the view (e.g. FOR_PAYMENT queue, HELD_BELOW_100 queue).
  const defaultStatuses = { in: ['SCHEDULED', 'APPROVED_FOR_PAYMENT'] };

  // Non-status filters are shared by every branch; the status OR must live at
  // the TOP level of `where` — `status: { OR: [...] }` containing nested
  // `status` filters is invalid Prisma and 500s the cut-off view.
  const baseWhere: any = {
    batch_id: null,
    payment_date: paymentDate,
    ...(filters.currency ? { currency: filters.currency } : {}),
    invoice: {
      ...(filters.vendorId ? { vendor_id: filters.vendorId } : {}),
      ...(filters.search ? {
        OR: [
          { invoice_number: { contains: filters.search, mode: 'insensitive' as const } },
          { mpo_number: { contains: filters.search, mode: 'insensitive' as const } },
          { material_code: { contains: filters.search, mode: 'insensitive' as const } },
          { brand: { contains: filters.search, mode: 'insensitive' as const } },
          { qb_memo: { contains: filters.search, mode: 'insensitive' as const } },
          { vendor: { name: { contains: filters.search, mode: 'insensitive' as const } } },
        ],
      } : {}),
      ...(filters.brand ? { brand: { contains: filters.brand, mode: 'insensitive' as const } } : {}),
      ...(filters.memo ? { qb_memo: { contains: filters.memo, mode: 'insensitive' as const } } : {}),
      ...(filters.category ? { category: filters.category as any } : {}),
      ...(hasDueFilter ? { due_date: dueDateRange } : {}),
      ...(filters.invoiceDateFrom || filters.invoiceDateTo ? { invoice_date: invoiceDateRange } : {}),
      ...(filters.approvalFrom || filters.approvalTo ? {
        signatures: {
          some: {
            signatory_role: 'PURCHASING_MANAGER' as any,
            signed_at: approvalRange,
          },
        },
      } : {}),
    },
  };

  // Status: an explicit status filter wins; otherwise the default batchable
  // view PLUS HELD_BELOW_100 payments whose due date falls within the applied
  // cut-off window (due-month / due-range).
  const where = filters.status
    ? { ...baseWhere, status: filters.status }
    : hasDueFilter
      ? {
          ...baseWhere,
          OR: [
            { status: defaultStatuses },
            { status: 'HELD_BELOW_100', invoice: { due_date: dueDateRange } },
          ],
        }
      : { ...baseWhere, status: defaultStatuses };

  const payments = await prisma.payment.findMany({
    where,
    include: {
      invoice: {
        include: {
          vendor: true,
          signatures: {
            where: {
              signatory_role: 'PURCHASING_MANAGER' as any,
              signed_at: { not: null },
            },
            select: { signed_at: true },
            orderBy: { signed_at: 'desc' as const },
            take: 1,
          },
        },
      },
    },
    orderBy: {
      payment_date: 'asc',
    },
  });

  // Enrich with derived fields (invoice date, due date, brand, memo, category,
  // manager approval date, aging days, open balance)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const DAY_MS = 86400000;

  let enriched = payments.map((payment: any) => {
    const due = payment.invoice?.due_date ? new Date(payment.invoice.due_date) : null;
    let agingDays: number | null = null;
    if (due && !isNaN(due.getTime())) {
      const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      agingDays = Math.floor((startOfToday.getTime() - dueStart.getTime()) / DAY_MS); // >0 = overdue days
    }
    const { signatures, ...invoiceRest } = payment.invoice || {};
    return {
      ...payment,
      invoice: invoiceRest,
      invoice_date: payment.invoice?.invoice_date || null,
      due_date: payment.invoice?.due_date || null,
      brand: payment.invoice?.brand || null,
      category: payment.invoice?.category || null,
      qb_memo: payment.invoice?.qb_memo || null,
      approval_date: signatures?.[0]?.signed_at || null,
      aging_days: agingDays,
      open_balance: Number(payment.amount || 0),
      remarks: payment.remarks || null,
      // How the payment date was set — stored explicitly on the record
      // (DUE_DATE / MANUAL / DEFAULT), not inferred from date equality.
      payment_date_source: payment.payment_date_source || 'DUE_DATE',
      // True only when the payment date came from the invoice due date.
      payment_date_from_due: payment.payment_date_source === 'DUE_DATE',
    };
  });

  // Supervisor action notes (FOR_PAYMENT approve/reject) — latest audit entry per invoice
  const noteInvoiceIds = enriched.map((p: any) => p.invoice?.id).filter(Boolean);
  const supervisorNotes = new Map<string, { action: string; note: string }>();
  if (noteInvoiceIds.length > 0) {
    const auditRows = await prisma.auditLog.findMany({
      where: {
        invoice_id: { in: noteInvoiceIds },
        action: { in: ['FOR_PAYMENT_APPROVED', 'FOR_PAYMENT_REJECTED'] },
      },
      orderBy: { created_at: 'desc' },
      select: { invoice_id: true, action: true, note: true },
    });
    for (const row of auditRows) {
      if (row.invoice_id && !supervisorNotes.has(row.invoice_id)) {
        supervisorNotes.set(row.invoice_id, { action: row.action, note: row.note || '' });
      }
    }
  }
  enriched = enriched.map((p: any) => ({
    ...p,
    supervisor_action: p.invoice?.id ? supervisorNotes.get(p.invoice.id)?.action || null : null,
    supervisor_note: p.invoice?.id ? supervisorNotes.get(p.invoice.id)?.note || null : null,
  }));

  // Aging filter (derived) applied in memory
  let filtered = enriched;
  if (filters.aging) {
    filtered = enriched.filter((p: any) => {
      const days = p.aging_days;
      if (filters.aging === 'overdue') return days !== null && days > 0;
      if (filters.aging === 'not-due') return days !== null && days < 0;
      if (filters.aging === '0-30') return days !== null && days >= 0 && days <= 30;
      if (filters.aging === '31-60') return days !== null && days > 30 && days <= 60;
      if (filters.aging === '60+') return days !== null && days > 60;
      return true;
    });
  }

  // Filtered totals per currency (only the filtered rows)
  const totalsMap = new Map<string, { count: number; total: number }>();
  for (const p of filtered as any[]) {
    const cur = p.currency || 'USD';
    const entry = totalsMap.get(cur) || { count: 0, total: 0 };
    entry.count += 1;
    entry.total += Number(p.amount || 0);
    totalsMap.set(cur, entry);
  }
  const totals = Array.from(totalsMap.entries()).map(([currency, t]) => ({
    currency,
    count: t.count,
    total: Math.round(t.total * 100) / 100,
  }));

  return {
    payments: filtered,
    filtered_count: filtered.length,
    totals,
  };
}

/**
 * Select payments for batch creation by Accounting Associate
 */
export async function selectPaymentsForBatch(paymentIds: string[], userId: string) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new AppError('Select at least one scheduled payment', 400);
  }

  const payments = await prisma.payment.findMany({
    where: {
      id: { in: paymentIds },
      status: { in: ['SCHEDULED', 'APPROVED_FOR_PAYMENT'] },
      batch_id: null,
      OR: [
        { selected_for_batch: false },
        { selected_by: null },
        { selected_by: userId },
      ],
    },
  });

  if (payments.length !== paymentIds.length) {
    throw new AppError('Some payments are not found, already in a batch, or not in SCHEDULED status', 400);
  }

  await prisma.payment.updateMany({
    where: { id: { in: paymentIds } },
    data: {
      selected_for_batch: true,
      selected_by: userId,
      selected_at: new Date(),
    },
  });

  return { selected: paymentIds.length };
}

/**
 * Deselect payments for batch creation
 */
export async function deselectPaymentsForBatch(paymentIds: string[], userId: string) {
  await prisma.payment.updateMany({
    where: {
      id: { in: paymentIds },
      selected_for_batch: true,
      selected_by: userId,
      batch_id: null,
    },
    data: {
      selected_for_batch: false,
      selected_by: null,
      selected_at: null,
    },
  });

  return { deselected: paymentIds.length };
}

/**
 * Set/update per-payment remarks (Accounting Associate only — enforced at route level).
 */
export async function setPaymentRemarks(paymentId: string, remarks: string | null, userId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError('Payment not found', 404);
  if (!['SCHEDULED', 'FOR_PAYMENT', 'APPROVED_FOR_PAYMENT'].includes(payment.status)) {
    throw new AppError('Remarks can only be edited while the payment is scheduled or awaiting review', 400);
  }
  const trimmed = remarks?.trim();
  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { remarks: trimmed ? trimmed : null },
  });
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'PAYMENT_REMARKS_UPDATED',
      performed_by: userId,
      note: trimmed ? `Remarks updated: ${trimmed}` : 'Remarks cleared',
    },
  });
  return updated;
}

/**
 * Accounting Associate marks a payment "for payment" → goes to the Accounting
 * Supervisor's review queue (status FOR_PAYMENT).
 */
export async function markPaymentForPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status !== 'SCHEDULED') {
    throw new AppError('Only a scheduled payment can be marked for payment', 400);
  }
  if (payment.batch_id) {
    throw new AppError('A payment already inside a batch cannot be marked for payment — remove it from the batch first', 400);
  }
  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'FOR_PAYMENT',
      selected_for_batch: false,
      selected_by: null,
      selected_at: null,
    },
  });
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'PAYMENT_MARKED_FOR_PAYMENT',
      performed_by: userId,
      note: 'Payment marked for payment (FOR_PAYMENT) — queued for supervisor review',
    },
  });
  return updated;
}

/**
 * Accounting Supervisor approves the release of a sub-$100 HELD payment → it
 * becomes SCHEDULED and batchable (may proceed for payment or consolidation).
 * The Associate is notified.
 */
export async function approveHeldPayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { include: { vendor: true } } },
  });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status !== 'HELD_BELOW_100') {
    throw new AppError('Only a held payment (below $100) can be released by Purchasing', 400);
  }

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'SCHEDULED' },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'HELD_BELOW_100_APPROVED',
      performed_by: userId,
      note: 'Purchasing Coordinator approved release of sub-$100 payment — may proceed for payment or consolidation',
    },
  });

  await inAppNotificationService.create({
    invoice_id: payment.invoice_id,
    invoice_number: payment.invoice?.invoice_number,
    vendor_name: payment.invoice?.vendor?.name,
    title: `Sub-$100 hold released (${payment.invoice?.invoice_number || ''})`,
    message: 'Purchasing approved the held payment — it is now SCHEDULED and can be batched.',
    type: 'success',
    category: 'payment',
    target_role: UserRole.ACCOUNTING_ASSOCIATE,
  });

  logger.info(`[PaymentBatch] Accounting Supervisor approved release of held payment ${paymentId}`);
  return updated;
}

/**
 * Accounting Supervisor approves a FOR_PAYMENT payment — this is the FINAL
 * approval (no CC/VP step); only the payment process follows.
 */
export async function approvePaymentForPayment(paymentId: string, note: string | undefined, userId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status !== 'FOR_PAYMENT') {
    throw new AppError('Only a payment awaiting review can be approved', 400);
  }
  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'APPROVED_FOR_PAYMENT' },
  });
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'FOR_PAYMENT_APPROVED',
      performed_by: userId,
      note: note?.trim() || 'Payment approved for processing by supervisor',
    },
  });
  return updated;
}

/**
 * Accounting Supervisor approves ALL payments awaiting review (FOR_PAYMENT) at
 * once — the bulk counterpart of approvePaymentForPayment. The optional note
 * is recorded on each invoice as the supervisor note.
 */
export async function bulkApprovePaymentsForPayment(
  paymentIds: string[],
  note: string | undefined,
  userId: string
) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new AppError('Select at least one payment to approve', 400);
  }
  const uniqueIds = [...new Set(paymentIds)];

  const result = await prisma.$transaction(async (tx) => {
    const payments = await tx.payment.findMany({
      where: { id: { in: uniqueIds }, status: 'FOR_PAYMENT' },
    });
    if (payments.length === 0) {
      throw new AppError('No payments are awaiting review — nothing to approve', 400);
    }
    if (payments.length !== uniqueIds.length) {
      throw new AppError('Some payments are no longer awaiting review. Refresh the queue and try again.', 400);
    }
    await tx.payment.updateMany({
      where: { id: { in: uniqueIds } },
      data: { status: 'APPROVED_FOR_PAYMENT' },
    });
    const finalNote = note?.trim() || 'Payment approved for processing by supervisor (bulk)';
    for (const payment of payments) {
      await tx.auditLog.create({
        data: {
          invoice_id: payment.invoice_id,
          action: 'FOR_PAYMENT_APPROVED',
          performed_by: userId,
          note: finalNote,
        },
      });
    }
    return { approved: payments.length };
  });

  logger.info(`[PaymentBatch] Bulk-approved ${result.approved} payment(s) awaiting review (by ${userId})`);
  return result;
}

/**
 * Accounting Supervisor rejects a FOR_PAYMENT payment → it returns to
 * SCHEDULED; the reason is the supervisor's FINAL REMARKS, stored on the
 * audit log and shown to the Associate in the Remarks column.
 */
export async function rejectPaymentForPayment(paymentId: string, reason: string, userId: string) {
  if (!reason?.trim()) throw new AppError('Rejection reason is required', 400);
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status !== 'FOR_PAYMENT') {
    throw new AppError('Only a payment awaiting review can be rejected', 400);
  }
  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'SCHEDULED' },
  });
  await prisma.auditLog.create({
    data: {
      invoice_id: payment.invoice_id,
      action: 'FOR_PAYMENT_REJECTED',
      performed_by: userId,
      note: reason.trim(),
    },
  });
  return updated;
}

/**
 * Apply a bank charge to ONE payment in a batch (Accounting Associate).
 *
 * - At most ONE charged payment PER VENDOR per batch (a batch may combine
 *   multiple vendors, so each vendor gets its own single charge). Duplicates
 *   for the same vendor are blocked — the existing charge must be removed
 *   before a different one can be applied.
 * - Only allowed while the batch is DRAFT or RETURNED_FOR_CORRECTION.
 * - batch.total_amount is recomputed to include the charge (payments + charge).
 */
export async function applyBankCharge(
  batchId: string,
  paymentId: string,
  amount: number,
  note: string | undefined,
  userId: string
) {
  const charge = Number(amount);
  if (!isFinite(charge) || charge <= 0) {
    throw new AppError('Bank charge must be a positive amount', 400);
  }
  const rounded = Math.round(charge * 100) / 100;

  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: { payments: { include: { invoice: { include: { vendor: true } } } } },
  });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (![PaymentBatchStatus.DRAFT, PaymentBatchStatus.RETURNED_FOR_CORRECTION].includes(batch.status as any)) {
    throw new AppError('Bank charge can only be applied while the batch is a draft or returned for correction', 400);
  }

  const target = batch.payments.find((p: any) => p.id === paymentId);
  if (!target) throw new AppError('Payment is not part of this batch', 400);

  // Duplicate block — one bank charge per vendor per batch (batches may now
  // combine multiple vendors, so only the same vendor's charge is blocked).
  const existingCharge = batch.payments.find(
    (p: any) => p.bank_charge_amount != null && p.invoice?.vendor_id === target.invoice?.vendor_id
  );
  if (existingCharge) {
    throw new AppError('This vendor already has a bank charge in this batch — remove it first before applying a different one', 400);
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      bank_charge_amount: rounded,
      bank_charge_note: note?.trim() || null,
    },
  });

  // Recompute batch total = sum(payment amounts) + bank charges
  const total = recomputeBatchTotal(batch, paymentId, rounded);
  await prisma.paymentBatch.update({
    where: { id: batchId },
    data: { total_amount: total.toFixed(2) },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: target.invoice_id,
      action: 'BANK_CHARGE_APPLIED',
      performed_by: userId,
      note: `Bank charge ${rounded.toFixed(2)} applied to payment ${paymentId} in batch ${batch.batch_number}${note?.trim() ? ` — ${note.trim()}` : ''}`,
    },
  });

  logger.info(`[PaymentBatch] Bank charge ${rounded.toFixed(2)} applied to ${paymentId} in batch ${batch.batch_number}`);
  return {
    batch_id: batchId,
    batch_number: batch.batch_number,
    payment_id: paymentId,
    bank_charge_amount: rounded,
    total_amount: total,
  };
}

/**
 * Remove the bank charge from a payment in a batch and restore the batch
 * total to payments-only. Associate-only, same status guard as apply.
 */
export async function removeBankCharge(batchId: string, paymentId: string, userId: string) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: { payments: true, vendor_bill_stubs: { include: { lines: true } } },
  });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (![PaymentBatchStatus.DRAFT, PaymentBatchStatus.RETURNED_FOR_CORRECTION].includes(batch.status as any)) {
    throw new AppError('Bank charge can only be removed while the batch is a draft or returned for correction', 400);
  }

  const target = batch.payments.find((p: any) => p.id === paymentId);
  if (!target) throw new AppError('Payment is not part of this batch', 400);
  if (target.bank_charge_amount == null) {
    throw new AppError('This payment has no bank charge to remove', 400);
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: { bank_charge_amount: null, bank_charge_note: null },
  });
  const grouped = (batch as any).vendor_bill_stubs?.find((s: any) => s.lines.some((line: any) => line.payment_id === paymentId));
  if (grouped) {
    await prisma.payment.updateMany({
      where: { id: { in: grouped.lines.map((line: any) => line.payment_id) }, status: { in: ['SCHEDULED', 'APPROVED_FOR_PAYMENT'] } },
      data: { status: 'ENDORSED' },
    });
  }

  const total = recomputeBatchTotal(batch, paymentId, null);
  await prisma.paymentBatch.update({
    where: { id: batchId },
    data: { total_amount: total.toFixed(2) },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: target.invoice_id,
      action: 'BANK_CHARGE_REMOVED',
      performed_by: userId,
      note: `Bank charge removed from payment ${paymentId} in batch ${batch.batch_number}`,
    },
  });

  logger.info(`[PaymentBatch] Bank charge removed from ${paymentId} in batch ${batch.batch_number}`);
  return {
    batch_id: batchId,
    batch_number: batch.batch_number,
    payment_id: paymentId,
    bank_charge_amount: null,
    total_amount: total,
  };
}

export interface BillStubInput {
  stubDate?: string;
  type?: string;
  reference?: string;
  originalAmount?: number;
  balance?: number;
  discount?: number;
  paidAmount?: number;
  proofFileUrl?: string;
  proofFileName?: string;
}

/**
 * Accounting Associate (or Supervisor) endorses a bill stub for ONE payment in
 * the batch — tagging the invoice as in the payment process. The payment goes
 * to ENDORSED (NOT paid — bank endorsement is not a completed payment).
 *
 * The bill stub carries the QB Pay Bills header: date, type, reference,
 * original amount, balance, discount, payment (paid amount). A stub can be
 * re-endorsed (upsert) while the payment is still pending.
 */
export async function endorseBillStub(
  batchId: string,
  paymentId: string,
  input: BillStubInput,
  userId: string
) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: { payments: true },
  });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (![PaymentBatchStatus.REVIEWED, PaymentBatchStatus.EXPORTED_TO_BANK].includes(batch.status as any)) {
    throw new AppError('A bill stub can only be endorsed after the batch is reviewed and exported to the bank', 400);
  }
  const target = batch.payments.find((p: any) => p.id === paymentId);
  if (!target) throw new AppError('Payment is not part of this batch', 400);
  if (!['SCHEDULED', 'APPROVED_FOR_PAYMENT'].includes(target.status)) {
    throw new AppError('Only a scheduled or supervisor-approved payment in the batch can be endorsed', 400);
  }

  const paidAmount = input.paidAmount != null ? Math.round(Number(input.paidAmount) * 100) / 100 : null;
  if (paidAmount != null && (!isFinite(paidAmount) || paidAmount < 0)) {
    throw new AppError('Payment amount on the bill stub must be a valid non-negative amount', 400);
  }

  const data = {
    batch_id: batchId,
    stub_date: input.stubDate ? new Date(input.stubDate) : null,
    type: input.type?.trim() || null,
    reference: input.reference?.trim() || null,
    original_amount: input.originalAmount != null ? Number(input.originalAmount) : null,
    balance: input.balance != null ? Number(input.balance) : null,
    discount: input.discount != null ? Number(input.discount) : null,
    paid_amount: paidAmount,
    proof_file_url: input.proofFileUrl || null,
    proof_file_name: input.proofFileName || null,
    created_by: userId,
  };

  const stub = await prisma.billStub.upsert({
    where: { payment_id: paymentId },
    create: { payment_id: paymentId, ...data },
    update: data,
  });

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'ENDORSED' },
  });

  await prisma.auditLog.create({
    data: {
      invoice_id: target.invoice_id,
      action: 'BILL_STUB_ENDORSED',
      performed_by: userId,
      note: `Bill stub endorsed for payment ${paymentId} in batch ${batch.batch_number}${input.reference ? ` — ref ${input.reference.trim()}` : ''}. Tagged ENDORSED (in payment process, not paid).`,
    },
  });

  logger.info(`[PaymentBatch] Bill stub endorsed for ${paymentId} in batch ${batch.batch_number}`);
  return { ...stub, payment_status: 'ENDORSED' };
}

/**
 * Match a payment confirmation against ENDORSED payments in the batch and tag
 * them PAID. Matching is by REFERENCE (amount is the tiebreak when two vendors
 * share the same processed amount). The confirmation may also be matched via
 * the exported Excel file — the Associate selects the payments explicitly.
 *
 * When every payment in the batch is PAID, the batch is marked PROCESSED.
 */
export async function matchPaymentConfirmation(
  batchId: string,
  input: { reference?: string; amount?: number; paidDate?: string; paymentIds?: string[] },
  userId: string
) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: { payments: { include: { bill_stub: true } } },
  });
  if (!batch) throw new AppError('Payment batch not found', 404);

  const endorsed = (batch.payments as any[]).filter((p) => p.status === 'ENDORSED');
  if (endorsed.length === 0) {
    throw new AppError('No endorsed payments in this batch to match — endorse bill stubs first', 400);
  }

  let matched: any[];
  if (Array.isArray(input.paymentIds) && input.paymentIds.length > 0) {
    const selected = new Set(input.paymentIds);
    matched = endorsed.filter((p) => selected.has(p.id));
    if (matched.length !== input.paymentIds.length) {
      throw new AppError('Some selected payments are not endorsed in this batch', 400);
    }
  } else {
    const ref = input.reference?.trim();
    if (!ref) throw new AppError('Payment confirmation reference is required to match', 400);
    matched = endorsed.filter((p) => p.bill_stub?.reference === ref || p.reference === ref);
    if (matched.length === 0) {
      throw new AppError(`No endorsed payment matches reference "${ref}"`, 400);
    }
    if (matched.length > 1 && input.amount != null && isFinite(Number(input.amount))) {
      const amt = Number(input.amount);
      matched = matched.filter((p) => Math.abs(Number(p.amount) - amt) < 0.005);
    }
    if (matched.length > 1) {
      throw new AppError(
        `Reference "${ref}" matches ${matched.length} payments and the amount is not unique — select the matching payments explicitly (e.g. from the exported Excel file)`,
        400
      );
    }
  }

  const paidAt = input.paidDate ? new Date(input.paidDate) : new Date();
  const confirmationRef = input.reference?.trim() || 'payment confirmation';
  for (const payment of matched) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        paid_at: paidAt,
        reference: payment.bill_stub?.reference || payment.reference || confirmationRef,
      },
    });
    await prisma.invoice.update({
      where: { id: payment.invoice_id },
      data: { status: InvoiceStatus.PAID as any },
    });
    await prisma.auditLog.create({
      data: {
        invoice_id: payment.invoice_id,
        action: 'PAYMENT_CONFIRMATION_MATCHED',
        performed_by: userId,
        note: `Payment matched by confirmation (ref ${confirmationRef}) and tagged PAID in batch ${batch.batch_number}`,
      },
    });
  }

  // If every payment in the batch is now PAID, mark the batch PROCESSED
  const remaining = await prisma.payment.count({
    where: { batch_id: batchId, status: { not: 'PAID' } },
  });
  const batchProcessed = remaining === 0;
  if (batchProcessed) {
    await prisma.paymentBatch.update({
      where: { id: batchId },
      data: {
        status: PaymentBatchStatus.PROCESSED as any,
        processed_by: userId,
        processed_at: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'PAYMENT_BATCH_PROCESSED',
        performed_by: userId,
        note: `Batch ${batch.batch_number} marked PROCESSED — all payments confirmed PAID via payment confirmation match`,
      },
    });
  }

  logger.info(`[PaymentBatch] Matched ${matched.length} payment(s) as PAID in batch ${batch.batch_number}`);
  return {
    batch_id: batchId,
    batch_number: batch.batch_number,
    matched: matched.length,
    payment_ids: matched.map((p) => p.id),
    batch_processed: batchProcessed,
  };
}

/**
 * Sum a batch's payments plus its bank charges. When `changedPaymentId` is
 * given, its charge is treated as `changedCharge` (the post-update value).
 */
function recomputeBatchTotal(batch: any, changedPaymentId: string, changedCharge: number | null): number {
  const paymentsTotal = batch.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const chargesTotal = batch.payments.reduce((sum: number, p: any) => {
    if (p.id === changedPaymentId) {
      return sum + (changedCharge == null ? 0 : changedCharge);
    }
    return sum + (Number(p.bank_charge_amount) || 0);
  }, 0);
  return Math.round((paymentsTotal + chargesTotal) * 100) / 100;
}

/**
 * Auto-create payment batch for Wednesday processing
 */
export async function autoCreateWednesdayBatch(userId: string) {
  if (!isWednesday()) {
    throw new AppError('Today is not Wednesday. Batches can only be auto-created on Wednesdays.', 400);
  }

  const payments = await getPaymentsForNextWednesday();

  if (payments.length === 0) {
    return { message: 'No payments scheduled for today' };
  }

  const paymentIds = payments.map((p: any) => p.id);
  return createPaymentBatch(paymentIds, userId);
}

/**
 * Generate payment file for NextGen
 */
export async function generatePaymentFile(batchId: string) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      payments: {
        include: {
          invoice: {
            include: {
              vendor: true,
            },
          },
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Payment batch not found', 404);
  }

  // Generate payment file in NextGen format
  const paymentFile = {
    batch_number: batch.batch_number,
    batch_date: batch.created_at.toISOString().split('T')[0],
    total_amount: batch.total_amount,
    payment_count: batch.payment_count,
    payments: batch.payments.map((payment: any) => ({
      payment_id: payment.id,
      invoice_number: payment.invoice.invoice_number,
      vendor_id: payment.invoice.vendor_id,
      vendor_name: payment.invoice.vendor.name,
      amount: payment.amount,
      currency: payment.currency,
      bank_charge: payment.bank_charge_amount ? Number(payment.bank_charge_amount) : null,
      payment_date: payment.payment_date.toISOString().split('T')[0],
      beneficiary_name: payment.beneficiary_name_snapshot,
      bank_name: payment.bank_name_snapshot,
      bank_address: payment.bank_address_snapshot,
      swift_code: payment.swift_code_snapshot,
      account_number: payment.account_number_snapshot,
    })),
  };

  return paymentFile;
}

/**
 * Get payment batch statistics
 */
export async function getPaymentBatchStatistics() {
  const totalBatches = await prisma.paymentBatch.count();
  const pendingBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.DRAFT } });
  const pendingReviewBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.PENDING_SUPERVISOR_REVIEW } });
  const reviewedBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.REVIEWED } });
  const processedBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.PROCESSED } });
  const cancelledBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.CANCELLED } });

  const totalAmount = await prisma.paymentBatch.aggregate({
    _sum: { total_amount: true },
  });

  return {
    total_batches: totalBatches,
    pending_batches: pendingBatches,
    pending_supervisor_review_batches: pendingReviewBatches,
    reviewed_batches: reviewedBatches,
    processed_batches: processedBatches,
    cancelled_batches: cancelledBatches,
    total_amount_processed: totalAmount._sum.total_amount || 0,
  };
}

export async function createPaymentBatch(
  paymentIds: string[],
  userId: string
) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new AppError('Select at least one scheduled payment to create a batch', 400);
  }

  // Validate that all payments exist, are in SCHEDULED status, and selected by Accounting Associate
  const payments = await prisma.payment.findMany({
    where: {
      id: { in: paymentIds },
      status: { in: ['SCHEDULED', 'APPROVED_FOR_PAYMENT'] },
      selected_for_batch: true,
      selected_by: userId,
      batch_id: null,
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
  });

  if (payments.length !== paymentIds.length) {
    throw new AppError('Some payments are not found, not selected for batch, or not in SCHEDULED/APPROVED_FOR_PAYMENT status', 400);
  }

  // A payment batch is a payment-authorisation boundary. Do not allow an
  // incomplete invoice, an unresolved bank snapshot, or mixed currencies into
  // the batch; otherwise a later vendor/stub grouping could silently combine
  // unsafe records.
  const currencies = new Set(payments.map((p: any) => String(p.currency || p.invoice?.currency || 'USD').toUpperCase()));
  if (currencies.size > 1) {
    throw new AppError('A payment batch may contain only one currency', 400);
  }
  const invalid: string[] = [];
  for (const payment of payments as any[]) {
    const readiness = getApprovalReadiness(payment.invoice);
    if (!readiness.ready) {
      invalid.push(`${payment.invoice?.invoice_number || payment.invoice_id}: ${readiness.missing.map((m: any) => m.label).join(', ')}`);
      continue;
    }
    const hasBankSnapshot = Boolean(payment.beneficiary_name_snapshot && payment.account_number_snapshot && payment.bank_snapshot_hash);
    if (!hasBankSnapshot) invalid.push(`${payment.invoice?.invoice_number || payment.invoice_id}: approved bank details snapshot is missing`);
  }
  if (invalid.length) {
    throw new AppError(`Cannot create payment batch until all invoices pass validation: ${invalid.slice(0, 8).join('; ')}${invalid.length > 8 ? `; and ${invalid.length - 8} more` : ''}`, 400);
  }

  // A batch may combine payments from ANY vendors (Accounting Associate decides
  // the grouping). Banking controls are preserved at export time — each payment
  // row carries its own vendor's bank details in the exported file.

  // Calculate total batch amount
  const totalAmount = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  // Create payment batch
  const batch = await prisma.paymentBatch.create({
    data: {
      batch_number: generateBatchNumber(),
      total_amount: totalAmount.toFixed(2),
      payment_count: payments.length,
      status: PaymentBatchStatus.DRAFT as any,
      created_by: userId,
      payments: {
        connect: paymentIds.map((id) => ({ id })),
      },
    },
  });

  // Update payments to link to batch and clear selection
  await prisma.payment.updateMany({
    where: {
      id: { in: paymentIds },
    },
    data: {
      batch_id: batch.id,
      selected_for_batch: false,
      selected_by: null,
      selected_at: null,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_CREATED',
      performed_by: userId,
      note: `Payment batch ${batch.batch_number} created with ${payments.length} payments totaling ${totalAmount}`,
    },
  });

  return batch;
}

/**
 * Create ONE batch for all selected payments — regardless of vendor. Accounting
 * Associates select payments across vendors and they land in the same batch;
 * each payment keeps its own vendor's bank details for the export.
 */
export async function createGroupedPaymentBatches(paymentIds: string[], userId: string) {
  const uniquePaymentIds = [...new Set(paymentIds)];
  const batch = await createPaymentBatch(uniquePaymentIds, userId);

  return {
    batches: [batch],
    batch_count: 1,
    payment_count: uniquePaymentIds.length,
  };
}

export async function getPaymentBatches() {
  const batches = await prisma.paymentBatch.findMany({
    include: {
      vendor_bill_stubs: { include: { vendor: true, lines: true } },
      payments: {
        include: {
          invoice: {
            include: {
              vendor: true,
            },
          },
          bill_stub: true,
        },
      },
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  return batches;
}

export async function getPaymentBatchById(batchId: string) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      vendor_bill_stubs: { include: { vendor: true, lines: true } },
      payments: {
        include: {
          invoice: {
            include: {
              vendor: true,
            },
          },
          bill_stub: true,
        },
      },
    },
  });

  if (!batch) {
    throw new AppError('Payment batch not found', 404);
  }

  return batch;
}

export async function processPaymentBatch(
  batchId: string,
  userId: string,
  execution: PaymentExecutionInput = {}
) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      payments: true,
    },
  });

  if (!batch) {
    throw new AppError('Payment batch not found', 404);
  }

  if (![PaymentBatchStatus.REVIEWED, PaymentBatchStatus.EXPORTED_TO_BANK].includes(batch.status as any)) {
    throw new AppError('Batch must be reviewed by Accounting Supervisor before processing', 400);
  }
  if (batch.created_by === userId || batch.submitted_by === userId) {
    throw new AppError('Payment batch preparer cannot execute the same batch', 403);
  }
  if (batch.reviewed_by === userId) {
    throw new AppError('Payment batch reviewer cannot execute the same batch', 403);
  }

  await prisma.paymentBatch.update({ where: { id: batchId }, data: { status: PaymentBatchStatus.PROCESSING as any } });

  // Process each payment in the batch via processPayment for consistent behavior
  // (email notifications, payment references, in-app notifications, stage timestamps)
  for (const payment of batch.payments) {
    if (payment.status === 'PAID') {
      logger.warn(`Payment ${payment.id} in batch ${batch.batch_number} is already PAID — skipping`);
      continue;
    }
    if (payment.status !== 'SCHEDULED') {
      logger.warn(`Payment ${payment.id} in batch ${batch.batch_number} has status ${payment.status} — skipping`);
      continue;
    }
    try {
      await processPayment(payment.id, userId, execution);
    } catch (err) {
      logger.error(`Failed to process payment ${payment.id} in batch ${batch.batch_number}:`, err);
      throw new AppError(`Payment ${payment.id} failed to process: ${err instanceof Error ? err.message : 'unknown error'}`, 500);
    }
  }

  // Mark batch as PROCESSED
  const updatedBatch = await prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: PaymentBatchStatus.PROCESSED as any,
      processed_by: userId,
      processed_at: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_PROCESSED',
      performed_by: userId,
      note: `Payment batch ${batch.batch_number} executed by Accounting Supervisor. ${batch.payments.length} payments processed, invoices marked as PAID, remittance advice sent.`,
    },
  });

  return updatedBatch;
}

export async function submitPaymentBatchForReview(batchId: string, userId: string) {
  const batch = await prisma.paymentBatch.findUnique({ where: { id: batchId }, include: { payments: true } });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (![PaymentBatchStatus.DRAFT, PaymentBatchStatus.RETURNED_FOR_CORRECTION].includes(batch.status as any)) {
    throw new AppError('Only draft or returned batches can be submitted', 400);
  }
  if (batch.payments.length === 0) throw new AppError('Cannot submit an empty batch', 400);
  return prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: PaymentBatchStatus.PENDING_SUPERVISOR_REVIEW as any,
      submitted_by: userId,
      submitted_at: new Date(),
      return_reason: null,
      returned_at: null,
      returned_by: null,
    },
  });
}

export async function reviewPaymentBatch(batchId: string, userId: string, note?: string) {
  const batch = await prisma.paymentBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (batch.status !== PaymentBatchStatus.PENDING_SUPERVISOR_REVIEW) {
    throw new AppError('Batch is not pending supervisor review', 400);
  }
  if (batch.created_by === userId || batch.submitted_by === userId) {
    throw new AppError('Payment batch preparer cannot review their own batch', 403);
  }
  return prisma.paymentBatch.update({
    where: { id: batchId },
    data: { status: PaymentBatchStatus.REVIEWED as any, reviewed_by: userId, reviewed_at: new Date(), review_note: note || null },
  });
}

export async function returnPaymentBatch(batchId: string, userId: string, reason: string) {
  if (!reason?.trim()) throw new AppError('Return reason is required', 400);
  const batch = await prisma.paymentBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (batch.status !== PaymentBatchStatus.PENDING_SUPERVISOR_REVIEW) {
    throw new AppError('Only a batch pending supervisor review can be returned', 400);
  }
  return prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: PaymentBatchStatus.RETURNED_FOR_CORRECTION as any,
      returned_by: userId,
      returned_at: new Date(),
      return_reason: reason.trim(),
      reviewed_by: null,
      reviewed_at: null,
    },
  });
}

export async function markPaymentBatchExported(batchId: string, userId: string) {
  const batch = await prisma.paymentBatch.findUnique({ where: { id: batchId }, include: { payments: { include: { invoice: true } } } });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (batch.status !== PaymentBatchStatus.REVIEWED) throw new AppError('Only a reviewed batch can be exported', 400);
  // Create one vendor-level stub per vendor on export. Existing payment-level
  // stubs remain untouched for backward compatibility and reconciliation.
  const groups = new Map<string, any[]>();
  for (const payment of batch.payments as any[]) {
    const vendorId = payment.vendor_id || payment.invoice?.vendor_id;
    if (!vendorId) throw new AppError(`Payment ${payment.id} has no vendor and cannot be exported`, 400);
    const key = `${vendorId}:${String(payment.currency || payment.invoice?.currency || 'USD').toUpperCase()}`;
    groups.set(key, [...(groups.get(key) || []), payment]);
  }
  const vendorBillStub = (prisma as any).vendorBillStub;
  if (vendorBillStub) {
    for (const [, payments] of groups) {
      const first = payments[0];
      const total = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      const existing = await vendorBillStub.findFirst({ where: { batch_id: batchId, vendor_id: first.vendor_id || first.invoice.vendor_id } });
      const stub = existing || await vendorBillStub.create({ data: {
        batch_id: batchId,
        vendor_id: first.vendor_id || first.invoice.vendor_id,
        currency: String(first.currency || first.invoice?.currency || 'USD').toUpperCase(),
        total_amount: total.toFixed(2),
        status: 'EXPORTED',
        payment_reference: `VB-${batch.batch_number}-${String(first.vendor_id || first.invoice.vendor_id).slice(0, 8)}`,
        created_by: userId,
      }});
      if (existing) await vendorBillStub.update({ where: { id: stub.id }, data: { total_amount: total.toFixed(2), status: 'EXPORTED' } });
      const lineModel = (prisma as any).vendorBillStubLine;
      if (lineModel) for (const payment of payments) {
        await lineModel.upsert({ where: { payment_id: payment.id }, create: { bill_stub_id: stub.id, payment_id: payment.id, invoice_id: payment.invoice_id, amount: payment.amount }, update: { bill_stub_id: stub.id, invoice_id: payment.invoice_id, amount: payment.amount } });
      }
    }
  }
  await prisma.auditLog.create({ data: { action: 'PAYMENT_BATCH_EXPORTED', performed_by: userId, note: `Batch ${batch.batch_number} exported to bank` } });
  return prisma.paymentBatch.update({
    where: { id: batchId },
    data: { status: PaymentBatchStatus.EXPORTED_TO_BANK as any, exported_at: new Date() },
  });
}

/**
 * Stuck-batch alert: EXPORTED_TO_BANK batches whose payments have not been
 * endorsed (bill stub) or confirmed PAID within the alert window. The window
 * defaults to STUCK_BATCH_ALERT_DAYS (env, default 3) and can be overridden
 * per request via `days`.
 *
 * A batch is "stuck" when it was exported more than N days ago AND at least
 * one payment is still SCHEDULED/APPROVED_FOR_PAYMENT (no stub endorsed, no
 * confirmation matched). Those payments are the ones that need action.
 */
export async function getStuckBatches(daysOverride?: number | string) {
  const parsed = Number(daysOverride);
  const days = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : Number(process.env.STUCK_BATCH_ALERT_DAYS) || 3;
  const cutoff = new Date(Date.now() - days * 86400000);

  const batches = await prisma.paymentBatch.findMany({
    where: {
      status: PaymentBatchStatus.EXPORTED_TO_BANK as any,
      // exported_at is null only for batches exported before this field existed
      // (pre-feature) — those are treated as older than the window.
      OR: [{ exported_at: { lte: cutoff } }, { exported_at: null }],
      payments: {
        some: {
          status: { notIn: ['PAID', 'ENDORSED'] },
        },
      },
    },
    include: {
      payments: {
        include: {
          invoice: { include: { vendor: true } },
          bill_stub: true,
        },
      },
    },
    orderBy: { exported_at: 'asc' as const },
  });

  return batches.map((b: any) => {
    const pending = (b.payments || []).filter((p: any) => !['PAID', 'ENDORSED'].includes(p.status));
    // Prefer exported_at; legacy batches fall back to reviewed_at, then created_at.
    const anchor = b.exported_at || b.reviewed_at || b.created_at;
    return {
      ...b,
      days_stuck: anchor ? Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000) : days,
      pending_payments: pending.length,
    };
  });
}

export async function cancelPaymentBatch(
  batchId: string,
  userId: string,
  reason: string
) {
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      payments: true,
    },
  });

  if (!batch) {
    throw new AppError('Payment batch not found', 404);
  }

  if (![PaymentBatchStatus.DRAFT, PaymentBatchStatus.RETURNED_FOR_CORRECTION, PaymentBatchStatus.PENDING_SUPERVISOR_REVIEW].includes(batch.status as any)) {
    throw new AppError('Only draft, returned, or pending-review batches can be cancelled', 400);
  }

  // Update batch status to CANCELLED
  const updatedBatch = await prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: PaymentBatchStatus.CANCELLED as any,
      cancelled_at: new Date(),
      cancelled_by: userId,
      cancellation_reason: reason,
    },
  });

  // Unlink payments from batch
  await prisma.payment.updateMany({
    where: {
      batch_id: batchId,
    },
    data: {
      batch_id: null,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_CANCELLED',
      performed_by: userId,
      note: `Payment batch ${batch.batch_number} cancelled: ${reason}`,
    },
  });

  return updatedBatch;
}

/**
 * Return individual invoice(s) from a payment batch back for revision.
 * - Unlinks the payment(s) from the batch
 * - Resets payment status to SCHEDULED (available for future batches)
 * - Resets invoice status to PENDING_ACCOUNTING (back to accounting review)
 * - Updates batch total_amount and payment_count
 * - If all payments are returned, the batch is cancelled
 *
 * Can be called by either ACCOUNTING_SUPERVISOR (during review) or ACCOUNTING_ASSOCIATE (on returned batch).
 */
export async function returnInvoicesFromBatch(
  batchId: string,
  paymentIds: string[],
  userId: string,
  reason: string
) {
  if (!reason?.trim()) throw new AppError('Return reason is required', 400);
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new AppError('Select at least one invoice to return', 400);
  }

  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      payments: {
        include: {
          invoice: true,
        },
      },
    },
  });

  if (!batch) throw new AppError('Payment batch not found', 404);

  // Allow return from PENDING_SUPERVISOR_REVIEW (supervisor returning) or RETURNED_FOR_CORRECTION (associate revising)
  if (![PaymentBatchStatus.PENDING_SUPERVISOR_REVIEW, PaymentBatchStatus.RETURNED_FOR_CORRECTION, PaymentBatchStatus.DRAFT].includes(batch.status as any)) {
    throw new AppError('Only draft, pending-review, or returned batches allow per-invoice returns', 400);
  }

  // Validate that the payment IDs belong to this batch
  const batchPaymentIds = new Set(batch.payments.map((p: any) => p.id));
  const invalidIds = paymentIds.filter(id => !batchPaymentIds.has(id));
  if (invalidIds.length > 0) {
    throw new AppError('Some invoices are not part of this batch', 400);
  }

  const paymentsToReturn = batch.payments.filter((p: any) => paymentIds.includes(p.id));
  const remainingPayments = batch.payments.filter((p: any) => !paymentIds.includes(p.id));

  // 1. Unlink returned payments from batch, reset to SCHEDULED (available for
  //    future batches) — status is explicitly reset so a payment that was
  //    APPROVED_FOR_PAYMENT does not stay in that state with no batch.
  await prisma.payment.updateMany({
    where: { id: { in: paymentIds } },
    data: {
      batch_id: null,
      selected_for_batch: false,
      selected_by: null,
      selected_at: null,
      status: 'SCHEDULED',
    },
  });

  // 2. Reset invoice status to PENDING_ACCOUNTING for returned invoices
  const invoiceIdsToReturn = paymentsToReturn.map((p: any) => p.invoice_id);
  for (const invId of invoiceIdsToReturn) {
    await prisma.invoice.update({
      where: { id: invId },
      data: { status: InvoiceStatus.PENDING_ACCOUNTING as any },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: invId,
        action: 'INVOICE_RETURNED_FROM_BATCH',
        performed_by: userId,
        note: `Invoice returned from batch ${batch.batch_number} for revision. Reason: ${reason.trim()}`,
      },
    });
  }

  // 3. If all payments were returned, cancel the batch
  if (remainingPayments.length === 0) {
    await prisma.paymentBatch.update({
      where: { id: batchId },
      data: {
        status: PaymentBatchStatus.CANCELLED as any,
        cancelled_at: new Date(),
        cancelled_by: userId,
        cancellation_reason: `All invoices returned for revision: ${reason.trim()}`,
        total_amount: 0,
        payment_count: 0,
      },
    });
    logger.info(`[PaymentBatch] Batch ${batch.batch_number} cancelled — all invoices returned`);
  } else {
    // 4. Update batch totals
    const newTotal = remainingPayments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
    await prisma.paymentBatch.update({
      where: { id: batchId },
      data: {
        total_amount: newTotal.toFixed(2),
        payment_count: remainingPayments.length,
      },
    });
    logger.info(`[PaymentBatch] Batch ${batch.batch_number} updated — ${paymentIds.length} invoice(s) returned, ${remainingPayments.length} remaining`);
  }

  // 5. Audit log for the batch action
  await prisma.auditLog.create({
    data: {
      action: 'BATCH_INVOICES_RETURNED',
      performed_by: userId,
      note: `${paymentIds.length} invoice(s) returned from batch ${batch.batch_number}. Reason: ${reason.trim()}`,
    },
  });

  return {
    batch_id: batchId,
    batch_number: batch.batch_number,
    returned_count: paymentIds.length,
    remaining_count: remainingPayments.length,
    batch_cancelled: remainingPayments.length === 0,
    returned_invoice_numbers: paymentsToReturn.map((p: any) => p.invoice?.invoice_number).filter(Boolean),
  };
}

function generateBatchNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PB${year}${month}${day}${random}`;
}
