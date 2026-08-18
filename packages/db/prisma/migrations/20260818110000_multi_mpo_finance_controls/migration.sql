ALTER TABLE "APInvoice_InvoiceLine"
  ADD COLUMN IF NOT EXISTS "unit_of_measure" TEXT,
  ADD COLUMN IF NOT EXISTS "nextgen_unit_of_measure" TEXT,
  ADD COLUMN IF NOT EXISTS "previously_invoiced_amount" DECIMAL,
  ADD COLUMN IF NOT EXISTS "remaining_invoiceable_amount" DECIMAL,
  ADD COLUMN IF NOT EXISTS "nextgen_unit_price" DECIMAL;
