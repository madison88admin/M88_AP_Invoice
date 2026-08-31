-- Preserve the domestic routing value used to authorize a payment. US vendor
-- records may legitimately use ABA routing instead of SWIFT.
ALTER TABLE "AP_Invoice"."APInvoice_Payment"
  ADD COLUMN IF NOT EXISTS "aba_routing_number_snapshot" TEXT;
