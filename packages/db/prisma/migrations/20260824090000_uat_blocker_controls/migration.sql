ALTER TYPE "PaymentBatchStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "PaymentBatchStatus" ADD VALUE IF NOT EXISTS 'BANK_PROCESSED';
ALTER TYPE "PaymentBatchStatus" ADD VALUE IF NOT EXISTS 'PENDING_CFO_APPROVAL';
ALTER TYPE "PaymentBatchStatus" ADD VALUE IF NOT EXISTS 'PAID';

ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN "hold_started_at" TIMESTAMP(3),
  ADD COLUMN "hold_confirmation_due_at" TIMESTAMP(3),
  ADD COLUMN "hold_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "hold_confirmed_by" TEXT,
  ADD COLUMN "hold_reason" TEXT;

ALTER TABLE "APInvoice_Vendor"
  ADD COLUMN "governance_status" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "governance_requested_by" TEXT,
  ADD COLUMN "governance_requested_at" TIMESTAMP(3),
  ADD COLUMN "governance_reviewed_by" TEXT,
  ADD COLUMN "governance_reviewed_at" TIMESTAMP(3),
  ADD COLUMN "governance_rejection_reason" TEXT;

CREATE TABLE "APInvoice_VendorMasterChangeRequest" (
  "id" TEXT NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "proposed_data" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requested_by" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "reviewed_by" TEXT,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "APInvoice_VendorMasterChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_VendorMasterChangeRequest_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "APInvoice_Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "APInvoice_VendorMasterChangeRequest_vendor_id_status_idx" ON "APInvoice_VendorMasterChangeRequest"("vendor_id", "status");
CREATE INDEX "APInvoice_VendorMasterChangeRequest_status_created_at_idx" ON "APInvoice_VendorMasterChangeRequest"("status", "created_at");
