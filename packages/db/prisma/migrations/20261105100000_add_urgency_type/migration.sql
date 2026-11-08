ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "urgency_type" TEXT;

CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_urgency_type_idx"
  ON "APInvoice_Invoice"("urgency_type");
