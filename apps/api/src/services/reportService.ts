import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

export interface InvoiceVolumeReport {
  date: string;
  total_invoices: number;
  approved_invoices: number;
  rejected_invoices: number;
  pending_invoices: number;
  total_amount: number;
}

export interface PaymentStatusReport {
  status: string;
  count: number;
  total_amount: number;
}

export interface VendorSpendingReport {
  vendor_id: string;
  vendor_name: string;
  total_invoices: number;
  total_amount: number;
  average_amount: number;
}

export interface ExceptionRateReport {
  date: string;
  total_invoices: number;
  invoices_with_exceptions: number;
  exception_rate: number;
}

export interface KPIMetrics {
  total_invoices: number;
  pending_approvals: number;
  pending_exceptions: number;
  scheduled_payments: number;
  total_amount_pending: number;
  approval_rate: number;
  average_processing_time: number;
}

export async function getInvoiceVolumeReport(startDate: Date, endDate: Date): Promise<InvoiceVolumeReport[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      created_at: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      created_at: true,
      status: true,
      total_amount: true,
    },
  });

  const reportMap = new Map<string, InvoiceVolumeReport>();

  invoices.forEach(invoice => {
    const date = invoice.created_at.toISOString().split('T')[0];
    
    if (!reportMap.has(date)) {
      reportMap.set(date, {
        date,
        total_invoices: 0,
        approved_invoices: 0,
        rejected_invoices: 0,
        pending_invoices: 0,
        total_amount: 0,
      });
    }

    const report = reportMap.get(date)!;
    report.total_invoices++;
    report.total_amount += Number(invoice.total_amount);

    switch (invoice.status) {
      case InvoiceStatus.APPROVED:
        report.approved_invoices++;
        break;
      case InvoiceStatus.REJECTED:
        report.rejected_invoices++;
        break;
      case InvoiceStatus.VALIDATION_PENDING:
      case InvoiceStatus.PENDING_COORDINATOR:
        report.pending_invoices++;
        break;
    }
  });

  return Array.from(reportMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getPaymentStatusReport(): Promise<PaymentStatusReport[]> {
  const paymentBatches = await prisma.paymentBatch.findMany({
    select: {
      status: true,
      total_amount: true,
    },
  });

  const reportMap = new Map<string, PaymentStatusReport>();

  paymentBatches.forEach(batch => {
    if (!reportMap.has(batch.status)) {
      reportMap.set(batch.status, {
        status: batch.status,
        count: 0,
        total_amount: 0,
      });
    }

    const report = reportMap.get(batch.status)!;
    report.count++;
    report.total_amount += Number(batch.total_amount);
  });

  return Array.from(reportMap.values());
}

export async function getVendorSpendingReport(limit: number = 20): Promise<VendorSpendingReport[]> {
  const invoices = await prisma.invoice.groupBy({
    by: ['vendor_id'],
    _count: {
      id: true,
    },
    _sum: {
      total_amount: true,
    },
    orderBy: {
      _sum: {
        total_amount: 'desc',
      },
    },
    take: limit,
  });

  const vendorIds = invoices.map(i => i.vendor_id).filter((id): id is string => id !== null);
  const vendors = await prisma.vendor.findMany({
    where: {
      id: {
        in: vendorIds,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const vendorMap = new Map(vendors.map(v => [v.id, v.name]));

  return invoices
    .filter(invoice => invoice.vendor_id !== null)
    .map(invoice => ({
      vendor_id: invoice.vendor_id as string,
      vendor_name: vendorMap.get(invoice.vendor_id as string) || 'Unknown',
      total_invoices: (invoice._count as any)?.id || 0,
      total_amount: Number(invoice._sum?.total_amount || 0),
      average_amount: invoice._sum?.total_amount ? Number(invoice._sum.total_amount) / ((invoice._count as any)?.id || 1) : 0,
    }));
}

export async function getExceptionRateReport(startDate: Date, endDate: Date): Promise<ExceptionRateReport[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      created_at: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      exceptions: true,
    },
  });

  const reportMap = new Map<string, ExceptionRateReport>();

  invoices.forEach(invoice => {
    const date = invoice.created_at.toISOString().split('T')[0];
    
    if (!reportMap.has(date)) {
      reportMap.set(date, {
        date,
        total_invoices: 0,
        invoices_with_exceptions: 0,
        exception_rate: 0,
      });
    }

    const report = reportMap.get(date)!;
    report.total_invoices++;
    
    if (invoice.exceptions.length > 0) {
      report.invoices_with_exceptions++;
    }

    report.exception_rate = (report.invoices_with_exceptions / report.total_invoices) * 100;
  });

  return Array.from(reportMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getKPIMetrics(): Promise<KPIMetrics> {
  const [
    totalInvoices,
    pendingApprovals,
    pendingExceptions,
    scheduledPayments,
    approvedInvoices,
    rejectedInvoices,
  ] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: InvoiceStatus.PENDING_COORDINATOR } }),
    prisma.exception.count({ where: { resolved_at: null } }),
    prisma.paymentBatch.count({ where: { status: 'DRAFT' } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.APPROVED } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.REJECTED } }),
  ]);

  const scheduledPaymentsData = await prisma.paymentBatch.findMany({
    where: { status: 'DRAFT' },
    select: { total_amount: true },
  });

  const totalAmountPending = scheduledPaymentsData.reduce((sum: number, p: any) => sum + Number(p.total_amount), 0);

  const totalProcessed = approvedInvoices + rejectedInvoices;
  const approvalRate = totalProcessed > 0 ? (approvedInvoices / totalProcessed) * 100 : 0;

  // Calculate average processing time (days from creation to approval)
  const approvedInvoicesWithDates = await prisma.invoice.findMany({
    where: { status: InvoiceStatus.APPROVED },
    select: {
      created_at: true,
      updated_at: true,
    },
  });

  const processingTimes = approvedInvoicesWithDates.map(invoice => {
    const diffTime = invoice.updated_at.getTime() - invoice.created_at.getTime();
    return diffTime / (1000 * 60 * 60 * 24); // Convert to days
  });

  const averageProcessingTime = processingTimes.length > 0
    ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
    : 0;

  return {
    total_invoices: totalInvoices,
    pending_approvals: pendingApprovals,
    pending_exceptions: pendingExceptions,
    scheduled_payments: scheduledPayments,
    total_amount_pending: totalAmountPending,
    approval_rate: approvalRate,
    average_processing_time: averageProcessingTime,
  };
}
