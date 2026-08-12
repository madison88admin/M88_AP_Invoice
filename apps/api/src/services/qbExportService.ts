import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';
import * as XLSX from 'xlsx';
import { deriveGLAccount, deriveQBMemo } from './postingService';
import { logger } from '../utils/logger';

/**
 * Real QuickBooks export — replaces the simulated sync (no live QB API).
 *
 * Produces an Excel workbook of posted invoices as BILLS that the Accounting
 * Associate imports into QuickBooks manually:
 *   - "QB Bills" sheet: one row per invoice (vendor, amount, memo, GL account,
 *     GL class, dates, MPO/brand/entity)
 *   - "Bill Lines" sheet: line-level detail grouped by MPO (mirrors how
 *     posting groups lines into QB lines)
 *   - "Summary" sheet: counts + totals
 */
export interface QBBillExportFilters {
  status?: string;
  dateFrom?: string; // invoice_date range
  dateTo?: string;
}

function fmtDate(d: Date | string): string {
  return new Date(d).toISOString().split('T')[0];
}

export async function exportQBBills(filters: QBBillExportFilters = {}, userId?: string) {
  const statuses = filters.status
    ? [filters.status]
    : [InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID];

  const invoiceDateRange: { gte?: Date; lte?: Date } = {};
  if (filters.dateFrom) invoiceDateRange.gte = new Date(filters.dateFrom);
  if (filters.dateTo) invoiceDateRange.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: statuses as any },
      ...(filters.dateFrom || filters.dateTo ? { invoice_date: invoiceDateRange } : {}),
    },
    include: {
      vendor: true,
      invoice_lines: { orderBy: { line_number: 'asc' } },
    },
    orderBy: { qb_posted_at: 'desc' },
  });

  // ── Bill-level rows ───────────────────────────────────────────────────────
  const billRows = invoices.map((invoice: any) => {
    const vendor = invoice.vendor;
    return {
      'Invoice #': invoice.invoice_number || '',
      'Vendor': vendor?.name || '',
      'Beneficiary Name': vendor?.beneficiary_name || vendor?.name || '',
      'Vendor Account #': vendor?.account_number || '',
      'Invoice Date': invoice.invoice_date ? fmtDate(invoice.invoice_date) : '',
      'Due Date': invoice.due_date ? fmtDate(invoice.due_date) : '',
      'Amount': Number(invoice.total_amount) || 0,
      'Currency': invoice.currency || 'USD',
      'Memo / Description': deriveQBMemo(invoice),
      'GL Account': deriveGLAccount(invoice.invoice_type),
      'GL Class': vendor?.supplier_location || '',
      'MPO #': invoice.mpo_number || '',
      'PO #': invoice.customer_po_number || '',
      'Brand': invoice.brand || invoice.brand_code || '',
      'Bill To Entity': invoice.bill_to_entity || '',
      'Status': invoice.status,
      'Posted At': invoice.qb_posted_at ? fmtDate(invoice.qb_posted_at) : '',
    };
  });

  // ── Line-level rows (grouped by MPO, same as posting) ─────────────────────
  const lineRows: any[] = [];
  for (const invoice of invoices as any[]) {
    const memo = deriveQBMemo(invoice);
    if (!invoice.invoice_lines || invoice.invoice_lines.length === 0) {
      lineRows.push({
        'Invoice #': invoice.invoice_number || '',
        'MPO Ref': invoice.mpo_number || '',
        'Description': memo,
        'Amount': Number(invoice.total_amount) || 0,
      });
      continue;
    }
    const mpoGroups = new Map<string, { mpo: string; amount: number; count: number }>();
    for (const line of invoice.invoice_lines) {
      const mpoKey = line.mpo_base_number || invoice.mpo_number || 'NO_MPO';
      const group = mpoGroups.get(mpoKey) || { mpo: mpoKey, amount: 0, count: 0 };
      group.amount += Number(line.line_amount) || 0;
      group.count += 1;
      mpoGroups.set(mpoKey, group);
    }
    for (const group of mpoGroups.values()) {
      lineRows.push({
        'Invoice #': invoice.invoice_number || '',
        'MPO Ref': group.mpo,
        'Description': `${memo} | MPO: ${group.mpo} (${group.count} line(s))`,
        'Amount': Math.round(group.amount * 100) / 100,
      });
    }
  }

  const totalAmount = Math.round(billRows.reduce((sum: number, r: any) => sum + Number(r['Amount'] || 0), 0) * 100) / 100;
  const currencies = Array.from(new Set(billRows.map((r: any) => r['Currency']))).filter(Boolean).join(', ');

  // ── Workbook ──────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.json_to_sheet(billRows, {
    header: ['Invoice #', 'Vendor', 'Beneficiary Name', 'Vendor Account #', 'Invoice Date', 'Due Date', 'Amount', 'Currency', 'Memo / Description', 'GL Account', 'GL Class', 'MPO #', 'PO #', 'Brand', 'Bill To Entity', 'Status', 'Posted At'],
  });
  ws['!cols'] = [
    { wch: 22 }, { wch: 30 }, { wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 10 }, { wch: 40 }, { wch: 28 }, { wch: 18 }, { wch: 20 },
    { wch: 18 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'QB Bills');

  const wsLines = XLSX.utils.json_to_sheet(lineRows, {
    header: ['Invoice #', 'MPO Ref', 'Description', 'Amount'],
  });
  wsLines['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 60 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsLines, 'Bill Lines');

  const summaryData = [
    ['Madison 88 — QuickBooks Bills Export'],
    [''],
    ['Generated', new Date().toISOString()],
    ['Bill Count', billRows.length],
    ['Total Amount', totalAmount],
    ['Currencies', currencies],
    ['Status Filter', filters.status || 'POSTED_TO_QB + PAYMENT_SCHEDULED + PAID'],
    ['Note', 'Manual import into QuickBooks — no live QB API call'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  await prisma.auditLog.create({
    data: {
      action: 'QB_BILLS_EXPORT',
      performed_by: userId || 'system',
      note: `QB Bills export generated: ${billRows.length} bill(s), total ${currencies} ${totalAmount.toFixed(2)}`,
    },
  });

  logger.info(`QB Bills export: ${billRows.length} bills, total ${totalAmount.toFixed(2)}`);

  return {
    buffer,
    filename: `qb-bills-${new Date().toISOString().split('T')[0]}.xlsx`,
    billCount: billRows.length,
    totalAmount,
  };
}
