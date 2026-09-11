-- Preserve AP audit history when a supplier cancels an invoice.  Cancellation
-- is a terminal invoice state; records and their approval history are retained.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "cancellation_requested_by" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellation_requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellation_request_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

CREATE INDEX IF NOT EXISTS "APInvoice_Invoice_status_cancelled_at_idx"
  ON "APInvoice_Invoice"("status", "cancelled_at");
