-- Purchasing coordinators can request due-date corrections after approval.
-- Accounting Supervisor approval is required before the invoice is changed.
CREATE TABLE IF NOT EXISTS "APInvoice_InvoiceDueDateChangeRequest" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "current_due_date" TIMESTAMP(3),
  "requested_due_date" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewed_by" TEXT,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "APInvoice_InvoiceDueDateChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_InvoiceDueDateChangeRequest_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "APInvoice_InvoiceDueDateChangeRequest_invoice_id_status_idx"
  ON "APInvoice_InvoiceDueDateChangeRequest"("invoice_id", "status");
CREATE INDEX IF NOT EXISTS "APInvoice_InvoiceDueDateChangeRequest_status_requested_due_date_idx"
  ON "APInvoice_InvoiceDueDateChangeRequest"("status", "requested_due_date");
