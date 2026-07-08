// Real-data provider that replaces the previous mock-data context.
// It fetches live data from the backend API and delegates mutations to the API.

import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import {
  MOCK_INVOICES,
  MOCK_VENDORS,
  MOCK_PAYMENT_BATCHES,
  MOCK_REPORTS,
  MockInvoice,
  MockVendor,
  MockPaymentBatch,
} from '../lib/mockData';
import { InvoiceStatus } from '@ap-invoice/shared';
import { invoiceApi, vendorApi, paymentBatchApi, exceptionApi } from '../lib/api';
import { useAuth } from './AuthContext';

interface MockDataContextType {
  invoices: MockInvoice[];
  vendors: MockVendor[];
  paymentBatches: MockPaymentBatch[];
  reports: typeof MOCK_REPORTS;
  loading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
  updateInvoice: (id: string, updates: Partial<MockInvoice>) => void;
  approveInvoice: (id: string, signerName: string, signerRole: string) => Promise<void>;
  rejectInvoice: (id: string, reason: string) => Promise<void>;
  postToQuickBooks: (id: string) => Promise<void>;
  resolveException: (invoiceId: string, exceptionId: string, resolution: string) => Promise<{ approvalWarning?: string } | void>;
  createPaymentBatch: (invoiceIds: string[], batchName: string) => Promise<void>;
  approvePaymentBatch: (batchId: string, approver: string) => Promise<void>;
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

const dateToString = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toISOString() : new Date().toISOString();

const apiVendorToMock = (vendor: any): MockVendor => ({
  id: vendor.id || '',
  name: vendor.name || '',
  name_aliases: vendor.name_aliases || [],
  supplier_location: vendor.supplier_location || '',
  expected_template: vendor.invoice_template_type || 'STANDARD',
  bank_name: vendor.bank_name || undefined,
  account_number: vendor.account_number || undefined,
  swift_code: vendor.swift_code || undefined,
  iban: vendor.iban || undefined,
  has_multiple_accounts: false,
  bank_verified_at: vendor.bank_verified_at ? dateToString(vendor.bank_verified_at) : undefined,
  brand_code: vendor.brand_code || undefined,
  brand_name: vendor.brand_name || undefined,
  brand_tier: vendor.brand_tier || undefined,
});

const apiInvoiceToMock = (invoice: any): MockInvoice => {
  const vendor = invoice.vendor || {};
  return {
    id: invoice.id || '',
    invoice_number: invoice.invoice_number || '',
    vendor_id: invoice.vendor_id || vendor.id || '',
    vendor_name: vendor.name || invoice.vendor_name_raw || '',
    total_amount: Number(invoice.total_amount || 0),
    currency: invoice.currency || 'USD',
    invoice_date: dateToString(invoice.invoice_date),
    invoice_received_date: dateToString(invoice.invoice_received_date || invoice.created_at),
    payment_terms: invoice.payment_terms || '',
    invoice_type: invoice.invoice_type || 'INVOICE',
    category: invoice.category || 'TRIMS',
    brand: invoice.brand || undefined,
    brand_code: invoice.brand_code || undefined,
    brand_tier: invoice.brand_tier || undefined,
    season: invoice.season || undefined,
    order_type: invoice.order_type || undefined,
    po_number: invoice.customer_po_number || undefined,
    mpo_number: invoice.mpo_number || undefined,
    qty_shipped: invoice.qty_shipped || undefined,
    status: invoice.status || 'VALIDATION_PENDING',
    current_stage: invoice.current_approver_role || undefined,
    bank_name: vendor.bank_name || invoice.bank_name || undefined,
    account_number: vendor.account_number || invoice.account_number || undefined,
    swift_code: vendor.swift_code || invoice.swift_code || undefined,
    signatures: (invoice.signatures || []).map((s: any) => ({
      id: s.id || '',
      signatory_role: s.signatory_role || '',
      signatory_name: s.signatory_name || '',
      signed_at: s.signed_at ? dateToString(s.signed_at) : undefined,
      signature_type: s.signature_type || 'DIGITAL',
    })),
    exceptions: (invoice.exceptions || []).map((e: any) => ({
      id: e.id || '',
      invoice_id: e.invoice_id || invoice.id || '',
      reason: e.reason || 'OTHER',
      description: e.detail || '',
      detail: e.detail || '',
      status: e.status === 'RESOLVED' || e.status === 'WAIVED' ? e.status : 'OPEN',
      resolution_notes: e.resolution_notes || undefined,
      resolved_at: e.resolved_at ? dateToString(e.resolved_at) : undefined,
      resolved_by: e.resolved_by || undefined,
      created_at: dateToString(e.created_at),
    })),
    stage_timestamps: (invoice.stage_timestamps || []).map((st: any) => ({
      id: st.id || '',
      stage: st.stage || '',
      entered_at: dateToString(st.entered_at),
      exited_at: st.exited_at ? dateToString(st.exited_at) : undefined,
      sla_hours: Number(st.sla_hours || 0),
      is_breached: st.is_breached || false,
    })),
    audit_logs: (invoice.audit_logs || []).map((al: any) => ({
      id: al.id || '',
      invoice_id: al.invoice_id || invoice.id || '',
      action: al.action || '',
      performed_by: al.performed_by || '',
      note: al.note || '',
      created_at: dateToString(al.created_at),
    })),
    due_date: invoice.due_date ? dateToString(invoice.due_date) : undefined,
    updated_at: invoice.updated_at ? dateToString(invoice.updated_at) : undefined,
    created_at: invoice.created_at ? dateToString(invoice.created_at) : undefined,
    uploaded_by: invoice.uploaded_by || undefined,
    vendor: vendor.name ? { name: vendor.name } : undefined,
    incoterm: invoice.incoterm || undefined,
    bill_to_entity: invoice.bill_to_entity || undefined,
    priority_flag: invoice.priority_flag || false,
    is_urgent: invoice.is_urgent || false,
    is_handwritten: invoice.is_handwritten || false,
    ocr_confidence_score: invoice.ocr_confidence_score || undefined,
    ocr_raw_data: invoice.ocr_raw_data || undefined,
    approval_tier: invoice.approval_tier || undefined,
    po_validation: invoice.po_validation || undefined,
    vendor_name_raw: invoice.vendor_name_raw || undefined,
    ship_to: invoice.ship_to || undefined,
    sold_to: invoice.sold_to || undefined,
    subtotal: invoice.subtotal !== null ? Number(invoice.subtotal) : undefined,
    tax_amount: invoice.tax_amount !== null ? Number(invoice.tax_amount) : undefined,
    discount_amount: invoice.discount_amount !== null ? Number(invoice.discount_amount) : undefined,
    bank_charges: invoice.bank_charges !== null ? Number(invoice.bank_charges) : undefined,
    freight_charges: invoice.freight_charges !== null ? Number(invoice.freight_charges) : undefined,
    additional_charges: invoice.additional_charges !== null ? Number(invoice.additional_charges) : undefined,
    exchange_rate_to_usd: invoice.exchange_rate_to_usd !== null ? Number(invoice.exchange_rate_to_usd) : undefined,
    invoice_currency_original: invoice.invoice_currency_original || undefined,
    date_range_start: invoice.date_range_start ? dateToString(invoice.date_range_start) : undefined,
    date_range_end: invoice.date_range_end ? dateToString(invoice.date_range_end) : undefined,
    priority_pay_date: invoice.priority_pay_date ? dateToString(invoice.priority_pay_date) : undefined,
  };
};

const apiBatchToMock = (batch: any): MockPaymentBatch => ({
  id: batch.id || '',
  batch_name: batch.batch_name || batch.name || '',
  status: batch.status || 'DRAFT',
  total_amount: Number(batch.total_amount || 0),
  currency: batch.currency || 'USD',
  due_date: batch.due_date ? dateToString(batch.due_date) : dateToString(new Date()),
  invoice_count: batch.invoice_count || 0,
  invoices: batch.invoice_ids || [],
  created_at: dateToString(batch.created_at),
  submitted_at: batch.submitted_at ? dateToString(batch.submitted_at) : undefined,
  approved_at: batch.approved_at ? dateToString(batch.approved_at) : undefined,
  approved_by: batch.approved_by || undefined,
  processed_at: batch.processed_at ? dateToString(batch.processed_at) : undefined,
  confirmation_pdf: batch.confirmation_pdf || undefined,
});

export const MockDataProvider = ({ children }: MockDataProviderProps) => {
  const { user, isAuthenticated } = useAuth();
  const [invoices, setInvoices] = useState<MockInvoice[]>(MOCK_INVOICES);
  const [vendors, setVendors] = useState<MockVendor[]>(MOCK_VENDORS);
  const [paymentBatches, setPaymentBatches] = useState<MockPaymentBatch[]>(MOCK_PAYMENT_BATCHES);
  const [reports] = useState(MOCK_REPORTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Only fetch payment batches for roles that have permission
  const canFetchPaymentBatches = user && ['ACCOUNTING_SUPERVISOR', 'CFO', 'SUPERADMIN', 'IT_ADMIN'].includes(user.role);

  const refresh = useCallback(async (silent = false) => {
    if (!isAuthenticated) return;
    try {
      if (silent) setIsRefreshing(true); else setLoading(true);
      setError(null);
      const fetches: Promise<any>[] = [
        invoiceApi.getAll().catch(() => ({ data: [] })),
        vendorApi.getAll().catch(() => ({ data: [] })),
      ];
      if (canFetchPaymentBatches) {
        fetches.push(paymentBatchApi.getAll().catch(() => ({ data: [] })));
      }
      const [invoiceRes, vendorRes, batchRes] = await Promise.all(fetches);
      setInvoices((invoiceRes.data || []).map(apiInvoiceToMock));
      setVendors((vendorRes.data || []).map(apiVendorToMock));
      if (canFetchPaymentBatches) {
        setPaymentBatches((batchRes?.data || []).map(apiBatchToMock));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isAuthenticated, canFetchPaymentBatches]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refresh();
    const interval = setInterval(() => refresh(true), 30000);
    return () => clearInterval(interval);
  }, [refresh, isAuthenticated]);

  const updateInvoice = useCallback((id: string, updates: Partial<MockInvoice>) => {
    setInvoices(prev => prev.map(inv => (inv.id === id ? { ...inv, ...updates } : inv)));
  }, []);

  const approveInvoice = useCallback(
    async (id: string, signerName: string) => {
      await invoiceApi.approve(id, signerName);
      await refresh();
    },
    [refresh]
  );

  const rejectInvoice = useCallback(
    async (id: string, reason: string) => {
      await invoiceApi.reject(id, reason);
      await refresh();
    },
    [refresh]
  );

  const postToQuickBooks = useCallback(
    async (id: string) => {
      await invoiceApi.post(id);
      await refresh();
    },
    [refresh]
  );

  const resolveException = useCallback(
    async (_invoiceId: string, exceptionId: string, resolution: string): Promise<{ approvalWarning?: string } | void> => {
      const res = await exceptionApi.resolve(exceptionId, resolution);
      await refresh();
      return res.data;
    },
    [refresh]
  );

  const createPaymentBatch = useCallback(
    async (invoiceIds: string[]) => {
      await paymentBatchApi.create(invoiceIds);
      await refresh();
    },
    [refresh]
  );

  const approvePaymentBatch = useCallback(
    async (batchId: string) => {
      await paymentBatchApi.process(batchId);
      await refresh();
    },
    [refresh]
  );

  const getInvoicesByStatus = useCallback(
    (status: InvoiceStatus) => invoices.filter(inv => inv.status === status),
    [invoices]
  );

  const getInvoicesByStage = useCallback(
    (stage: string) => invoices.filter(inv => inv.current_stage === stage),
    [invoices]
  );

  const getInvoicesByBrandTier = useCallback(
    (brandTier: string) => invoices.filter(inv => inv.brand_tier === brandTier),
    [invoices]
  );

  return (
    <MockDataContext.Provider
      value={{
        invoices,
        vendors,
        paymentBatches,
        reports,
        loading,
        isRefreshing,
        error,
        refresh,
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
