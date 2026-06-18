-- Supabase Database Schema for AP Invoice Application
-- Generated from Prisma schema - BRD v4.1

-- ========================================
-- ENUMS
-- ========================================

CREATE TYPE "InvoiceType" AS ENUM ('INV', 'PI', 'CI', 'SI', 'PREPAID', 'STATEMENT');
CREATE TYPE "InvoiceCategory" AS ENUM ('TRIMS', 'YARN', 'SAMPLE_CHARGES', 'SHIPPING_FREIGHT', 'LAB_TESTING', 'PROFESSIONAL_FEE', 'OTHER');
CREATE TYPE "OrderType" AS ENUM ('BULK', 'SMS', 'SAMPLE');
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING_VALIDATION', 'VALIDATED', 'EXCEPTION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED', 'PAYMENT_INITIATED', 'PAID', 'PI_PENDING_CI');
CREATE TYPE "PaymentTerms" AS ENUM ('NET_7', 'NET_30', 'NET_45', 'NET_60', 'NET_90', 'WITHIN_15_DAYS', 'PAYMENT_IN_ADVANCE', 'TT_100_BEFORE_SHIPMENT', 'PBS', 'ARD', 'CHEQUE_30', 'SPLIT_50_50', 'PREPAID', 'COD', 'OTHER');
CREATE TYPE "SignatureRole" AS ENUM ('COORDINATOR', 'MANAGER', 'PLANNING_MANAGER_TOP10', 'PLANNING_MANAGER_OTHER', 'LINDSEY', 'POLLY');
CREATE TYPE "ApprovalStage" AS ENUM ('PURCHASING_COORDINATOR', 'PURCHASING_MANAGER', 'PLANNING_MANAGER', 'LINDSEY', 'POLLY', 'ACCOUNTING');
CREATE TYPE "ExceptionReason" AS ENUM ('INVALID_BILL_TO', 'BANK_MISMATCH', 'MISSING_BANK_INFO', 'MISSING_SIGNATURE', 'DUPLICATE_INVOICE', 'VENDOR_NOT_FOUND', 'INVALID_TEMPLATE', 'LATE_SUBMISSION', 'AMOUNT_MISMATCH', 'URGENT_PAYMENT', 'HANDWRITTEN_DOCUMENT', 'MISSING_ADDRESS', 'MULTIPLE_BANK_ACCOUNTS');
CREATE TYPE "MadisonEntity" AS ENUM ('MADISON_88_LTD', 'MADISON_88_LIMITED', 'MADISON_88_NEW_YORK', 'MADISON_88_HONG_KONG_LIMITED');
CREATE TYPE "BrandTier" AS ENUM ('TOP_10', 'OTHER');
CREATE TYPE "ExceptionStatus" AS ENUM ('PENDING', 'RESOLVED', 'WAIVED');
CREATE TYPE "PaymentBatchStatus" AS ENUM ('DRAFT', 'PENDING_CFO', 'APPROVED', 'PROCESSED', 'CANCELLED');

-- ========================================
-- VENDORS
-- ========================================

CREATE TABLE IF NOT EXISTS vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_aliases TEXT[] DEFAULT '{}',
  expected_template "InvoiceType" NOT NULL DEFAULT 'INV',
  supplier_location TEXT,
  is_top_10_brand BOOLEAN DEFAULT false,
  bank_name TEXT,
  bank_address TEXT,
  account_usd TEXT,
  account_hkd TEXT,
  account_eur TEXT,
  iban TEXT,
  sort_code TEXT,
  aba_routing_number TEXT,
  swift_code TEXT,
  bank_code TEXT,
  intermediary_bank_name TEXT,
  intermediary_bank_swift TEXT,
  has_multiple_accounts BOOLEAN DEFAULT false,
  default_account_id UUID,
  vat_number TEXT,
  eori_number TEXT,
  gstin_number TEXT,
  bir_tin TEXT,
  payment_penalty_rate NUMERIC(10, 6),
  currency TEXT DEFAULT 'USD'
);

CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(name);

-- ========================================
-- INVOICES
-- ========================================

CREATE TABLE IF NOT EXISTS invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_date TIMESTAMPTZ NOT NULL,
  invoice_due_date TIMESTAMPTZ,
  invoice_received_date TIMESTAMPTZ,
  date_range_start TIMESTAMPTZ,
  date_range_end TIMESTAMPTZ,
  invoice_version TEXT,
  invoice_version_notes TEXT,
  parent_invoice_id UUID,
  vendor_id UUID REFERENCES vendors(id),
  amount NUMERIC(15, 2) NOT NULL,
  amount_original NUMERIC(15, 2),
  currency_original TEXT,
  exchange_rate_to_usd NUMERIC(10, 6),
  currency TEXT DEFAULT 'USD',
  payment_terms "PaymentTerms" NOT NULL DEFAULT 'OTHER',
  payment_term_split TEXT,
  incoterm TEXT,
  bank_charges NUMERIC(15, 2) DEFAULT 0,
  shipping_charges NUMERIC(15, 2) DEFAULT 0,
  customs_charges NUMERIC(15, 2) DEFAULT 0,
  documentation_charges NUMERIC(15, 2) DEFAULT 0,
  surcharges NUMERIC(15, 2) DEFAULT 0,
  invoice_type "InvoiceType" NOT NULL,
  category "InvoiceCategory" NOT NULL,
  order_type "OrderType",
  brand TEXT,
  brand_tier "BrandTier",
  season TEXT,
  mpo_number TEXT,
  po_number TEXT,
  po_reference_raw TEXT,
  bill_to_name TEXT NOT NULL,
  bill_to_address TEXT NOT NULL,
  bill_to_entity "MadisonEntity" NOT NULL DEFAULT 'MADISON_88_LTD',
  final_approver_name TEXT,
  final_approval_date TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  is_handwritten BOOLEAN DEFAULT false,
  is_priority BOOLEAN DEFAULT false,
  priority_pay_date TIMESTAMPTZ,
  payment_consolidation_note TEXT,
  qb_memo TEXT,
  qb_account_class TEXT,
  qb_invoice_id TEXT,
  sharepoint_url TEXT,
  status "InvoiceStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
  ocr_raw_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_bill_to_entity ON invoices(bill_to_entity);

-- ========================================
-- SIGNATURES
-- ========================================

CREATE TABLE IF NOT EXISTS signatures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  signer_name TEXT,
  signer_role "SignatureRole" NOT NULL,
  signed_at TIMESTAMPTZ,
  is_digital BOOLEAN DEFAULT true,
  ocr_detected BOOLEAN DEFAULT false,
  ocr_confidence NUMERIC(10, 6)
);

CREATE INDEX IF NOT EXISTS idx_signatures_invoice_id ON signatures(invoice_id);
CREATE INDEX IF NOT EXISTS idx_signatures_signer_role ON signatures(signer_role);

-- ========================================
-- AUDIT LOGS
-- ========================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id ON audit_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ========================================
-- EXCEPTIONS
-- ========================================

CREATE TABLE IF NOT EXISTS exceptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reason "ExceptionReason" NOT NULL,
  status "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
  detail TEXT NOT NULL,
  resolved_by UUID,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exceptions_invoice_id ON exceptions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_reason ON exceptions(reason);
CREATE INDEX IF NOT EXISTS idx_exceptions_resolved_at ON exceptions(resolved_at);

-- ========================================
-- STAGE TIMESTAMPS
-- ========================================

CREATE TABLE IF NOT EXISTS stage_timestamps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  stage "ApprovalStage" NOT NULL,
  assignee_name TEXT,
  entered_at TIMESTAMPTZ NOT NULL,
  exited_at TIMESTAMPTZ,
  duration_hours NUMERIC(10, 2),
  sla_hours INTEGER NOT NULL,
  is_breached BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_stage_timestamps_invoice_id ON stage_timestamps(invoice_id);
CREATE INDEX IF NOT EXISTS idx_stage_timestamps_stage ON stage_timestamps(stage);

-- ========================================
-- PAYMENT BATCHES
-- ========================================

CREATE TABLE IF NOT EXISTS payment_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_number TEXT NOT NULL UNIQUE,
  total_amount NUMERIC(15, 2) NOT NULL,
  payment_count INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  status "PaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
  created_by UUID,
  processed_by UUID,
  processed_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- PAYMENTS
-- ========================================

CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  vendor_id UUID,
  amount NUMERIC(15, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  payment_date TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'SCHEDULED',
  batch_id UUID REFERENCES payment_batches(id),
  paid_at TIMESTAMPTZ,
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_timestamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for vendors" ON vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for invoices" ON invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for signatures" ON signatures FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for exceptions" ON exceptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for stage_timestamps" ON stage_timestamps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for payments" ON payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for payment_batches" ON payment_batches FOR ALL USING (true) WITH CHECK (true);

-- ========================================
-- TRIGGERS
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS 
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
 LANGUAGE plpgsql;

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for invoice files
-- Note: Create in Supabase dashboard: Storage -> New Bucket -> invoices -> Public: false
