import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

export interface SupplierBalance {
  vendor_id: string;
  vendor_name: string;
  outstanding_balance: number;
  currency: string;
  total_invoices: number;
  paid_invoices: number;
  pending_invoices: number;
  last_payment_date?: Date;
  average_payment_days: number;
}

export interface SupplierBalanceReport {
  report_date: Date;
  suppliers: SupplierBalance[];
  total_outstanding: number;
  total_suppliers: number;
}

/**
 * Calculate average payment days for a vendor
 */
async function calculateAveragePaymentDays(vendorId: string): Promise<number> {
  const paidInvoices = await prisma.invoice.findMany({
    where: {
      vendor_id: vendorId,
      status: InvoiceStatus.PAID,
      invoice_date: { not: undefined },
      qb_posted_at: { not: undefined },
    },
    select: {
      invoice_date: true,
      qb_posted_at: true,
    },
  });

  if (paidInvoices.length === 0) return 0;

  const totalDays = paidInvoices.reduce((sum: number, invoice: any) => {
    if (!invoice.invoice_date || !invoice.qb_posted_at) return sum;
    const days = Math.floor((invoice.qb_posted_at.getTime() - invoice.invoice_date.getTime()) / (1000 * 60 * 60 * 24));
    return sum + days;
  }, 0);

  return Math.round(totalDays / paidInvoices.length);
}

/**
 * Get last payment date for a vendor
 */
async function getLastPaymentDate(vendorId: string): Promise<Date | undefined> {
  const lastPayment = await prisma.invoice.findFirst({
    where: {
      vendor_id: vendorId,
      status: InvoiceStatus.PAID,
      qb_posted_at: { not: null },
    },
    orderBy: {
      qb_posted_at: 'desc',
    },
    select: {
      qb_posted_at: true,
    },
  });

  return lastPayment?.qb_posted_at || undefined;
}

/**
 * Generate supplier balance report for all vendors
 */
export async function generateSupplierBalanceReport(): Promise<SupplierBalanceReport> {
  const vendors = await prisma.vendor.findMany({
    include: {
      invoices: {
        where: {
          status: {
            in: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID],
          },
        },
      },
    },
  });

  const suppliers: SupplierBalance[] = [];
  let totalOutstanding = 0;

  for (const vendor of vendors) {
    const invoices = vendor.invoices;
    const paidInvoices = invoices.filter((inv: any) => inv.status === InvoiceStatus.PAID);
    const pendingInvoices = invoices.filter((inv: any) => inv.status !== InvoiceStatus.PAID);
    
    const outstandingBalance = pendingInvoices.reduce((sum: number, inv: any) => sum + Number(inv.total_amount), 0);
    const averagePaymentDays = await calculateAveragePaymentDays(vendor.id);
    const lastPaymentDate = await getLastPaymentDate(vendor.id);

    suppliers.push({
      vendor_id: vendor.id,
      vendor_name: vendor.name,
      outstanding_balance: outstandingBalance,
      currency: 'USD', // Assuming USD for now
      total_invoices: invoices.length,
      paid_invoices: paidInvoices.length,
      pending_invoices: pendingInvoices.length,
      last_payment_date: lastPaymentDate,
      average_payment_days: averagePaymentDays,
    });

    totalOutstanding += outstandingBalance;
  }

  return {
    report_date: new Date(),
    suppliers,
    total_outstanding: totalOutstanding,
    total_suppliers: suppliers.length,
  };
}

/**
 * Get supplier balance for a specific vendor
 */
export async function getSupplierBalance(vendorId: string): Promise<SupplierBalance> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      invoices: {
        where: {
          status: {
            in: [InvoiceStatus.APPROVED, InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID],
          },
        },
      },
    },
  });

  if (!vendor) {
    throw new Error('Vendor not found');
  }

  const invoices = vendor.invoices;
  const paidInvoices = invoices.filter((inv: any) => inv.status === InvoiceStatus.PAID);
  const pendingInvoices = invoices.filter((inv: any) => inv.status !== InvoiceStatus.PAID);
  
  const outstandingBalance = pendingInvoices.reduce((sum: number, inv: any) => sum + Number(inv.total_amount), 0);
  const averagePaymentDays = await calculateAveragePaymentDays(vendor.id);
  const lastPaymentDate = await getLastPaymentDate(vendor.id);

  return {
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    outstanding_balance: outstandingBalance,
    currency: 'USD',
    total_invoices: invoices.length,
    paid_invoices: paidInvoices.length,
    pending_invoices: pendingInvoices.length,
    last_payment_date: lastPaymentDate,
    average_payment_days: averagePaymentDays,
  };
}

/**
 * Get suppliers with outstanding balances above a threshold
 */
export async function getSuppliersWithHighBalance(threshold: number): Promise<SupplierBalance[]> {
  const report = await generateSupplierBalanceReport();
  
  return report.suppliers.filter(supplier => supplier.outstanding_balance >= threshold);
}

/**
 * Get supplier balance summary statistics
 */
export async function getSupplierBalanceSummary() {
  const report = await generateSupplierBalanceReport();

  const highBalanceSuppliers = report.suppliers.filter(s => s.outstanding_balance > 10000);
  const zeroBalanceSuppliers = report.suppliers.filter(s => s.outstanding_balance === 0);

  return {
    total_suppliers: report.total_suppliers,
    total_outstanding: report.total_outstanding,
    high_balance_suppliers: highBalanceSuppliers.length,
    zero_balance_suppliers: zeroBalanceSuppliers.length,
    average_balance: report.total_suppliers > 0 ? report.total_outstanding / report.total_suppliers : 0,
  };
}
