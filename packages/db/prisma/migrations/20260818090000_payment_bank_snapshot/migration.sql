ALTER TABLE "AP_Invoice"."APInvoice_Payment"
  ADD COLUMN IF NOT EXISTS "beneficiary_name_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_name_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_address_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "swift_code_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "account_number_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_snapshot_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_snapshot_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vendor_bank_verified_at_snapshot" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invoice_revision_snapshot" INTEGER;

CREATE INDEX IF NOT EXISTS "APInvoice_Payment_invoice_id_status_idx"
  ON "AP_Invoice"."APInvoice_Payment"("invoice_id", "status");
