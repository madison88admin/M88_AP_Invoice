ALTER TABLE "AP_Invoice"."APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "source_document_type" TEXT,
  ADD COLUMN IF NOT EXISTS "structured_source_format" TEXT,
  ADD COLUMN IF NOT EXISTS "document_layout_fingerprint" TEXT;

ALTER TABLE "AP_Invoice"."APInvoice_InvoiceLine"
  ADD COLUMN IF NOT EXISTS "received_quantity" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "accepted_quantity" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "previously_invoiced_quantity" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "remaining_receivable_quantity" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "extraction_confidence" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "field_confidence" JSONB,
  ADD COLUMN IF NOT EXISTS "extraction_provenance" JSONB,
  ADD COLUMN IF NOT EXISTS "source_evidence" JSONB;

ALTER TABLE "AP_Invoice"."APInvoice_CorrectionLog"
  ADD COLUMN IF NOT EXISTS "vendor_scope_key" TEXT,
  ADD COLUMN IF NOT EXISTS "layout_fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_for_learning" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "validation_success_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "validation_failure_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "APInvoice_CorrectionLog_vendor_scope_key_approved_for_learning_disabled_at_idx"
  ON "AP_Invoice"."APInvoice_CorrectionLog"("vendor_scope_key", "approved_for_learning", "disabled_at");

UPDATE "AP_Invoice"."APInvoice_CorrectionLog"
SET "vendor_scope_key" = lower(regexp_replace(trim(coalesce("vendor_name", '')), '[^a-zA-Z0-9]+', '', 'g'))
WHERE "vendor_scope_key" IS NULL;
