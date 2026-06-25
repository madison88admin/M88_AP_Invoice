/**
 * DSRS Async PO Audit Service
 * Implements the async audit process described in DSRS v7.3
 * PO validation runs after upload completes — never blocks upload flow
 */

import { NextGenService } from './nextGenService';

export type POValidationStatus =
  | 'PENDING'      // audit not started yet
  | 'RUNNING'      // currently checking NextGen
  | 'MATCHED'      // amount within 2%, all fields match
  | 'WARNING'      // 2-5% variance
  | 'MISMATCH'     // >5% variance or field mismatch
  | 'NOT_FOUND'    // PO/MPO not found in NextGen
  | 'SKIPPED'      // no PO/MPO number in invoice
  | 'ERROR';       // NextGen unreachable

export interface POAuditResult {
  invoice_id: string;
  status: POValidationStatus;
  checked_at?: Date;
  nextgen_data?: {
    po_number: string;
    vendor_name: string;
    amount: number;
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
    variance_pct?: number;
    differences: string[];
  };
  error?: string;
}

export interface POAuditInput {
  po_number?: string;
  mpo_number?: string;
  amount: number;
  vendor_name: string;
  brand?: string;
  season?: string;
  order_type?: string;
}

// In-memory store (replace with DB later)
const auditStore = new Map<string, POAuditResult>();

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
      });

      if (!result.po_found) {
        auditStore.set(auditId, {
          invoice_id: auditId,
          status: 'NOT_FOUND',
          checked_at: new Date(),
          error: `PO ${poNumber} not found in NextGen`,
        });
        return;
      }

      // Calculate variance
      const variance = result.nextgen_data?.amount
        ? Math.abs(invoiceData.amount - result.nextgen_data.amount) / result.nextgen_data.amount
        : null;

      // Determine status based on variance thresholds
      let status: POValidationStatus = 'MATCHED';
      if (variance !== null) {
        if (variance > 0.05) status = 'MISMATCH';
        else if (variance > 0.02) status = 'WARNING';
      }

      // If NextGen says no match but variance is within threshold, still warn
      if (!result.is_match && status === 'MATCHED') status = 'WARNING';

      auditStore.set(auditId, {
        invoice_id: auditId,
        status,
        checked_at: new Date(),
        nextgen_data: result.nextgen_data
          ? {
              po_number: result.nextgen_data.po_number || poNumber,
              vendor_name: result.nextgen_data.vendor_name || '',
              amount: result.nextgen_data.amount || 0,
              brand: result.nextgen_data.brand || '',
              season: result.nextgen_data.season || '',
              order_type: result.nextgen_data.order_type || '',
            }
          : undefined,
        comparison: {
          ...result.comparison,
          variance_pct: variance !== null ? Math.round(variance * 1000) / 10 : 0,
        },
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
  scheduleAudit(auditId: string, invoiceData: POAuditInput, delayMs = 2000): void {
    this.initAudit(auditId);
    setTimeout(() => {
      this.runAudit(auditId, invoiceData)
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
