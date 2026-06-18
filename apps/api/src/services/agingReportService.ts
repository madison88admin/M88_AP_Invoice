import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

export interface AgingBucket {
  bucket: 'CURRENT' | '30_DAYS' | '60_DAYS' | '90_PLUS';
  count: number;
  total_amount: number;
  invoices: Array<{
    invoice_id: string;
    invoice_number: string;
    vendor_name: string;
    amount: number;
    currency: string;
    due_date: Date;
    days_overdue: number;
  }>;
}

export interface AgingReport {
  reportDate: Date;
  buckets: AgingBucket[];
  totalAmount: number;
  totalCount: number;
}

/**
 * Calculate aging bucket based on days overdue
 */
function getAgingBucket(daysOverdue: number): 'CURRENT' | '30_DAYS' | '60_DAYS' | '90_PLUS' {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '30_DAYS';
  if (daysOverdue <= 60) return '60_DAYS';
  return '90_PLUS';
}

/**
 * Calculate days overdue for an invoice
 */
function calculateDaysOverdue(dueDate: Date): number {
  const today = new Date();
  const due = new Date(dueDate);
  const diffTime = today.getTime() - due.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Generate aging report for all unpaid invoices
 */
export async function generateAgingReport(): Promise<AgingReport> {
  const unpaidInvoices = await prisma.invoice.findMany({
    where: {
      status: {
        in: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED],
      },
      due_date: {
        not: null,
      },
    },
    include: {
      vendor: true,
    },
    orderBy: {
      due_date: 'asc',
    },
  });

  const buckets: Record<'CURRENT' | '30_DAYS' | '60_DAYS' | '90_PLUS', AgingBucket> = {
    CURRENT: { bucket: 'CURRENT', count: 0, total_amount: 0, invoices: [] },
    '30_DAYS': { bucket: '30_DAYS', count: 0, total_amount: 0, invoices: [] },
    '60_DAYS': { bucket: '60_DAYS', count: 0, total_amount: 0, invoices: [] },
    '90_PLUS': { bucket: '90_PLUS', count: 0, total_amount: 0, invoices: [] },
  };

  let totalAmount = 0;
  let totalCount = 0;

  for (const invoice of unpaidInvoices) {
    if (!invoice.due_date) continue;

    const daysOverdue = calculateDaysOverdue(invoice.due_date);
    const bucket = getAgingBucket(daysOverdue);

    const invoiceData = {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_name: invoice.vendor?.name || 'Unknown',
      amount: Number(invoice.total_amount),
      currency: invoice.currency,
      due_date: invoice.due_date,
      days_overdue: daysOverdue,
    };

    buckets[bucket].count++;
    buckets[bucket].total_amount += invoiceData.amount;
    buckets[bucket].invoices.push(invoiceData);

    totalAmount += invoiceData.amount;
    totalCount++;
  }

  return {
    reportDate: new Date(),
    buckets: Object.values(buckets),
    totalAmount,
    totalCount,
  };
}

/**
 * Generate aging report for a specific vendor
 */
export async function generateVendorAgingReport(vendorId: string): Promise<AgingReport> {
  const unpaidInvoices = await prisma.invoice.findMany({
    where: {
      vendor_id: vendorId,
      status: {
        in: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED],
      },
      due_date: {
        not: null,
      },
    },
    include: {
      vendor: true,
    },
    orderBy: {
      due_date: 'asc',
    },
  });

  const buckets: Record<'CURRENT' | '30_DAYS' | '60_DAYS' | '90_PLUS', AgingBucket> = {
    CURRENT: { bucket: 'CURRENT', count: 0, total_amount: 0, invoices: [] },
    '30_DAYS': { bucket: '30_DAYS', count: 0, total_amount: 0, invoices: [] },
    '60_DAYS': { bucket: '60_DAYS', count: 0, total_amount: 0, invoices: [] },
    '90_PLUS': { bucket: '90_PLUS', count: 0, total_amount: 0, invoices: [] },
  };

  let totalAmount = 0;
  let totalCount = 0;

  for (const invoice of unpaidInvoices) {
    if (!invoice.due_date) continue;

    const daysOverdue = calculateDaysOverdue(invoice.due_date);
    const bucket = getAgingBucket(daysOverdue);

    const invoiceData = {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_name: invoice.vendor?.name || 'Unknown',
      amount: Number(invoice.total_amount),
      currency: invoice.currency,
      due_date: invoice.due_date,
      days_overdue: daysOverdue,
    };

    buckets[bucket].count++;
    buckets[bucket].total_amount += invoiceData.amount;
    buckets[bucket].invoices.push(invoiceData);

    totalAmount += invoiceData.amount;
    totalCount++;
  }

  return {
    reportDate: new Date(),
    buckets: Object.values(buckets),
    totalAmount,
    totalCount,
  };
}

/**
 * Get aging summary statistics
 */
export async function getAgingSummary() {
  const report = await generateAgingReport();

  return {
    currentAmount: report.buckets.find(b => b.bucket === 'CURRENT')?.total_amount || 0,
    currentCount: report.buckets.find(b => b.bucket === 'CURRENT')?.count || 0,
    thirtyDaysAmount: report.buckets.find(b => b.bucket === '30_DAYS')?.total_amount || 0,
    thirtyDaysCount: report.buckets.find(b => b.bucket === '30_DAYS')?.count || 0,
    sixtyDaysAmount: report.buckets.find(b => b.bucket === '60_DAYS')?.total_amount || 0,
    sixtyDaysCount: report.buckets.find(b => b.bucket === '60_DAYS')?.count || 0,
    ninetyPlusAmount: report.buckets.find(b => b.bucket === '90_PLUS')?.total_amount || 0,
    ninetyPlusCount: report.buckets.find(b => b.bucket === '90_PLUS')?.count || 0,
    totalAmount: report.totalAmount,
    totalCount: report.totalCount,
  };
}

/**
 * Get aging report for a specific date range
 */
export async function getAgingReportByDateRange(startDate: Date, endDate: Date): Promise<AgingReport> {
  const unpaidInvoices = await prisma.invoice.findMany({
    where: {
      status: {
        in: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED],
      },
      due_date: {
        not: null,
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      vendor: true,
    },
    orderBy: {
      due_date: 'asc',
    },
  });

  const buckets: Record<'CURRENT' | '30_DAYS' | '60_DAYS' | '90_PLUS', AgingBucket> = {
    CURRENT: { bucket: 'CURRENT', count: 0, total_amount: 0, invoices: [] },
    '30_DAYS': { bucket: '30_DAYS', count: 0, total_amount: 0, invoices: [] },
    '60_DAYS': { bucket: '60_DAYS', count: 0, total_amount: 0, invoices: [] },
    '90_PLUS': { bucket: '90_PLUS', count: 0, total_amount: 0, invoices: [] },
  };

  let totalAmount = 0;
  let totalCount = 0;

  for (const invoice of unpaidInvoices) {
    if (!invoice.due_date) continue;

    const daysOverdue = calculateDaysOverdue(invoice.due_date);
    const bucket = getAgingBucket(daysOverdue);

    const invoiceData = {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_name: invoice.vendor?.name || 'Unknown',
      amount: Number(invoice.total_amount),
      currency: invoice.currency,
      due_date: invoice.due_date,
      days_overdue: daysOverdue,
    };

    buckets[bucket].count++;
    buckets[bucket].total_amount += invoiceData.amount;
    buckets[bucket].invoices.push(invoiceData);

    totalAmount += invoiceData.amount;
    totalCount++;
  }

  return {
    reportDate: new Date(),
    buckets: Object.values(buckets),
    totalAmount,
    totalCount,
  };
}
