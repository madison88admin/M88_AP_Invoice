// TODO: TEMPORARY MOCK DATA — replace with real backend data
// once Supabase backend is connected. This is for demo purposes only.

import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { MOCK_INVOICES, MOCK_VENDORS, MOCK_PAYMENT_BATCHES, MOCK_REPORTS, MockInvoice, MockVendor, MockPaymentBatch } from '../lib/mockData';
import { InvoiceStatus, SignatoryRole } from '@ap-invoice/shared';

interface MockDataContextType {
  invoices: MockInvoice[];
  vendors: MockVendor[];
  paymentBatches: MockPaymentBatch[];
  reports: typeof MOCK_REPORTS;
  updateInvoice: (id: string, updates: Partial<MockInvoice>) => void;
  approveInvoice: (id: string, signerName: string, signerRole: string) => void;
  rejectInvoice: (id: string, reason: string) => void;
  postToQuickBooks: (id: string) => void;
  resolveException: (invoiceId: string, exceptionId: string, resolution: string) => void;
  createPaymentBatch: (invoiceIds: string[], batchName: string) => void;
  approvePaymentBatch: (batchId: string, approver: string) => void;
  getInvoicesByStatus: (status: InvoiceStatus) => MockInvoice[];
  getInvoicesByStage: (stage: string) => MockInvoice[];
  getInvoicesByBrandTier: (brandTier: string) => MockInvoice[];
}

const MockDataContext = createContext<MockDataContextType | undefined>(undefined);

export const useMockData = () => {
  const context = useContext(MockDataContext);
  if (context === undefined) {
    throw new Error('useMockData must be used within a MockDataProvider');
  }
  return context;
};

interface MockDataProviderProps {
  children: ReactNode;
}

export const MockDataProvider = ({ children }: MockDataProviderProps) => {
  const [invoices, setInvoices] = useState<MockInvoice[]>(MOCK_INVOICES);
  const [vendors] = useState<MockVendor[]>(MOCK_VENDORS);
  const [paymentBatches, setPaymentBatches] = useState<MockPaymentBatch[]>(MOCK_PAYMENT_BATCHES);
  const [reports] = useState(MOCK_REPORTS);

  const updateInvoice = useCallback((id: string, updates: Partial<MockInvoice>) => {
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, ...updates } : inv));
  }, []);

  const approveInvoice = useCallback((id: string, signerName: string, signerRole: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      
      // Find the current stage and determine next stage
      const currentStage = inv.current_stage;
      const signatures = [...inv.signatures];
      
      // Add signature
      signatures.push({
        id: `sig-${Date.now()}`,
        signatory_role: signerRole as SignatoryRole,
        signatory_name: signerName,
        signed_at: new Date().toISOString(),
        signature_type: 'DIGITAL',
      });

      // Determine next status based on current stage
      let newStatus = inv.status;
      let newStage = currentStage;
      
      if (currentStage === 'PURCHASING_COORDINATOR') {
        newStatus = InvoiceStatus.PENDING_MANAGER;
        newStage = 'PURCHASING_MANAGER';
      } else if (currentStage === 'PURCHASING_MANAGER') {
        // Check amount for tier routing
        if (inv.total_amount <= 2000) {
          newStatus = InvoiceStatus.APPROVED; // Tier 1 - final approval
          newStage = undefined;
        } else {
          newStatus = InvoiceStatus.PENDING_MLO_PLANNING_MANAGER;
          newStage = 'PLANNING_MANAGER';
        }
      } else if (currentStage === 'PLANNING_MANAGER') {
        newStatus = InvoiceStatus.PENDING_SR_MANAGER;
        newStage = 'LINDSEY';
      } else if (currentStage === 'LINDSEY') {
        if (inv.total_amount > 100000) {
          newStatus = InvoiceStatus.PENDING_POLLY;
          newStage = 'POLLY';
        } else {
          newStatus = InvoiceStatus.APPROVED; // Tier 2 - final approval
          newStage = undefined;
        }
      } else if (currentStage === 'POLLY') {
        newStatus = InvoiceStatus.APPROVED; // Tier 3 - final approval
        newStage = undefined;
      }

      // Add audit log
      const auditLogs = [...inv.audit_logs];
      auditLogs.push({
        id: `al-${Date.now()}`,
        invoice_id: id,
        action: 'APPROVED',
        performed_by: signerName,
        note: `Approved by ${signerRole}`,
        created_at: new Date().toISOString(),
      });

      // Update stage timestamps
      const stageTimestamps = [...inv.stage_timestamps];
      const currentStageTimestamp = stageTimestamps.find(st => st.stage === currentStage && !st.exited_at);
      if (currentStageTimestamp) {
        currentStageTimestamp.exited_at = new Date().toISOString();
      }
      
      if (newStage) {
        stageTimestamps.push({
          id: `st-${Date.now()}`,
          stage: newStage,
          entered_at: new Date().toISOString(),
          sla_hours: 168,
          is_breached: false,
        });
      }

      return {
        ...inv,
        signatures,
        status: newStatus,
        current_stage: newStage,
        auditLogs,
        stage_timestamps: stageTimestamps,
      };
    }));
  }, []);

  const rejectInvoice = useCallback((id: string, reason: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      
      const auditLogs = [...inv.audit_logs];
      auditLogs.push({
        id: `al-${Date.now()}`,
        invoice_id: id,
        action: 'REJECTED',
        performed_by: 'system',
        note: reason,
        created_at: new Date().toISOString(),
      });

      return {
        ...inv,
        status: InvoiceStatus.REJECTED,
        audit_logs: auditLogs,
      };
    }));
  }, []);

  const postToQuickBooks = useCallback((id: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      
      const auditLogs = [...inv.audit_logs];
      auditLogs.push({
        id: `al-${Date.now()}`,
        invoice_id: id,
        action: 'POSTED_TO_QB',
        performed_by: 'system',
        note: 'Posted to QuickBooks',
        created_at: new Date().toISOString(),
      });

      return {
        ...inv,
        status: InvoiceStatus.POSTED_TO_QB,
        qb_invoice_id: `QB-${inv.invoice_number}`,
        qb_posted_at: new Date().toISOString(),
        audit_logs: auditLogs,
      };
    }));
  }, []);

  const resolveException = useCallback((invoiceId: string, exceptionId: string, resolution: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      
      const exceptions = inv.exceptions.map(exc => {
        if (exc.id === exceptionId) {
          return {
            ...exc,
            status: 'RESOLVED' as const,
            resolution_notes: resolution,
            resolved_at: new Date().toISOString(),
          };
        }
        return exc;
      });

      const auditLogs = [...inv.audit_logs];
      auditLogs.push({
        id: `al-${Date.now()}`,
        invoice_id: invoiceId,
        action: 'EXCEPTION_RESOLVED',
        performed_by: 'system',
        note: `Exception ${exceptionId} resolved: ${resolution}`,
        created_at: new Date().toISOString(),
      });

      return {
        ...inv,
        exceptions,
        audit_logs: auditLogs,
      };
    }));
  }, []);

  const createPaymentBatch = useCallback((invoiceIds: string[], batchName: string) => {
    const newBatch: MockPaymentBatch = {
      id: `pb-${Date.now()}`,
      batch_name: batchName,
      status: 'DRAFT',
      total_amount: invoices
        .filter(inv => invoiceIds.includes(inv.id))
        .reduce((sum, inv) => sum + inv.total_amount, 0),
      currency: 'USD',
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invoice_count: invoiceIds.length,
      invoices: invoiceIds,
      created_at: new Date().toISOString(),
    };
    
    setPaymentBatches(prev => [...prev, newBatch]);
  }, [invoices]);

  const approvePaymentBatch = useCallback((batchId: string, approver: string) => {
    setPaymentBatches(prev => prev.map(batch => {
      if (batch.id !== batchId) return batch;
      
      return {
        ...batch,
        status: 'APPROVED',
        approved_at: new Date().toISOString(),
        approved_by: approver,
      };
    }));
  }, []);

  const getInvoicesByStatus = useCallback((status: InvoiceStatus) => {
    return invoices.filter(inv => inv.status === status);
  }, [invoices]);

  const getInvoicesByStage = useCallback((stage: string) => {
    return invoices.filter(inv => inv.current_stage === stage);
  }, [invoices]);

  const getInvoicesByBrandTier = useCallback((brandTier: string) => {
    return invoices.filter(inv => inv.brand_tier === brandTier);
  }, [invoices]);

  return (
    <MockDataContext.Provider
      value={{
        invoices,
        vendors,
        paymentBatches,
        reports,
        updateInvoice,
        approveInvoice,
        rejectInvoice,
        postToQuickBooks,
        resolveException,
        createPaymentBatch,
        approvePaymentBatch,
        getInvoicesByStatus,
        getInvoicesByStage,
        getInvoicesByBrandTier,
      }}
    >
      {children}
    </MockDataContext.Provider>
  );
};
