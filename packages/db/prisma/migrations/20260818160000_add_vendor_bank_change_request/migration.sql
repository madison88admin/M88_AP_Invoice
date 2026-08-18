-- Persisted vendor-master bank change requests so the requester can never
-- approve their own change (requester != approver). Created via
-- POST /api/vendors/:id/request-bank-update; approved when Accounting applies
-- the change through /api/vendors/:id/bank-details or the dedicated
-- approve/reject endpoints.
CREATE TABLE IF NOT EXISTS "APInvoice_VendorBankChangeRequest" (
  "id" TEXT PRIMARY KEY,
  "vendor_id" TEXT NOT NULL REFERENCES "APInvoice_Vendor"("id") ON DELETE CASCADE,
  "field" TEXT NOT NULL,
  "current_value" TEXT,
  "requested_value" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "APInvoice_VendorBankChangeRequest_vendor_id_idx" ON "APInvoice_VendorBankChangeRequest"("vendor_id");
CREATE INDEX IF NOT EXISTS "APInvoice_VendorBankChangeRequest_status_idx" ON "APInvoice_VendorBankChangeRequest"("status");
