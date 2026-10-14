ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "workflow_status" TEXT NOT NULL DEFAULT 'RECEIVED';

CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_workflow_status_idx"
  ON "APInvoice_Invoice"("workflow_status");

ALTER TABLE "APInvoice_EmailIntakeEvent"
  ADD COLUMN IF NOT EXISTS "intake_id" TEXT;

CREATE INDEX IF NOT EXISTS "APInvoice_EmailIntakeEvent_intake_id_created_at_idx"
  ON "APInvoice_EmailIntakeEvent"("intake_id", "created_at");

UPDATE "APInvoice_EmailIntakeEvent"
SET "intake_id" = COALESCE("intake_id", "message_id")
WHERE "intake_id" IS NULL;

-- A fixed system bucket keeps unmatched OCR suppliers searchable without
-- creating a new Vendor Master record from invoice text.
INSERT INTO "APInvoice_Vendor" (
  "id", "name", "name_aliases", "invoice_template_type", "classification", "is_active"
)
SELECT
  '00000000-0000-0000-0000-000000000001', 'UNKNOWN VENDOR', ARRAY[]::TEXT[], 'NO_DATA', 'SYSTEM_PLACEHOLDER', true
WHERE NOT EXISTS (
  SELECT 1 FROM "APInvoice_Vendor"
  WHERE lower(trim("name")) = lower('UNKNOWN VENDOR')
);
