-- Currency-aware QuickBooks reconciliation and immutable Citibank confirmation imports.
ALTER TABLE "APInvoice_QuickBooksReconciliation" ADD COLUMN IF NOT EXISTS "qb_currency" TEXT;
ALTER TABLE "APInvoice_Invoice" ADD COLUMN IF NOT EXISTS "qb_bank_charge_included" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "batch_id" TEXT;
ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "import_id" TEXT;
ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "allocated_amount" DECIMAL(15,2);
ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "bank_transaction_reference" TEXT;
ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "payment_date" TIMESTAMP(3);
ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'SUPPLIER_EMAIL';
ALTER TABLE "APInvoice_PaymentConfirmation" ADD COLUMN IF NOT EXISTS "confirmation_fingerprint" TEXT;

CREATE TABLE IF NOT EXISTS "APInvoice_PaymentConfirmationImport" (
  "id" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "storage_path" TEXT,
  "mime_type" TEXT,
  "source" TEXT NOT NULL DEFAULT 'CITIBANK_UPLOAD',
  "uploaded_by" TEXT,
  "batch_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "error_message" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "APInvoice_PaymentConfirmationImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmationImport_sha256_key" ON "APInvoice_PaymentConfirmationImport"("sha256");
CREATE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmationImport_batch_id_idx" ON "APInvoice_PaymentConfirmationImport"("batch_id");
CREATE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmationImport_status_received_at_idx" ON "APInvoice_PaymentConfirmationImport"("status", "received_at");

CREATE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmation_batch_id_idx" ON "APInvoice_PaymentConfirmation"("batch_id");
CREATE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmation_import_id_idx" ON "APInvoice_PaymentConfirmation"("import_id");
CREATE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmation_payment_reference_idx" ON "APInvoice_PaymentConfirmation"("payment_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "APInvoice_PaymentConfirmation_confirmation_fingerprint_key" ON "APInvoice_PaymentConfirmation"("confirmation_fingerprint");
CREATE INDEX IF NOT EXISTS "APInvoice_QuickBooksReconciliation_qb_currency_idx" ON "APInvoice_QuickBooksReconciliation"("qb_currency");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'APInvoice_PaymentConfirmation_batch_id_fkey') THEN
    ALTER TABLE "APInvoice_PaymentConfirmation"
      ADD CONSTRAINT "APInvoice_PaymentConfirmation_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "APInvoice_PaymentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'APInvoice_PaymentConfirmation_import_id_fkey') THEN
    ALTER TABLE "APInvoice_PaymentConfirmation"
      ADD CONSTRAINT "APInvoice_PaymentConfirmation_import_id_fkey"
      FOREIGN KEY ("import_id") REFERENCES "APInvoice_PaymentConfirmationImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'APInvoice_PaymentConfirmationImport_batch_id_fkey') THEN
    ALTER TABLE "APInvoice_PaymentConfirmationImport"
      ADD CONSTRAINT "APInvoice_PaymentConfirmationImport_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "APInvoice_PaymentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
