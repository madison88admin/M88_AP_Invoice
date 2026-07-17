import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PaymentBatchStatus } from '@ap-invoice/shared';
import { processPayment } from './postingService';
import { logger } from '../utils/logger';

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
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export async function getScheduledPaymentsForBatch(filters: ScheduledPaymentFilters = {}) {
  const paymentDate: any = { gte: filters.dateFrom ? new Date(filters.dateFrom) : new Date() };
  if (filters.dateTo) paymentDate.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
  const payments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
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
            { vendor: { name: { contains: filters.search, mode: 'insensitive' as const } } },
          ],
        } : {}),
      },
    },
    include: {
      invoice: {
        include: {
          vendor: true,
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
 * Select payments for batch creation by Accounting Associate
 */
export async function selectPaymentsForBatch(paymentIds: string[], userId: string) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new AppError('Select at least one scheduled payment', 400);
  }

  const payments = await prisma.payment.findMany({
    where: {
      id: { in: paymentIds },
      status: 'SCHEDULED',
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
      payment_date: payment.payment_date.toISOString().split('T')[0],
      bank_name: payment.invoice.vendor.bank_name,
      bank_address: payment.invoice.vendor.bank_address,
      swift_code: payment.invoice.vendor.swift_code,
      account_number: payment.invoice.vendor.account_number,
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
      status: 'SCHEDULED',
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
    throw new AppError('Some payments are not found, not selected for batch, or not in SCHEDULED status', 400);
  }

  // One payment batch must have one vendor, currency, beneficiary account and legal entity.
  const compatibilityKeys = new Set(payments.map((p: any) => [
    p.invoice.vendor_id,
    p.currency,
    p.invoice.vendor?.account_number || '',
    p.invoice.bill_to_entity || '',
  ].join('|')));
  if (compatibilityKeys.size > 1) {
    throw new AppError('A batch can only combine payments for the same vendor, currency, beneficiary account, and legal entity', 400);
  }

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
 * Create one batch per compatible vendor/payment group. This lets Accounting
 * Associates select payments across vendors while preserving banking controls.
 */
export async function createGroupedPaymentBatches(paymentIds: string[], userId: string) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new AppError('Select at least one scheduled payment to create a batch', 400);
  }

  const uniquePaymentIds = [...new Set(paymentIds)];
  const payments = await prisma.payment.findMany({
    where: {
      id: { in: uniquePaymentIds },
      status: 'SCHEDULED',
      selected_for_batch: true,
      selected_by: userId,
      batch_id: null,
    },
    include: { invoice: { include: { vendor: true } } },
  });

  if (payments.length !== uniquePaymentIds.length) {
    throw new AppError('Some payments are no longer available or were selected by another user. Refresh the schedule and try again.', 400);
  }

  const groups = new Map<string, string[]>();
  for (const payment of payments as any[]) {
    const key = [
      payment.invoice.vendor_id,
      payment.currency,
      payment.invoice.vendor?.account_number || '',
      payment.invoice.bill_to_entity || '',
    ].join('|');
    groups.set(key, [...(groups.get(key) || []), payment.id]);
  }

  const batches = [];
  for (const ids of groups.values()) {
    batches.push(await createPaymentBatch(ids, userId));
  }

  return {
    batches,
    batch_count: batches.length,
    payment_count: uniquePaymentIds.length,
  };
}

export async function getPaymentBatches() {
  const batches = await prisma.paymentBatch.findMany({
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

  return batch;
}

export async function processPaymentBatch(
  batchId: string,
  userId: string
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
      await processPayment(payment.id, userId);
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
  const batch = await prisma.paymentBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AppError('Payment batch not found', 404);
  if (batch.status !== PaymentBatchStatus.REVIEWED) throw new AppError('Only a reviewed batch can be exported', 400);
  await prisma.auditLog.create({ data: { action: 'PAYMENT_BATCH_EXPORTED', performed_by: userId, note: `Batch ${batch.batch_number} exported to bank` } });
  return prisma.paymentBatch.update({ where: { id: batchId }, data: { status: PaymentBatchStatus.EXPORTED_TO_BANK as any } });
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

function generateBatchNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PB${year}${month}${day}${random}`;
}
