-- The invoice list endpoint sorts by created_at (optionally filtered by the
-- role-accessible statuses), which previously required a full sort of the table.
CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_created_at_idx" ON "APInvoice_Invoice"("created_at");
CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_status_created_at_idx" ON "APInvoice_Invoice"("status", "created_at");
