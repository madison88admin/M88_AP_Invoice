import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PaymentBatchStatus, CITIBUSINESS_EXPORT_CONFIG } from '@ap-invoice/shared';
import { logger } from '../utils/logger';

/**
 * Generate a CitiBusiness-compatible CSV file for a payment batch.
 * Manual export — Accounting Associate downloads the file and imports it into CitiBusiness.
 */
export async function exportBatchToCitiBusiness(batchId: string): Promise<{ csv: string; filename: string; batch_number: string; payment_count: number; total_amount: number }> {
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

  if (batch.status !== PaymentBatchStatus.APPROVED && batch.status !== PaymentBatchStatus.PROCESSED) {
    throw new AppError('Batch must be APPROVED or PROCESSED to export for CitiBusiness', 400);
  }

  const delimiter = CITIBUSINESS_EXPORT_CONFIG.DELIMITER;
  const rows: string[] = [];

  // Header row
  if (CITIBUSINESS_EXPORT_CONFIG.INCLUDE_HEADER) {
    rows.push([
      'BatchNumber',
      'PaymentDate',
      'VendorName',
      'VendorBankName',
      'VendorBankAddress',
      'VendorSwiftCode',
      'VendorAccountNumber',
      'InvoiceNumber',
      'Amount',
      'Currency',
      'PaymentReference',
    ].join(delimiter));
  }

  // Data rows
  for (const payment of batch.payments as any[]) {
    const vendor = payment.invoice?.vendor;
    const paymentDate = payment.payment_date
      ? payment.payment_date.toISOString().split('T')[0]
      : '';

    rows.push([
      batch.batch_number,
      paymentDate,
      escapeCsv(vendor?.name || ''),
      escapeCsv(vendor?.bank_name || ''),
      escapeCsv(vendor?.bank_address || ''),
      vendor?.swift_code || '',
      vendor?.account_number || '',
      payment.invoice?.invoice_number || '',
      Number(payment.amount).toFixed(2),
      payment.currency || 'USD',
      payment.reference || '',
    ].join(delimiter));
  }

  const csv = rows.join('\n');
  const filename = `CitiBusiness_${batch.batch_number}_${new Date().toISOString().split('T')[0]}.csv`;

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'CITIBUSINESS_EXPORT',
      performed_by: 'system',
      note: `Payment batch ${batch.batch_number} exported to CitiBusiness CSV. ${batch.payments.length} payments, total $${Number(batch.total_amount).toFixed(2)}.`,
    },
  });

  logger.info(`CitiBusiness export generated for batch ${batch.batch_number}: ${batch.payments.length} payments`);

  return {
    csv,
    filename,
    batch_number: batch.batch_number,
    payment_count: batch.payments.length,
    total_amount: Number(batch.total_amount),
  };
}

/**
 * Export all approved/processed batches within a date range.
 */
export async function exportMultipleBatchesToCitiBusiness(startDate?: Date, endDate?: Date): Promise<{ csv: string; filename: string; batch_count: number; total_amount: number }> {
  const where: any = {
    status: { in: [PaymentBatchStatus.APPROVED, PaymentBatchStatus.PROCESSED] },
  };

  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at.gte = startDate;
    if (endDate) where.created_at.lte = endDate;
  }

  const batches = await prisma.paymentBatch.findMany({
    where,
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
    orderBy: { created_at: 'asc' },
  });

  if (batches.length === 0) {
    throw new AppError('No approved/processed batches found for export', 404);
  }

  const delimiter = CITIBUSINESS_EXPORT_CONFIG.DELIMITER;
  const rows: string[] = [];

  if (CITIBUSINESS_EXPORT_CONFIG.INCLUDE_HEADER) {
    rows.push([
      'BatchNumber',
      'PaymentDate',
      'VendorName',
      'VendorBankName',
      'VendorBankAddress',
      'VendorSwiftCode',
      'VendorAccountNumber',
      'InvoiceNumber',
      'Amount',
      'Currency',
      'PaymentReference',
    ].join(delimiter));
  }

  let totalAmount = 0;

  for (const batch of batches as any[]) {
    for (const payment of batch.payments as any[]) {
      const vendor = payment.invoice?.vendor;
      const paymentDate = payment.payment_date
        ? payment.payment_date.toISOString().split('T')[0]
        : '';

      rows.push([
        batch.batch_number,
        paymentDate,
        escapeCsv(vendor?.name || ''),
        escapeCsv(vendor?.bank_name || ''),
        escapeCsv(vendor?.bank_address || ''),
        vendor?.swift_code || '',
        vendor?.account_number || '',
        payment.invoice?.invoice_number || '',
        Number(payment.amount).toFixed(2),
        payment.currency || 'USD',
        payment.reference || '',
      ].join(delimiter));

      totalAmount += Number(payment.amount);
    }
  }

  const csv = rows.join('\n');
  const filename = `CitiBusiness_Export_${new Date().toISOString().split('T')[0]}.csv`;

  await prisma.auditLog.create({
    data: {
      action: 'CITIBUSINESS_BULK_EXPORT',
      performed_by: 'system',
      note: `${batches.length} payment batches exported to CitiBusiness CSV. Total: $${totalAmount.toFixed(2)}.`,
    },
  });

  logger.info(`CitiBusiness bulk export: ${batches.length} batches, total $${totalAmount.toFixed(2)}`);

  return {
    csv,
    filename,
    batch_count: batches.length,
    total_amount: totalAmount,
  };
}

function escapeCsv(value: string): string {
  if (!value) return '';
  // Wrap in double quotes if contains delimiter, quote, or newline
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
