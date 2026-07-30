/**
 * DSRS Async PO Audit Service
 * Implements the async audit process described in DSRS v7.3
 * PO validation runs after upload completes — never blocks upload flow
 */

import {
  InvoiceComparisonLine,
  NextGenLineComparison,
  NextGenService,
  NextGenPOData,
  NextGenValidationStatus,
} from './nextGenService';

export type POValidationStatus =
  | 'PENDING'      // audit not started yet
  | 'RUNNING'      // currently checking NextGen
  | 'MATCH'
  | 'MISMATCH'     // >5% variance or field mismatch
  | 'LINE_NOT_FOUND'
  | 'PO_NOT_FOUND'
  | 'NEXTGEN_UNAVAILABLE'
  | 'MANUAL_REVIEW'
  | 'SKIPPED'      // no PO/MPO number in invoice
  | 'ERROR';

export interface POChangeRecord {
  changed_at: Date;
  field: string;
  previous_value: string;
  current_value: string;
}

export interface POAuditResult {
  invoice_id: string;
  status: POValidationStatus;
  checked_at?: Date;
  nextgen_data?: {
    po_number: string;
    vendor_name: string;
    amount: number;
    currency?: string;
    brand: string;
    season: string;
    order_type: string;
  };
  comparison?: {
    amount_match: boolean;
    vendor_match: boolean;
    brand_match: boolean;
    season_match: boolean;
    order_type_match: boolean;
    currency_match?: boolean;
    invoice_amount?: number;
    nextgen_amount?: number;
    amount_difference?: number;
    variance_pct?: number;
    line_comparisons?: NextGenLineComparison[];
    differences: string[];
  };
  reason?: string;
  po_changes?: POChangeRecord[];
  error?: string;
}

export interface POAuditInput {
  po_number?: string;
  mpo_number?: string;
  amount: number;
  currency?: string;
  vendor_name: string;
  brand?: string;
  season?: string;
  order_type?: string;
  mpo_order_sequence?: string;
  material_code?: string;
  material_name?: string;
  line_items?: InvoiceComparisonLine[];
}

// In-memory store (replace with DB later)
const auditStore = new Map<string, POAuditResult>();
const poSnapshotStore = new Map<string, NextGenPOData>();

export class POAuditService {
  private static instance: POAuditService;

  static getInstance(): POAuditService {
    if (!POAuditService.instance) {
      POAuditService.instance = new POAuditService();
    }
    return POAuditService.instance;
  }

  // Called immediately after upload — sets PENDING status
  initAudit(auditId: string): void {
    auditStore.set(auditId, {
      invoice_id: auditId,
      status: 'PENDING',
    });
  }

  // Called by background process
  async runAudit(auditId: string, invoiceData: POAuditInput): Promise<void> {
    // Mark as running
    auditStore.set(auditId, {
      invoice_id: auditId,
      status: 'RUNNING',
    });

    try {
      const poNumber = invoiceData.po_number || invoiceData.mpo_number;

      // No PO number extracted → skip
      if (!poNumber) {
        auditStore.set(auditId, {
          invoice_id: auditId,
          status: 'SKIPPED',
          checked_at: new Date(),
          error: 'No PO/MPO number found in invoice',
        });
        return;
      }

      // Call NextGen compare service
      const nextGenService = NextGenService.getInstance();
      const result = await nextGenService.compareInvoiceWithPO({
        po_number: invoiceData.po_number,
        mpo_number: invoiceData.mpo_number,
        amount: invoiceData.amount,
        vendor_name: invoiceData.vendor_name,
        brand: invoiceData.brand,
        season: invoiceData.season,
        order_type: invoiceData.order_type,
        mpo_order_sequence: invoiceData.mpo_order_sequence,
        material_code: invoiceData.material_code,
        material_name: invoiceData.material_name,
        currency: invoiceData.currency,
        line_items: invoiceData.line_items,
      });

      if (!result.po_found) {
        auditStore.set(auditId, {
          invoice_id: auditId,
          status: 'PO_NOT_FOUND',
          checked_at: new Date(),
          error: `PO ${poNumber} not found in NextGen`,
        });
        return;
      }

      const status = (result.status || (result.is_match ? 'MATCH' : 'MISMATCH')) as NextGenValidationStatus;

      // Detect PO changes by comparing with previous snapshot
      const poKey = invoiceData.mpo_number || invoiceData.po_number || auditId;
      const previousSnapshot = poSnapshotStore.get(poKey);
      const poChanges: POChangeRecord[] = [];
      if (previousSnapshot && result.nextgen_data) {
        const previousQty = previousSnapshot.line_items?.reduce((sum, li) => sum + (li.quantity || 0), 0) ?? 0;
        const currentQty = result.nextgen_data.line_items?.reduce((sum, li) => sum + (li.quantity || 0), 0) ?? 0;

        if (previousSnapshot.amount !== result.nextgen_data.amount) {
          poChanges.push({ changed_at: new Date(), field: 'amount', previous_value: String(previousSnapshot.amount), current_value: String(result.nextgen_data.amount) });
        }
        if (previousSnapshot.currency !== result.nextgen_data.currency) {
          poChanges.push({ changed_at: new Date(), field: 'currency', previous_value: previousSnapshot.currency || '', current_value: result.nextgen_data.currency || '' });
        }
        if (previousSnapshot.vendor_name !== result.nextgen_data.vendor_name) {
          poChanges.push({ changed_at: new Date(), field: 'vendor_name', previous_value: previousSnapshot.vendor_name || '', current_value: result.nextgen_data.vendor_name || '' });
        }
        if (previousQty !== currentQty) {
          poChanges.push({ changed_at: new Date(), field: 'total_quantity', previous_value: String(previousQty), current_value: String(currentQty) });
        }
        if ((previousSnapshot.line_items?.length || 0) !== (result.nextgen_data.line_items?.length || 0)) {
          poChanges.push({ changed_at: new Date(), field: 'line_item_count', previous_value: String(previousSnapshot.line_items?.length || 0), current_value: String(result.nextgen_data.line_items?.length || 0) });
        }
      }
      if (result.nextgen_data) {
        poSnapshotStore.set(poKey, result.nextgen_data);
      }

      auditStore.set(auditId, {
        invoice_id: auditId,
        status,
        checked_at: new Date(),
        nextgen_data: result.nextgen_data
          ? {
              po_number: result.nextgen_data.po_number || poNumber,
              vendor_name: result.nextgen_data.vendor_name || '',
              amount: result.nextgen_data.amount || 0,
              currency: result.nextgen_data.currency || '',
              brand: result.nextgen_data.brand || '',
              season: result.nextgen_data.season || '',
              order_type: result.nextgen_data.order_type || '',
            }
          : undefined,
        comparison: {
          ...result.comparison,
        },
        reason: result.reason,
        po_changes: poChanges.length > 0 ? poChanges : undefined,
      });
    } catch (error) {
      // NextGen unreachable — non-blocking, just log
      const message = error instanceof Error ? error.message : 'NextGen unreachable during audit';
      console.error(`[POAuditService] Audit failed for ${auditId}:`, error);
      auditStore.set(auditId, {
        invoice_id: auditId,
        status: 'ERROR',
        checked_at: new Date(),
        error: message,
      });
    }
  }

  // Called by frontend polling
  getAuditResult(auditId: string): POAuditResult {
    return auditStore.get(auditId) || {
      invoice_id: auditId,
      status: 'PENDING',
    };
  }

  // Get all audit results (for dashboard)
  getAllResults(): POAuditResult[] {
    return Array.from(auditStore.values());
  }

  // Schedule audit after delay (called after upload)
  // Retries with exponential backoff when PO is not found, so the system keeps checking
  // until the PO/MPO appears in NextGen or the invoice is processed.
  scheduleAudit(auditId: string, invoiceData: POAuditInput, delayMs = 5000, attempt = 1, maxAttempts = 10): void {
    this.initAudit(auditId);
    setTimeout(() => {
      this.runAudit(auditId, invoiceData)
        .then(() => {
          const result = auditStore.get(auditId);
          if ((result?.status === 'PO_NOT_FOUND' || result?.status === 'NEXTGEN_UNAVAILABLE') && attempt < maxAttempts) {
            const nextDelay = Math.min(delayMs * 2, 600000); // cap at 10 minutes
            console.log(`[POAuditService] PO not found for ${auditId}, retrying in ${nextDelay / 1000}s (attempt ${attempt}/${maxAttempts})`);
            this.scheduleAudit(auditId, invoiceData, nextDelay, attempt + 1, maxAttempts);
          }
        })
        .catch(err => console.error(`[POAuditService] Scheduled audit failed for ${auditId}:`, err));
    }, delayMs);
  }

  // Transfer an audit result from a temporary upload session id to a real invoice id
  transferAudit(fromAuditId: string, toInvoiceId: string): boolean {
    const result = auditStore.get(fromAuditId);
    if (!result) return false;

    auditStore.set(toInvoiceId, {
      ...result,
      invoice_id: toInvoiceId,
    });
    return true;
  }
}

export const poAuditService = POAuditService.getInstance();
