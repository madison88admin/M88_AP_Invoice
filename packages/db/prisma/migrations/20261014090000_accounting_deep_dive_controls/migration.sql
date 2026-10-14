-- Accounting deep-dive controls: permanent AP reference, duplicate/revision
-- review metadata, source/retention metadata, and QuickBooks reconciliation.

ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "ap_record_id" TEXT,
  ADD COLUMN IF NOT EXISTS "normalized_invoice_number" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_review_status" TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
  ADD COLUMN IF NOT EXISTS "duplicate_review_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_reviewed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicate_reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "source_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_attachment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_received_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retention_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "legal_hold" BOOLEAN NOT NULL DEFAULT false;

UPDATE "APInvoice_Invoice"
SET "ap_record_id" = 'AP-' || to_char(COALESCE("created_at", now()), 'YYYY') || '-' || upper(left(replace("id", '-', ''), 12))
WHERE "ap_record_id" IS NULL;

ALTER TABLE "APInvoice_Invoice"
  ALTER COLUMN "ap_record_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "APInvoice_Invoice_ap_record_id_key"
  ON "APInvoice_Invoice"("ap_record_id");
CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_normalized_invoice_number_idx"
  ON "APInvoice_Invoice"("normalized_invoice_number");
CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_duplicate_review_status_idx"
  ON "APInvoice_Invoice"("duplicate_review_status");
CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_retention_until_legal_hold_idx"
  ON "APInvoice_Invoice"("retention_until", "legal_hold");

CREATE TABLE IF NOT EXISTS "APInvoice_DuplicateRevisionReview" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "candidate_invoice_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "classification" TEXT,
  "reason" TEXT,
  "evidence" JSONB,
  "matching_indicators" JSONB,
  "reviewer_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_DuplicateRevisionReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_DuplicateRevisionReview_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "APInvoice_DuplicateRevisionReview_candidate_invoice_id_fkey"
    FOREIGN KEY ("candidate_invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "APInvoice_DuplicateRevisionReview_invoice_id_status_idx"
  ON "APInvoice_DuplicateRevisionReview"("invoice_id", "status");
CREATE INDEX IF NOT EXISTS "APInvoice_DuplicateRevisionReview_candidate_invoice_id_idx"
  ON "APInvoice_DuplicateRevisionReview"("candidate_invoice_id");

CREATE TABLE IF NOT EXISTS "APInvoice_QuickBooksReconciliation" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "result" TEXT NOT NULL,
  "qb_transaction_id" TEXT,
  "qb_reference" TEXT,
  "qb_vendor_name" TEXT,
  "qb_invoice_number" TEXT,
  "qb_amount" DECIMAL(15,2),
  "qb_open_balance" DECIMAL(15,2),
  "difference_amount" DECIMAL(15,2),
  "exception_code" TEXT,
  "review_owner" TEXT,
  "comments" TEXT,
  "source" TEXT,
  "resolution_status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "resolution_evidence" JSONB,
  "reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_QuickBooksReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_QuickBooksReconciliation_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "APInvoice_QuickBooksReconciliation"
  ALTER COLUMN "invoice_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "APInvoice_QuickBooksReconciliation_invoice_id_reconciled_at_idx"
  ON "APInvoice_QuickBooksReconciliation"("invoice_id", "reconciled_at");
CREATE INDEX IF NOT EXISTS "APInvoice_QuickBooksReconciliation_result_resolution_status_idx"
  ON "APInvoice_QuickBooksReconciliation"("result", "resolution_status");

ALTER TABLE "APInvoice_VendorBankChangeRequest"
  ADD COLUMN IF NOT EXISTS "phone_validation_confirmation" TEXT,
  ADD COLUMN IF NOT EXISTS "supporting_documents" JSONB;

ALTER TABLE "APInvoice_Payment"
  ADD COLUMN IF NOT EXISTS "hold_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "hold_evidence" JSONB,
  ADD COLUMN IF NOT EXISTS "hold_owner" TEXT,
  ADD COLUMN IF NOT EXISTS "hold_review_date" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "APInvoice_VendorBankVersion" (
  "id" TEXT NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "effective_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "beneficiary_name" TEXT,
  "bank_name" TEXT,
  "bank_address" TEXT,
  "account_number" TEXT,
  "swift_code" TEXT,
  "iban" TEXT,
  "sort_code" TEXT,
  "aba_routing_number" TEXT,
  "intermediary_bank_name" TEXT,
  "intermediary_bank_swift" TEXT,
  "currency" TEXT,
  "payment_method" TEXT,
  "requested_by" TEXT,
  "approved_by" TEXT,
  "approval_timestamp" TIMESTAMP(3),
  "source_request_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "APInvoice_VendorBankVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_VendorBankVersion_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "APInvoice_Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "APInvoice_VendorBankVersion_vendor_id_version_key"
  ON "APInvoice_VendorBankVersion"("vendor_id", "version");
CREATE INDEX IF NOT EXISTS "APInvoice_VendorBankVersion_vendor_id_status_idx"
  ON "APInvoice_VendorBankVersion"("vendor_id", "status");

-- Establish version 1 for existing vendors so historical/current master data
-- has a baseline before the next approved change creates version 2.
INSERT INTO "APInvoice_VendorBankVersion" (
  "id", "vendor_id", "version", "status", "effective_date",
  "beneficiary_name", "bank_name", "bank_address", "account_number",
  "swift_code", "iban", "sort_code", "aba_routing_number",
  "intermediary_bank_name", "intermediary_bank_swift", "created_at"
)
SELECT
  md5(v."id" || ':bank-v1'), v."id", 1, 'ACTIVE', COALESCE(v."bank_verified_at", v."created_at", CURRENT_TIMESTAMP),
  v."beneficiary_name", v."bank_name", v."bank_address", v."account_number",
  v."swift_code", v."iban", v."sort_code", v."aba_routing_number",
  v."intermediary_bank_name", v."intermediary_bank_swift", CURRENT_TIMESTAMP
FROM "APInvoice_Vendor" v
WHERE NOT EXISTS (
  SELECT 1 FROM "APInvoice_VendorBankVersion" b
  WHERE b."vendor_id" = v."id" AND b."version" = 1
);
