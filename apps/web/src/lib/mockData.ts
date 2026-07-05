// Removed all dummy data. This file now only exports empty placeholders and legacy types for gradual migration.

import { InvoiceStatus, InvoiceType, InvoiceCategory, ExceptionReason, SignatoryRole } from '@ap-invoice/shared';

export type BrandTier = 'TOP_10' | 'OTHER';

export interface MockInvoice {
  id: string;
  invoice_number: string;
  vendor_id: string;
  vendor_name: string;
  total_amount: number;
  currency: string;
  invoice_date: string;
  invoice_received_date: string;
  payment_terms: string;
  invoice_type: InvoiceType;
  category: InvoiceCategory;
  brand?: string;
  brand_code?: string;
  brand_tier?: BrandTier;
  season?: string;
  order_type?: string;
  po_number?: string;
  mpo_number?: string;
  status: InvoiceStatus;
  current_stage?: string;
  bank_name?: string;
  account_number?: string;
  swift_code?: string;
  signatures: MockSignature[];
  exceptions: MockException[];
  stage_timestamps: MockStageTimestamp[];
  audit_logs: MockAuditLog[];
  qb_invoice_id?: string;
  qb_posted_at?: string;
  paid_at?: string;
  payment_batch_id?: string;
  follow_up_tasks?: MockFollowUpTask[];
  due_date?: string;
  updated_at?: string;
  created_at?: string;
  uploaded_by?: string;
  vendor?: { name: string };
  incoterm?: string;
  bill_to_entity?: string;
  priority_flag?: boolean;
  is_urgent?: boolean;
  ocr_confidence_score?: number;
  approval_tier?: number;
  po_validation?: {
    po_found: boolean;
    comparison?: {
      vendor_match: boolean;
      amount_match: boolean;
    };
  };
}

export interface MockSignature {
  id: string;
  signatory_role: SignatoryRole;
  signatory_name: string;
  signed_at?: string;
  signature_type: 'DIGITAL' | 'MANUAL';
}

export interface MockException {
  id: string;
  invoice_id: string;
  reason: ExceptionReason;
  description: string;
  detail?: string;
  status: 'OPEN' | 'RESOLVED' | 'WAIVED';
  resolution_notes?: string;
  resolved_at?: string;
  resolved_by?: string;
  created_at: string;
}

export interface MockStageTimestamp {
  id: string;
  stage: string;
  entered_at: string;
  exited_at?: string;
  sla_hours: number;
  is_breached: boolean;
}

export interface MockAuditLog {
  id: string;
  invoice_id: string;
  action: string;
  performed_by: string;
  note: string;
  created_at: string;
}

export interface MockVendor {
  id: string;
  name: string;
  name_aliases: string[];
  supplier_location: string;
  expected_template: string;
  bank_name?: string;
  account_number?: string;
  swift_code?: string;
  iban?: string;
  has_multiple_accounts: boolean;
  bank_verified_at?: string;
  brand_code?: string;
  brand_name?: string;
  brand_tier?: BrandTier;
}

export interface MockPaymentBatch {
  id: string;
  batch_name: string;
  status: 'DRAFT' | 'PENDING_CFO' | 'APPROVED' | 'PROCESSED';
  total_amount: number;
  currency: string;
  due_date: string;
  invoice_count: number;
  invoices: string[];
  created_at: string;
  submitted_at?: string;
  approved_at?: string;
  approved_by?: string;
  processed_at?: string;
  confirmation_pdf?: string;
}

export interface MockFollowUpTask {
  id: string;
  invoice_id: string;
  task_type: string;
  assigned_to: string;
  due_date: string;
  status: 'PENDING' | 'COMPLETED';
  reminder_count: number;
  last_reminded_at?: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
}

export const MOCK_VENDORS: MockVendor[] = [];
export const MOCK_INVOICES: MockInvoice[] = [];
export const MOCK_PAYMENT_BATCHES: MockPaymentBatch[] = [];
export const MOCK_REPORTS = {
  weeklyPaymentPrioritization: [],
  payablesAging: { current: 0, day30: 0, day60: 0, day90: 0 },
  supplierBalance: [],
  slaCompliance: { overall: 0, byStage: {} },
};
