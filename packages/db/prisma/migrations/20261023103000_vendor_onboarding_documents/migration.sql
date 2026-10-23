-- Supporting documents uploaded when a vendor is added to the masterlist.
CREATE TABLE IF NOT EXISTS "APInvoice_VendorDocument" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL DEFAULT 'SUPPLIER_SUPPORTING_DOCUMENT',
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_VendorDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "APInvoice_VendorDocument_vendor_id_idx"
  ON "APInvoice_VendorDocument"("vendor_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'APInvoice_VendorDocument_vendor_id_fkey'
  ) THEN
    ALTER TABLE "APInvoice_VendorDocument"
      ADD CONSTRAINT "APInvoice_VendorDocument_vendor_id_fkey"
      FOREIGN KEY ("vendor_id") REFERENCES "APInvoice_Vendor"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Purchasing Coordinator vendor-master requests reviewed by Accounting Associate.
CREATE TABLE IF NOT EXISTS "APInvoice_VendorMasterChangeRequest" (
    "id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "vendor_id" TEXT,
    "proposed_data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "attachment_filename" TEXT,
    "attachment_data" BYTEA,
    "attachment_mimetype" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "synced_invoice_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_VendorMasterChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "APInvoice_VendorMasterChangeRequest_status_created_at_idx"
  ON "APInvoice_VendorMasterChangeRequest"("status", "created_at");
CREATE INDEX IF NOT EXISTS "APInvoice_VendorMasterChangeRequest_vendor_id_status_idx"
  ON "APInvoice_VendorMasterChangeRequest"("vendor_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'APInvoice_VendorMasterChangeRequest_vendor_id_fkey'
  ) THEN
    ALTER TABLE "APInvoice_VendorMasterChangeRequest"
      ADD CONSTRAINT "APInvoice_VendorMasterChangeRequest_vendor_id_fkey"
      FOREIGN KEY ("vendor_id") REFERENCES "APInvoice_Vendor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
