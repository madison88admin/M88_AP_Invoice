import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { PaymentBatchStatus } from '@ap-invoice/shared';
import * as XLSX from 'xlsx';
import { logger } from '../utils/logger';

/**
 * Export a payment batch as a single Excel file.
 *
 * A batch may combine payments from multiple vendors, so this produces ONE
 * Excel file where each row carries ITS OWN vendor's bank details, plus a
 * TOTAL row. The Summary sheet lists every vendor in the batch.
 *
 * Worksheet structure:
 *  - "Payments" sheet: all invoice rows (per-row vendor bank details) + TOTAL row
 *  - "Summary" sheet: batch metadata (batch number, vendors, count, total)
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

  // A batch may combine multiple vendors — each payment row carries its own
  // vendor's bank details; the summary lists all distinct vendors.
  const distinctVendors = Array.from(new Map(
    (batch.payments as any[]).map((p: any) => [p.invoice?.vendor_id ?? 'unknown', p.invoice?.vendor])
  ).values()).filter(Boolean);
  const vendor = distinctVendors[0];
  const vendorNames = distinctVendors.map((v: any) => v.name).join(', ');
  const vendorName = vendorNames || 'Unknown Vendor';
  const singleVendor = distinctVendors.length <= 1;
  const currency = batch.payments[0]?.currency || batch.currency || 'USD';

  // Calculate totals — the batch total includes the bank charge (one per
  // vendor per batch, carried by a single payment).
  const paymentsTotal = batch.payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  const bankChargeTotal = batch.payments.reduce((sum: number, p: any) => sum + (Number(p.bank_charge_amount) || 0), 0);
  const totalAmount = Math.round((paymentsTotal + bankChargeTotal) * 100) / 100;

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
    'Bank Charge': Number(p.bank_charge_amount) || 0,
    'Currency': p.currency || currency,
    'Payment Date': p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : '',
    'Beneficiary Name': p.beneficiary_name_snapshot || '',
    'Bank Name': p.bank_name_snapshot || '',
    'Bank Address': p.bank_address_snapshot || '',
    'SWIFT Code': p.swift_code_snapshot || '',
    'ABA / Routing Number': p.aba_routing_number_snapshot || '',
    'Account Number': p.account_number_snapshot || '',
    'Reference': p.reference || '',
  }));

  // Total row — Amount = payments + bank charge (matches batch total_amount)
  const totalRow = {
    '#': '',
    'Invoice Number': 'TOTAL',
    'MPO Number': '',
    'PO Number': '',
    'Brand': '',
    'Bill To Entity': '',
    'Amount': totalAmount,
    'Bank Charge': bankChargeTotal,
    'Currency': currency,
    'Payment Date': '',
    'Beneficiary Name': '',
    'Bank Name': '',
    'Bank Address': '',
    'SWIFT Code': '',
    'ABA / Routing Number': '',
    'Account Number': '',
    'Reference': '',
  };

  const allRows = [...rows, totalRow];

  const ws = XLSX.utils.json_to_sheet(allRows, {
    header: ['#', 'Invoice Number', 'MPO Number', 'PO Number', 'Brand', 'Bill To Entity', 'Amount', 'Bank Charge', 'Currency', 'Payment Date', 'Beneficiary Name', 'Bank Name', 'Bank Address', 'SWIFT Code', 'ABA / Routing Number', 'Account Number', 'Reference'],
  });

  ws['!cols'] = [
    { wch: 5 },   // #
    { wch: 22 },  // Invoice Number
    { wch: 18 },  // MPO Number
    { wch: 18 },  // PO Number
    { wch: 12 },  // Brand
    { wch: 18 },  // Bill To Entity
    { wch: 14 },  // Amount
    { wch: 12 },  // Bank Charge
    { wch: 10 },  // Currency
    { wch: 14 },  // Payment Date
    { wch: 25 },  // Beneficiary Name
    { wch: 25 },  // Bank Name
    { wch: 30 },  // Bank Address
    { wch: 14 },  // SWIFT Code
    { wch: 20 },  // ABA / Routing Number
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
    ['Vendor(s)', singleVendor ? vendorName : `${vendorName} (${distinctVendors.length} vendors)`],
    ['Beneficiary Name', singleVendor ? (batch.payments[0]?.beneficiary_name_snapshot || '') : 'Multiple — see Payments sheet'],
    ['Bill To Entity', batch.payments[0]?.invoice?.bill_to_entity || ''],
    ['Invoice Count', batch.payments.length],
    ['Payments Total', paymentsTotal],
    ['Bank Charge', bankChargeTotal],
    ['Total Amount (incl. Bank Charge)', totalAmount],
    ['Currency', currency],
    ['Bank Name', singleVendor ? (batch.payments[0]?.bank_name_snapshot || '') : 'Multiple — see Payments sheet'],
    ['Bank Address', singleVendor ? (batch.payments[0]?.bank_address_snapshot || '') : 'Multiple — see Payments sheet'],
    ['SWIFT Code', singleVendor ? (batch.payments[0]?.swift_code_snapshot || '') : 'Multiple — see Payments sheet'],
    ['ABA / Routing Number', singleVendor ? (batch.payments[0]?.aba_routing_number_snapshot || '') : 'Multiple — see Payments sheet'],
    ['Account Number', singleVendor ? (batch.payments[0]?.account_number_snapshot || '') : 'Multiple — see Payments sheet'],
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

  // Sanitize vendor name for filename (multi-vendor batches get a generic name)
  const safeVendorName = singleVendor
    ? vendorName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)
    : 'multi_vendor';
  const filename = `${batch.batch_number}_${safeVendorName}.xlsx`;

  return {
    buffer,
    filename,
    vendorName,
    paymentCount: batch.payments.length,
    totalAmount,
  };
}
