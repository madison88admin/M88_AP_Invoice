import prisma from '../config/database';

export async function createPaymentBatch(
  paymentIds: string[],
  userId: string
) {
  // Validate that all payments exist and are in SCHEDULED status
  const payments = await prisma.payment.findMany({
    where: {
      id: { in: paymentIds },
      status: 'SCHEDULED',
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
    throw new Error('Some payments are not found or not in SCHEDULED status');
  }

  // Calculate total batch amount
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

  // Create payment batch
  const batch = await prisma.paymentBatch.create({
    data: {
      batch_number: generateBatchNumber(),
      total_amount: totalAmount,
      payment_count: payments.length,
      status: 'PENDING',
      created_by: userId,
      payments: {
        connect: paymentIds.map((id) => ({ id })),
      },
    },
  });

  // Update payments to link to batch
  await prisma.payment.updateMany({
    where: {
      id: { in: paymentIds },
    },
    data: {
      batch_id: batch.id,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_CREATED',
      user_id: userId,
      detail: `Payment batch ${batch.batch_number} created with ${payments.length} payments totaling ${totalAmount}`,
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
    throw new Error('Payment batch not found');
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
    throw new Error('Payment batch not found');
  }

  if (batch.status !== 'PENDING') {
    throw new Error('Batch is not in PENDING status');
  }

  // Simulate batch processing (in real scenario, this would integrate with banking system)
  // Update batch status to PROCESSING
  await prisma.paymentBatch.update({
    where: { id: batchId },
    data: { status: 'PROCESSING' },
  });

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
      data: { status: 'PAID' },
    });

    // Create audit log entry for each payment
    await prisma.auditLog.create({
      data: {
        invoice_id: payment.invoice_id,
        action: 'PAYMENT_PROCESSED',
        user_id: userId,
        detail: `Payment ${payment.id} processed in batch ${batch.batch_number}`,
      },
    });
  }

  // Update batch status to COMPLETED
  const updatedBatch = await prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: 'COMPLETED',
      processed_at: new Date(),
      processed_by: userId,
    },
  });

  // Create audit log entry for batch completion
  await prisma.auditLog.create({
    data: {
      action: 'PAYMENT_BATCH_PROCESSED',
      user_id: userId,
      detail: `Payment batch ${batch.batch_number} processed successfully with ${batch.payments.length} payments`,
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
    throw new Error('Payment batch not found');
  }

  if (batch.status !== 'PENDING') {
    throw new Error('Only PENDING batches can be cancelled');
  }

  // Update batch status to CANCELLED
  const updatedBatch = await prisma.paymentBatch.update({
    where: { id: batchId },
    data: {
      status: 'CANCELLED',
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
      user_id: userId,
      detail: `Payment batch ${batch.batch_number} cancelled: ${reason}`,
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
