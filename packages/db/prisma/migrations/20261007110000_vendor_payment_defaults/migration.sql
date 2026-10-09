-- Supplier-list defaults used only when an invoice has no extracted/manual
-- payment terms. Existing invoice values are never overwritten.
ALTER TABLE "AP_Invoice"."APInvoice_Vendor"
  ADD COLUMN IF NOT EXISTS "default_payment_terms" TEXT;

ALTER TABLE "AP_Invoice"."APInvoice_Vendor"
  ADD COLUMN IF NOT EXISTS "accepted_document_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
