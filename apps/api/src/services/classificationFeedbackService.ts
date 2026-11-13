import prisma from '../config/database';

export type ClassificationDecision = 'PAYABLE_INVOICE' | 'NON_INVOICE' | 'UNCERTAIN';

function vendorKey(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Use invoices that demonstrably reached Accounting or later as positive
 * vendor examples. They are context only; header/rule checks still decide the
 * current document. These outcomes cannot create negative examples.
 */
export async function getClassificationFeedbackExamples(vendorName?: string, limit = 4) {
  if (!vendorName || !(prisma as any).invoice?.findMany) return [];
  try {
    const rows = await (prisma as any).invoice.findMany({
      where: {
        status: { in: ['PENDING_ACCOUNTING', 'APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID', 'PAYMENT_CONFIRMATION_SENT'] },
        vendor_name_raw: { equals: vendorName, mode: 'insensitive' },
        is_duplicate: false,
      },
      orderBy: { updated_at: 'desc' },
      take: 100,
      select: { invoice_type: true, ocr_raw_data: true, vendor_name_raw: true },
    });
    const targetVendor = vendorKey(vendorName);
    return rows.filter((row: any) => {
      const sampleVendor = vendorKey(row.vendor_name_raw);
      return sampleVendor === targetVendor;
    }).slice(0, Math.max(1, Math.min(8, limit))).map((row: any) => ({
      decision: 'PAYABLE_INVOICE' as ClassificationDecision,
      documentType: String(row.ocr_raw_data?.document_type || row.invoice_type || 'UNKNOWN'),
      evidence: String(row.ocr_raw_data?.document_type_evidence || '').slice(0, 240),
      vendor: String(row.vendor_name_raw || vendorName),
    }));
  } catch {
    return [];
  }
}

export function formatClassificationFeedbackPrompt(examples: Array<{ decision: ClassificationDecision; documentType: string; evidence: string; vendor: string }>) {
  if (!examples.length) return '';
  const lines = examples.map((example, index) => `${index + 1}. Vendor=${example.vendor}; confirmed outcome=${example.decision}; observed header/type=${example.documentType}; evidence=${example.evidence || 'reviewer confirmed'}`).join('\n');
  return `These are historical invoices from this same vendor that reached Accounting or later. Use as positive vendor context only; they do not prove the current document is payable and must never override its visible header/content. If current evidence conflicts, classify UNKNOWN and set payable_candidate=false.\n${lines}`;
}
