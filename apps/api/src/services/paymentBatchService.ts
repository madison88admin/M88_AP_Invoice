import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PaymentBatchStatus, InvoiceStatus, SLA_LIMITS, calcWorkingHoursElapsed } from '@ap-invoice/shared';

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
export async function getScheduledPaymentsForBatch() {
  const payments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
      batch_id: null,
      payment_date: {
        gte: new Date(),
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
  const payments = await prisma.payment.findMany({
    where: {
      id: { in: paymentIds },
      status: 'SCHEDULED',
      batch_id: null,
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
  const pendingCfoBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.PENDING_CFO } });
  const approvedBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.APPROVED } });
  const processedBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.PROCESSED } });
  const cancelledBatches = await prisma.paymentBatch.count({ where: { status: PaymentBatchStatus.CANCELLED } });

  const totalAmount = await prisma.paymentBatch.aggregate({
    _sum: { total_amount: true },
  });

  return {
    total_batches: totalBatches,
    pending_batches: pendingBatches,
    pending_cfo_batches: pendingCfoBatches,
    approved_batches: approvedBatches,
    processed_batches: processedBatches,
    cancelled_batches: cancelledBatches,
    total_amount_processed: totalAmount._sum.total_amount || 0,
  };
}

export async function createPaymentBatch(
  paymentIds: string[],
  userId: string
) {
  // Validate that all payments exist, are in SCHEDULED status, and selected by Accounting Associate
  const payments = await prisma.payment.findMany({
    where: {
      id: { in: paymentIds },
      status: 'SCHEDULED',
      selected_for_batch: true,
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

  // Calculate total batch amount
  const totalAmount = payments.reduce((sum: number, p: any) => sum + p.amount, 0);

  // Create payment batch
  const batch = await prisma.paymentBatch.create({
    data: {
      batch_number: generateBatchNumber(),
      total_amount: totalAmount,
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

  if (batch.status !== PaymentBatchStatus.DRAFT) {
    throw new AppError('Batch is not in DRAFT status', 400);
  }

  // Move batch to CFO approval queue
  const updatedBatch = await prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: PaymentBatchStatus.PENDING_CFO as any,
      processed_by: userId,
      processed_at: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_PENDING_CFO',
      performed_by: userId,
      note: `Payment batch ${batch.batch_number} submitted for CFO approval. ${batch.payments.length} payments totaling ${batch.total_amount}`,
    },
  });

  return updatedBatch;
}

/**
 * CFO approves a payment batch and executes payment
 */
export async function approvePaymentBatchByCFO(
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

  if (batch.status !== PaymentBatchStatus.PENDING_CFO) {
    throw new AppError('Batch is not pending CFO approval', 400);
  }

  // Process each payment in the batch
  for (const payment of batch.payments) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        paid_at: new Date(),
      },
    });

    // Update invoice status to PAID
    await prisma.invoice.update({
      where: { id: payment.invoice_id },
      data: { status: InvoiceStatus.PAID },
    });

    // Exit PAYMENT_SCHEDULED stage timestamp
    const scheduledStage = await prisma.stageTimestamp.findFirst({
      where: { invoice_id: payment.invoice_id, stage: InvoiceStatus.PAYMENT_SCHEDULED as any, exited_at: null },
    });
    if (scheduledStage) {
      const elapsedHours = calcWorkingHoursElapsed(new Date(scheduledStage.entered_at), new Date());
      await prisma.stageTimestamp.update({
        where: { id: scheduledStage.id },
        data: {
          exited_at: new Date(),
          is_breached: elapsedHours > scheduledStage.sla_hours,
        },
      });
    }

    // Create PAID stage timestamp (final stage)
    await prisma.stageTimestamp.create({
      data: {
        invoice_id: payment.invoice_id,
        stage: InvoiceStatus.PAID as any,
        entered_at: new Date(),
        sla_hours: 0,
        exited_at: new Date(),
        is_breached: false,
      },
    });

    await prisma.auditLog.create({
      data: {
        invoice_id: payment.invoice_id,
        action: 'PAYMENT_PROCESSED',
        performed_by: userId,
        note: `Payment ${payment.id} processed in batch ${batch.batch_number}`,
      },
    });
  }

  const updatedBatch = await prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: PaymentBatchStatus.PROCESSED as any,
      processed_at: new Date(),
      processed_by: userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_PROCESSED',
      performed_by: userId,
      note: `Payment batch ${batch.batch_number} approved by CFO and processed with ${batch.payments.length} payments`,
    },
  });

  return updatedBatch;
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

  if (batch.status !== PaymentBatchStatus.DRAFT) {
    throw new AppError('Only DRAFT batches can be cancelled', 400);
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
