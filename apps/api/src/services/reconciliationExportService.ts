import prisma from '../config/database';
import { PaymentBatchStatus } from '@ap-invoice/shared';
import * as XLSX from 'xlsx';
import { logger } from '../utils/logger';

/**
 * Payment-batch reconciliation Excel — for reconciling payments against the
 * bank statement and payment confirmations. Covers MULTIPLE batches over a
 * period (unlike the per-vendor export, which is one batch).
 *
 * Bank charges (applied at batch time, one per vendor per batch) are included:
 * a Bank Charge column on every payment row, a dedicated "Bank Charges" sheet,
 * and per-currency totals that sum payments + bank charges so the recon total
 * matches each batch's grand total.
 *
 * Sheets:
 *   - "Payments": one row per payment in a batch + per-currency TOTAL rows
 *   - "Bank Charges": one row per charged payment
 *   - "Batches": per-batch summary (payments, bank charge, grand total)
 */
export interface ReconciliationFilters {
  status?: string;
  dateFrom?: string; // batch created_at range
  dateTo?: string;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().split('T')[0];
}

const SOURCE_LABELS: Record<string, string> = {
  DUE_DATE: 'From due date',
  MANUAL: 'Manual',
  DEFAULT: 'Default (no due date)',
};

export async function exportPaymentReconciliation(filters: ReconciliationFilters = {}, userId?: string) {
  const createdRange: { gte?: Date; lte?: Date } = {};
  if (filters.dateFrom) createdRange.gte = new Date(filters.dateFrom);
  if (filters.dateTo) createdRange.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);

  const batches = await prisma.paymentBatch.findMany({
    where: {
      ...(filters.dateFrom || filters.dateTo ? { created_at: createdRange } : {}),
      ...(filters.status ? { status: filters.status as any } : {}),
    },
    include: {
      payments: {
        include: {
          invoice: { include: { vendor: true } },
          bill_stub: true,
        },
        orderBy: { payment_date: 'asc' },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  // ── Payments sheet ────────────────────────────────────────────────────────
  const paymentRows: any[] = [];
  const chargedRows: any[] = [];
  const perCurrency = new Map<string, { payments: number; charges: number }>();

  for (const batch of batches) {
    for (const p of batch.payments as any[]) {
      const currency = p.currency || 'USD';
      const entry = perCurrency.get(currency) || { payments: 0, charges: 0 };
      const amount = Number(p.amount) || 0;
      const charge = p.bank_charge_amount != null ? Number(p.bank_charge_amount) || 0 : 0;
      entry.payments += amount;
      entry.charges += charge;
      perCurrency.set(currency, entry);

      paymentRows.push({
        'Batch #': batch.batch_number,
        'Invoice #': p.invoice?.invoice_number || '',
        'Vendor': p.invoice?.vendor?.name || '',
        'Amount': amount,
        'Bank Charge': charge,
        'Total (incl. Charge)': Math.round((amount + charge) * 100) / 100,
        'Currency': currency,
        'Payment Date': fmtDate(p.payment_date),
        'Payment Source': SOURCE_LABELS[p.payment_date_source] || p.payment_date_source || '',
        'Reference': p.bill_stub?.reference || p.reference || '',
        'Paid Date': fmtDate(p.paid_at),
        'Payment Status': p.status,
        'Batch Status': batch.status,
      });

      if (charge > 0) {
        chargedRows.push({
          'Batch #': batch.batch_number,
          'Invoice #': p.invoice?.invoice_number || '',
          'Vendor': p.invoice?.vendor?.name || '',
          'Currency': currency,
          'Bank Charge': charge,
          'Note': p.bank_charge_note || '',
          'Batch Status': batch.status,
        });
      }
    }
  }

  // Per-currency TOTAL rows — payments, bank charges, and the grand total so
  // the reconciliation matches the batch amounts (which include the fee).
  for (const [currency, totals] of perCurrency) {
    paymentRows.push({
      'Batch #': '',
      'Invoice #': `TOTAL (${currency})`,
      'Vendor': '',
      'Amount': Math.round(totals.payments * 100) / 100,
      'Bank Charge': Math.round(totals.charges * 100) / 100,
      'Total (incl. Charge)': Math.round((totals.payments + totals.charges) * 100) / 100,
      'Currency': currency,
      'Payment Date': '',
      'Payment Source': '',
      'Reference': '',
      'Paid Date': '',
      'Payment Status': '',
      'Batch Status': '',
    });
  }

  // ── Batches sheet ─────────────────────────────────────────────────────────
  const batchRows = batches.map((batch) => {
    const paymentsTotal = (batch.payments as any[]).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    const chargesTotal = (batch.payments as any[]).reduce((s: number, p: any) => s + (p.bank_charge_amount != null ? Number(p.bank_charge_amount) || 0 : 0), 0);
    return {
      'Batch #': batch.batch_number,
      'Created': fmtDate(batch.created_at),
      'Payments': batch.payment_count || (batch.payments as any[]).length,
      'Payments Total': Math.round(paymentsTotal * 100) / 100,
      'Bank Charge': Math.round(chargesTotal * 100) / 100,
      'Grand Total (incl. Charge)': Math.round((paymentsTotal + chargesTotal) * 100) / 100,
      'Status': batch.status,
      'Processed At': fmtDate(batch.processed_at),
    };
  });

  // ── Workbook ──────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsPayments = XLSX.utils.json_to_sheet(paymentRows, {
    header: ['Batch #', 'Invoice #', 'Vendor', 'Amount', 'Bank Charge', 'Total (incl. Charge)', 'Currency', 'Payment Date', 'Payment Source', 'Reference', 'Paid Date', 'Payment Status', 'Batch Status'],
  });
  wsPayments['!cols'] = [
    { wch: 16 }, { wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
    { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPayments, 'Payments');

  const wsCharges = XLSX.utils.json_to_sheet(chargedRows, {
    header: ['Batch #', 'Invoice #', 'Vendor', 'Currency', 'Bank Charge', 'Note', 'Batch Status'],
  });
  wsCharges['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 40 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsCharges, 'Bank Charges');

  const wsBatches = XLSX.utils.json_to_sheet(batchRows, {
    header: ['Batch #', 'Created', 'Payments', 'Payments Total', 'Bank Charge', 'Grand Total (incl. Charge)', 'Status', 'Processed At'],
  });
  wsBatches['!cols'] = [
    { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsBatches, 'Batches');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const batchCount = batches.length;
  const paymentCount = paymentRows.length - perCurrency.size;
  const bankChargeTotal = Math.round(Array.from(perCurrency.values()).reduce((s, t) => s + t.charges, 0) * 100) / 100;

  await prisma.auditLog.create({
    data: {
      action: 'RECONCILIATION_EXPORT',
      performed_by: userId || 'system',
      note: `Payment reconciliation export: ${batchCount} batch(es), ${paymentCount} payment(s), bank charges ${bankChargeTotal.toFixed(2)}`,
    },
  });

  logger.info(`Payment reconciliation export: ${batchCount} batches, ${paymentCount} payments, bank charges ${bankChargeTotal}`);

  return {
    buffer,
    filename: `payment-reconciliation-${new Date().toISOString().split('T')[0]}.xlsx`,
    batchCount,
    paymentCount,
    bankChargeTotal,
  };
}
