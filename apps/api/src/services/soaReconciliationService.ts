import prisma from '../config/database';
import { InvoiceStatus } from '@ap-invoice/shared';

export interface SOAReconciliationItem {
  invoice_id: string;
  invoice_number: string;
  vendor_id: string;
  vendor_name: string;
  invoice_amount: number;
  soa_amount: number;
  discrepancy: number;
  status: 'MATCHED' | 'DISCREPANCY' | 'MISSING_IN_SOA' | 'MISSING_IN_SYSTEM';
  reconciliation_date: Date;
}

/**
 * Get SOA reconciliation queue for a specific month
 */
export async function getSOAReconciliationQueue(year: number, month: number): Promise<SOAReconciliationItem[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  // Get all posted invoices for the month
  const invoices = await prisma.invoice.findMany({
    where: {
      status: {
        in: [InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID],
      },
      invoice_date: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      vendor: true,
    },
    orderBy: {
      invoice_date: 'asc',
    },
  });

  // In a real implementation, this would match against vendor SOAs
  // For now, we'll simulate the reconciliation process
  const reconciliationItems = invoices.map((invoice: any) => {
    // Simulate SOA amount (in production, this would come from vendor SOA)
    const soaAmount = invoice.amount; // Assume match for now
    const discrepancy = Math.abs(invoice.amount - soaAmount);
    
    return {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      vendor_id: invoice.vendor_id,
      vendor_name: invoice.vendor?.name || 'Unknown',
      invoice_amount: Number(invoice.amount),
      soa_amount: soaAmount,
      discrepancy,
      status: (discrepancy < 0.01 ? 'MATCHED' : 'DISCREPANCY') as 'MATCHED' | 'DISCREPANCY' | 'MISSING_IN_SOA' | 'MISSING_IN_SYSTEM',
      reconciliation_date: new Date(),
    };
  });

  return reconciliationItems as SOAReconciliationItem[];
}

/**
 * Get SOA reconciliation statistics
 */
export async function getSOAReconciliationStatistics(year: number, month: number) {
  const reconciliationItems = await getSOAReconciliationQueue(year, month);

  const matched = reconciliationItems.filter((item) => item.status === 'MATCHED').length;
  const discrepancies = reconciliationItems.filter((item) => item.status === 'DISCREPANCY').length;
  const totalDiscrepancyAmount = reconciliationItems
    .filter((item) => item.status === 'DISCREPANCY')
    .reduce((sum, item) => sum + item.discrepancy, 0);

  return {
    total_items: reconciliationItems.length,
    matched,
    discrepancies,
    discrepancy_rate: reconciliationItems.length > 0 ? (discrepancies / reconciliationItems.length) * 100 : 0,
    total_discrepancy_amount: totalDiscrepancyAmount,
  };
}

/**
 * Mark a reconciliation item as reviewed
 */
export async function markAsReviewed(invoiceId: string, userId: string, notes?: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Create audit log entry for the review
  await prisma.auditLog.create({
    data: {
      invoice_id: invoiceId,
      action: 'SOA_RECONCILIATION_REVIEWED',
      performed_by: userId,
      note: `SOA reconciliation reviewed for invoice ${invoice.invoice_number}`,
    },
  });

  return { message: 'Reconciliation item marked as reviewed' };
}

/**
 * Get vendors with pending SOA submissions
 */
export async function getVendorsWithPendingSOA(year: number, month: number) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  // Get vendors with invoices in the month
  const vendors = await prisma.vendor.findMany({
    where: {
      invoices: {
        some: {
          status: {
            in: [InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID],
          },
          invoice_date: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
    },
    include: {
      _count: {
        select: {
          invoices: {
            where: {
              status: {
                in: [InvoiceStatus.POSTED_TO_QB, InvoiceStatus.PAYMENT_SCHEDULED, InvoiceStatus.PAID],
              },
              invoice_date: {
                gte: startDate,
                lte: endDate,
              },
            },
          },
        },
      },
    },
  });

  return vendors.map((vendor: any) => ({
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    invoice_count: vendor._count.invoices,
    soa_submitted: false, // In production, this would be tracked
  }));
}

/**
 * Record SOA submission from vendor
 */
export async function recordSOASubmission(
  vendorId: string,
  year: number,
  month: number,
  fileUrl: string,
  userId: string
) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
  });

  if (!vendor) {
    throw new Error('Vendor not found');
  }

  // In a real implementation, this would store the SOA file and metadata
  // For now, we'll create an audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: '', // No specific invoice for SOA submission
      action: 'SOA_SUBMITTED',
      performed_by: userId,
      note: `SOA submitted by vendor ${vendor.name} for ${year}-${month.toString().padStart(2, '0')}`,
    },
  });

  return { message: 'SOA submission recorded successfully' };
}
