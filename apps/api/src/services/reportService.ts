import prisma from '../config/database';
import { InvoiceStatus, APPROVAL_THRESHOLDS, determineApprovalTier } from '@ap-invoice/shared';

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
  posted_to_qb: number;
  paid_invoices: number;
  on_hold_invoices: number;
  rejected_invoices: number;
  total_approved_amount: number;
  total_posted_amount: number;
  total_paid_amount: number;
}

export interface ForecastReport {
  upcoming_payments: Array<{
    payment_date: string;
    invoice_number: string;
    vendor_name: string;
    amount: number;
    currency: string;
    status: string;
  }>;
  weekly_payment_forecast: Array<{
    week_starting: string;
    total_amount: number;
    payment_count: number;
  }>;
  pending_approval_by_tier: Array<{
    tier: string;
    count: number;
    total_amount: number;
  }>;
  vendor_spending_forecast: Array<{
    vendor_name: string;
    pending_amount: number;
    pending_count: number;
    ytd_total: number;
  }>;
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
      case InvoiceStatus.PENDING_ACCOUNTING:
        report.approved_invoices++;
        break;
      case InvoiceStatus.REJECTED:
        report.rejected_invoices++;
        break;
      case InvoiceStatus.VALIDATION_PENDING:
      case InvoiceStatus.EXCEPTION_FLAGGED:
      case InvoiceStatus.PENDING_COORDINATOR:
      case InvoiceStatus.PENDING_MANAGER:
      case InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER:
      case InvoiceStatus.PENDING_MLO_PLANNING_MANAGER:
      case InvoiceStatus.PENDING_SR_MANAGER:
      case InvoiceStatus.PENDING_POLLY:
      case InvoiceStatus.ON_HOLD:
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
  // All pending approval statuses (3-tier system)
  const pendingApprovalStatuses = [
    InvoiceStatus.PENDING_COORDINATOR,
    InvoiceStatus.PENDING_MANAGER,
    InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
    InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
    InvoiceStatus.PENDING_SR_MANAGER,
    InvoiceStatus.PENDING_POLLY,
    InvoiceStatus.PENDING_ACCOUNTING,
  ];

  const [
    totalInvoices,
    pendingApprovals,
    pendingExceptions,
    scheduledPayments,
    approvedInvoices,
    rejectedInvoices,
    postedToQb,
    paidInvoices,
    onHoldInvoices,
  ] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: { in: pendingApprovalStatuses as any[] } } }),
    prisma.exception.count({ where: { resolved_at: null } }),
    prisma.paymentBatch.count({ where: { status: 'DRAFT' } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.APPROVED } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.REJECTED } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.POSTED_TO_QB } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.PAID } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.ON_HOLD } }),
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

  // Calculate total amounts by status
  const [approvedSum, postedSum, paidSum] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { total_amount: true }, where: { status: InvoiceStatus.APPROVED } }),
    prisma.invoice.aggregate({ _sum: { total_amount: true }, where: { status: InvoiceStatus.POSTED_TO_QB } }),
    prisma.invoice.aggregate({ _sum: { total_amount: true }, where: { status: InvoiceStatus.PAID } }),
  ]);

  return {
    total_invoices: totalInvoices,
    pending_approvals: pendingApprovals,
    pending_exceptions: pendingExceptions,
    scheduled_payments: scheduledPayments,
    total_amount_pending: totalAmountPending,
    approval_rate: approvalRate,
    average_processing_time: averageProcessingTime,
    posted_to_qb: postedToQb,
    paid_invoices: paidInvoices,
    on_hold_invoices: onHoldInvoices,
    rejected_invoices: rejectedInvoices,
    total_approved_amount: Number(approvedSum._sum.total_amount || 0),
    total_posted_amount: Number(postedSum._sum.total_amount || 0),
    total_paid_amount: Number(paidSum._sum.total_amount || 0),
  };
}

/**
 * Forecast report: upcoming payments, weekly forecast, pending approvals by tier,
 * and vendor spending forecast.
 */
export async function getForecastReport(): Promise<ForecastReport> {
  const pendingApprovalStatuses = [
    InvoiceStatus.PENDING_COORDINATOR,
    InvoiceStatus.PENDING_MANAGER,
    InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER,
    InvoiceStatus.PENDING_MLO_PLANNING_MANAGER,
    InvoiceStatus.PENDING_SR_MANAGER,
    InvoiceStatus.PENDING_POLLY,
    InvoiceStatus.PENDING_ACCOUNTING,
  ];

  // 1. Upcoming scheduled payments (next 30 days)
  const upcomingPayments = await prisma.payment.findMany({
    where: {
      status: 'SCHEDULED',
      payment_date: {
        gte: new Date(),
        lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    },
    include: {
      invoice: {
        include: { vendor: true },
      },
    },
    orderBy: { payment_date: 'asc' },
  });

  const upcomingPaymentsFormatted = upcomingPayments.map((p: any) => ({
    payment_date: p.payment_date.toISOString().split('T')[0],
    invoice_number: p.invoice?.invoice_number || '',
    vendor_name: p.invoice?.vendor?.name || 'Unknown',
    amount: Number(p.amount),
    currency: p.currency || 'USD',
    status: p.status,
  }));

  // 2. Weekly payment forecast (group by week)
  const weekMap = new Map<string, { total_amount: number; payment_count: number }>();
  for (const p of upcomingPayments as any[]) {
    const paymentDate = new Date(p.payment_date);
    const day = paymentDate.getDay();
    const monday = new Date(paymentDate);
    monday.setDate(paymentDate.getDate() - ((day + 6) % 7));
    const weekKey = monday.toISOString().split('T')[0];

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, { total_amount: 0, payment_count: 0 });
    }
    const week = weekMap.get(weekKey)!;
    week.total_amount += Number(p.amount);
    week.payment_count++;
  }

  const weeklyPaymentForecast = Array.from(weekMap.entries())
    .map(([week_starting, data]) => ({ week_starting, ...data }))
    .sort((a, b) => a.week_starting.localeCompare(b.week_starting));

  // 3. Pending approvals by tier
  const pendingInvoices = await prisma.invoice.findMany({
    where: { status: { in: pendingApprovalStatuses as any[] } },
    select: { total_amount: true, status: true },
  });

  const tierMap = new Map<string, { count: number; total_amount: number }>();
  for (const inv of pendingInvoices) {
    const tier = determineApprovalTier(Number(inv.total_amount));
    const tierLabel = tier === 1 ? 'Planning Tier (≤$2,000)' : tier === 2 ? 'Tier 2 ($2,001–$99,999)' : 'Tier 3 (≥$100,000)';
    if (!tierMap.has(tierLabel)) {
      tierMap.set(tierLabel, { count: 0, total_amount: 0 });
    }
    const t = tierMap.get(tierLabel)!;
    t.count++;
    t.total_amount += Number(inv.total_amount);
  }

  const pendingApprovalByTier = Array.from(tierMap.entries())
    .map(([tier, data]) => ({ tier, ...data }))
    .sort((a, b) => a.tier.localeCompare(b.tier));

  // 4. Vendor spending forecast: pending amount + YTD total per vendor
  const ytdStart = new Date(new Date().getFullYear(), 0, 1);
  const pendingByVendor = await prisma.invoice.groupBy({
    by: ['vendor_id'],
    where: {
      status: { in: pendingApprovalStatuses as any[] },
      vendor_id: { not: null as any },
    },
    _sum: { total_amount: true },
    _count: { id: true },
  });

  const ytdByVendor = await prisma.invoice.groupBy({
    by: ['vendor_id'],
    where: {
      vendor_id: { not: null as any },
      created_at: { gte: ytdStart },
      status: { not: InvoiceStatus.REJECTED as any },
    },
    _sum: { total_amount: true },
  });

  const vendorIds = [
    ...new Set([
      ...pendingByVendor.map((v: any) => v.vendor_id),
      ...ytdByVendor.map((v: any) => v.vendor_id),
    ]),
  ].filter(Boolean) as string[];

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true },
  });

  const vendorNameMap = new Map(vendors.map(v => [v.id, v.name]));
  const ytdMap = new Map(ytdByVendor.map((v: any) => [v.vendor_id, Number(v._sum.total_amount || 0)]));

  const vendorSpendingForecast = pendingByVendor
    .map((v: any) => ({
      vendor_name: vendorNameMap.get(v.vendor_id) || 'Unknown',
      pending_amount: Number(v._sum.total_amount || 0),
      pending_count: (v._count as any)?.id || 0,
      ytd_total: ytdMap.get(v.vendor_id) || 0,
    }))
    .sort((a, b) => b.pending_amount - a.pending_amount)
    .slice(0, 20);

  return {
    upcoming_payments: upcomingPaymentsFormatted,
    weekly_payment_forecast: weeklyPaymentForecast,
    pending_approval_by_tier: pendingApprovalByTier,
    vendor_spending_forecast: vendorSpendingForecast,
  };
}
