-- Accounting gap controls: immutable invoice-level bank snapshots and a
-- searchable review queue for non-payable/ambiguous intake attachments.

ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "line_items_signature" TEXT;

CREATE TABLE IF NOT EXISTS "APInvoice_InvoiceBankSnapshot" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "vendor_id" TEXT,
  "vendor_bank_version_id" TEXT,
  "beneficiary_name" TEXT,
  "bank_name" TEXT,
  "bank_address" TEXT,
  "account_number" TEXT,
  "swift_code" TEXT,
  "iban" TEXT,
  "sort_code" TEXT,
  "aba_routing_number" TEXT,
  "intermediary_bank_name" TEXT,
  "intermediary_bank_swift" TEXT,
  "snapshot_hash" TEXT NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "captured_by" TEXT,
  "source" TEXT NOT NULL DEFAULT 'INVOICE_INTAKE',
  CONSTRAINT "APInvoice_InvoiceBankSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_InvoiceBankSnapshot_invoice_id_key" UNIQUE ("invoice_id"),
  CONSTRAINT "APInvoice_InvoiceBankSnapshot_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "APInvoice_InvoiceBankSnapshot_vendor_id_idx"
  ON "APInvoice_InvoiceBankSnapshot"("vendor_id");
CREATE INDEX IF NOT EXISTS "APInvoice_InvoiceBankSnapshot_vendor_bank_version_id_idx"
  ON "APInvoice_InvoiceBankSnapshot"("vendor_bank_version_id");

-- Backfill every historical invoice once so later Vendor Master changes can
-- never rewrite a record that predates this migration. The deterministic id
-- and hash make this safe to re-run on partially migrated databases.
INSERT INTO "APInvoice_InvoiceBankSnapshot" (
  "id", "invoice_id", "vendor_id", "vendor_bank_version_id",
  "beneficiary_name", "bank_name", "account_number", "swift_code",
  "iban", "sort_code", "aba_routing_number", "intermediary_bank_name",
  "intermediary_bank_swift", "snapshot_hash", "source"
)
SELECT
  md5(i."id" || ':bank-snapshot'),
  i."id",
  i."vendor_id",
  vb."id",
  COALESCE(i."beneficiary_name", v."beneficiary_name"),
  COALESCE(i."bank_name", v."bank_name"),
  COALESCE(i."account_number", v."account_number"),
  COALESCE(i."swift_code", v."swift_code"),
  v."iban",
  v."sort_code",
  v."aba_routing_number",
  v."intermediary_bank_name",
  v."intermediary_bank_swift",
  md5(concat_ws('|', COALESCE(i."beneficiary_name", v."beneficiary_name", ''), COALESCE(i."bank_name", v."bank_name", ''), COALESCE(i."account_number", v."account_number", ''), COALESCE(i."swift_code", v."swift_code", ''), COALESCE(v."iban", ''), COALESCE(v."sort_code", ''))),
  'MIGRATION_BACKFILL'
FROM "APInvoice_Invoice" i
JOIN "APInvoice_Vendor" v ON v."id" = i."vendor_id"
LEFT JOIN LATERAL (
  SELECT "id" FROM "APInvoice_VendorBankVersion"
  WHERE "vendor_id" = i."vendor_id" AND "status" = 'ACTIVE'
  ORDER BY "version" DESC
  LIMIT 1
) vb ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM "APInvoice_InvoiceBankSnapshot" s WHERE s."invoice_id" = i."id"
);

CREATE TABLE IF NOT EXISTS "APInvoice_InvoiceBankSnapshotRevision" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "vendor_bank_version_id" TEXT,
  "beneficiary_name" TEXT,
  "bank_name" TEXT,
  "bank_address" TEXT,
  "account_number" TEXT,
  "swift_code" TEXT,
  "iban" TEXT,
  "sort_code" TEXT,
  "aba_routing_number" TEXT,
  "intermediary_bank_name" TEXT,
  "intermediary_bank_swift" TEXT,
  "snapshot_hash" TEXT NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "captured_by" TEXT,
  "source" TEXT NOT NULL,
  CONSTRAINT "APInvoice_InvoiceBankSnapshotRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_InvoiceBankSnapshotRevision_invoice_revision_key" UNIQUE ("invoice_id", "revision"),
  CONSTRAINT "APInvoice_InvoiceBankSnapshotRevision_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "APInvoice_InvoiceBankSnapshotRevision_invoice_id_captured_at_idx"
  ON "APInvoice_InvoiceBankSnapshotRevision"("invoice_id", "captured_at");

-- Preserve the backfilled/current snapshot as revision 1 for historical rows.
INSERT INTO "APInvoice_InvoiceBankSnapshotRevision" (
  "id", "invoice_id", "revision", "vendor_bank_version_id", "beneficiary_name",
  "bank_name", "bank_address", "account_number", "swift_code", "iban", "sort_code",
  "aba_routing_number", "intermediary_bank_name", "intermediary_bank_swift",
  "snapshot_hash", "captured_at", "captured_by", "source"
)
SELECT md5(s."id" || ':revision:1'), s."invoice_id", 1, s."vendor_bank_version_id", s."beneficiary_name",
  s."bank_name", s."bank_address", s."account_number", s."swift_code", s."iban", s."sort_code",
  s."aba_routing_number", s."intermediary_bank_name", s."intermediary_bank_swift", s."snapshot_hash",
  s."captured_at", s."captured_by", s."source"
FROM "APInvoice_InvoiceBankSnapshot" s
WHERE NOT EXISTS (
  SELECT 1 FROM "APInvoice_InvoiceBankSnapshotRevision" r
  WHERE r."invoice_id" = s."invoice_id" AND r."revision" = 1
);

CREATE TABLE IF NOT EXISTS "APInvoice_IntakeReviewRecord" (
  "id" TEXT NOT NULL,
  "intake_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "mailbox" TEXT,
  "message_id" TEXT,
  "attachment_id" TEXT,
  "file_name" TEXT NOT NULL DEFAULT '',
  "storage_path" TEXT,
  "document_type" TEXT,
  "invoice_number" TEXT,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "metadata" JSONB,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_IntakeReviewRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_IntakeReviewRecord_intake_file_key" UNIQUE ("intake_id", "file_name")
);
CREATE INDEX IF NOT EXISTS "APInvoice_IntakeReviewRecord_status_created_idx"
  ON "APInvoice_IntakeReviewRecord"("status", "created_at");
CREATE INDEX IF NOT EXISTS "APInvoice_IntakeReviewRecord_source_created_idx"
  ON "APInvoice_IntakeReviewRecord"("source", "created_at");
CREATE INDEX IF NOT EXISTS "APInvoice_IntakeReviewRecord_invoice_number_idx"
  ON "APInvoice_IntakeReviewRecord"("invoice_number");
