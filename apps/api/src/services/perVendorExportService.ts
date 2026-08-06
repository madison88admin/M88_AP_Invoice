import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PaymentBatchStatus } from '@ap-invoice/shared';
import * as XLSX from 'xlsx';
import { logger } from '../utils/logger';

/**
 * Export a payment batch as a single Excel file.
 *
 * Since each payment batch already enforces single vendor + single currency +
 * single beneficiary account + single legal entity (see createPaymentBatch),
 * this produces ONE Excel file with all invoices for that vendor + a TOTAL row.
 *
 * Worksheet structure:
 *  - "Payments" sheet: all invoice rows + TOTAL row at the bottom
 *  - "Summary" sheet: batch metadata (batch number, vendor, count, total)
 */
export async function exportBatchPerVendor(batchId: string, userId?: string): Promise<{
  buffer: Buffer;
  filename: string;
  vendorName: string;
  paymentCount: number;
  totalAmount: number;
}> {
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
        orderBy: { payment_date: 'asc' },
      },
    },
  });

  if (!batch) {
    throw new AppError('Payment batch not found', 404);
  }

  if (batch.payments.length === 0) {
    throw new AppError('Payment batch has no payments', 400);
  }

  // Batch must be reviewed by Accounting Supervisor before export
  if (![PaymentBatchStatus.REVIEWED, PaymentBatchStatus.EXPORTED_TO_BANK, PaymentBatchStatus.PROCESSED].includes(batch.status as any)) {
    throw new AppError('Batch must be reviewed by Accounting Supervisor before export', 400);
  }

  // All payments in a batch share the same vendor (enforced at creation)
  const vendor = batch.payments[0]?.invoice?.vendor;
  const vendorName = vendor?.name || 'Unknown Vendor';
  const currency = batch.payments[0]?.currency || batch.currency || 'USD';

  // Calculate total
  const totalAmount = batch.payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);

  // Build workbook
  const wb = XLSX.utils.book_new();

  // --- Payments sheet ---
  const rows = batch.payments.map((p: any, idx: number) => ({
    '#': idx + 1,
    'Invoice Number': p.invoice?.invoice_number || '',
    'MPO Number': p.invoice?.mpo_number || '',
    'PO Number': p.invoice?.customer_po_number || '',
    'Brand': p.invoice?.brand || '',
    'Bill To Entity': p.invoice?.bill_to_entity || '',
    'Amount': Number(p.amount) || 0,
    'Currency': p.currency || currency,
    'Payment Date': p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : '',
    'Beneficiary Name': vendor?.beneficiary_name || vendor?.name || '',
    'Bank Name': vendor?.bank_name || '',
    'Bank Address': vendor?.bank_address || '',
    'SWIFT Code': vendor?.swift_code || '',
    'Account Number': vendor?.account_number || '',
    'Reference': p.reference || '',
  }));

  // Total row
  const totalRow = {
    '#': '',
    'Invoice Number': 'TOTAL',
    'MPO Number': '',
    'PO Number': '',
    'Brand': '',
    'Bill To Entity': '',
    'Amount': totalAmount,
    'Currency': currency,
    'Payment Date': '',
    'Beneficiary Name': '',
    'Bank Name': '',
    'Bank Address': '',
    'SWIFT Code': '',
    'Account Number': '',
    'Reference': '',
  };

  const allRows = [...rows, totalRow];

  const ws = XLSX.utils.json_to_sheet(allRows, {
    header: ['#', 'Invoice Number', 'MPO Number', 'PO Number', 'Brand', 'Bill To Entity', 'Amount', 'Currency', 'Payment Date', 'Beneficiary Name', 'Bank Name', 'Bank Address', 'SWIFT Code', 'Account Number', 'Reference'],
  });

  ws['!cols'] = [
    { wch: 5 },   // #
    { wch: 22 },  // Invoice Number
    { wch: 18 },  // MPO Number
    { wch: 18 },  // PO Number
    { wch: 12 },  // Brand
    { wch: 18 },  // Bill To Entity
    { wch: 14 },  // Amount
    { wch: 10 },  // Currency
    { wch: 14 },  // Payment Date
    { wch: 25 },  // Beneficiary Name
    { wch: 25 },  // Bank Name
    { wch: 30 },  // Bank Address
    { wch: 14 },  // SWIFT Code
    { wch: 20 },  // Account Number
    { wch: 20 },  // Reference
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Payments');

  // --- Summary sheet ---
  const summaryData = [
    ['Madison 88 — Payment Batch Export'],
    [''],
    ['Batch Number', batch.batch_number],
    ['Batch Date', batch.created_at.toISOString().split('T')[0]],
    ['Vendor', vendorName],
    ['Beneficiary Name', vendor?.beneficiary_name || vendor?.name || ''],
    ['Bill To Entity', batch.payments[0]?.invoice?.bill_to_entity || ''],
    ['Invoice Count', batch.payments.length],
    ['Total Amount', totalAmount],
    ['Currency', currency],
    ['Bank Name', vendor?.bank_name || ''],
    ['Bank Address', vendor?.bank_address || ''],
    ['SWIFT Code', vendor?.swift_code || ''],
    ['Account Number', vendor?.account_number || ''],
    ['Status', batch.status],
    ['Generated', new Date().toISOString()],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 22 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Generate Excel buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'PER_VENDOR_EXPORT',
      performed_by: userId || 'system',
      note: `Payment batch ${batch.batch_number} exported as Excel. Vendor: ${vendorName}, ${batch.payments.length} payments, total ${currency} ${totalAmount.toFixed(2)}.`,
    },
  });

  logger.info(`Per-vendor export: batch ${batch.batch_number}, vendor ${vendorName}, ${batch.payments.length} payments, total ${totalAmount.toFixed(2)}`);

  // Sanitize vendor name for filename
  const safeVendorName = vendorName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  const filename = `${batch.batch_number}_${safeVendorName}.xlsx`;

  return {
    buffer,
    filename,
    vendorName,
    paymentCount: batch.payments.length,
    totalAmount,
  };
}
