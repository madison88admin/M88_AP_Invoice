-- Historical intake recovery cases and controlled retention/disposal queue.

CREATE TABLE IF NOT EXISTS "APInvoice_IntakeRecoveryCase" (
  "id" TEXT NOT NULL,
  "intake_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "message_id" TEXT,
  "attachment_id" TEXT,
  "file_name" TEXT NOT NULL DEFAULT '',
  "storage_path" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SOURCE_RECOVERY_REQUIRED',
  "reason" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "recovered_invoice_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_IntakeRecoveryCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_IntakeRecoveryCase_intake_id_key" UNIQUE ("intake_id")
);
CREATE INDEX IF NOT EXISTS "APInvoice_IntakeRecoveryCase_status_created_idx"
  ON "APInvoice_IntakeRecoveryCase"("status", "created_at");
CREATE INDEX IF NOT EXISTS "APInvoice_IntakeRecoveryCase_source_created_idx"
  ON "APInvoice_IntakeRecoveryCase"("source", "created_at");
CREATE INDEX IF NOT EXISTS "APInvoice_IntakeRecoveryCase_file_name_idx"
  ON "APInvoice_IntakeRecoveryCase"("file_name");

CREATE TABLE IF NOT EXISTS "APInvoice_RetentionDisposition" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "retention_until" TIMESTAMP(3),
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "backup_verified_at" TIMESTAMP(3),
  "backup_reference" TEXT,
  "backup_hash" TEXT,
  "eligible_at" TIMESTAMP(3),
  "disposed_at" TIMESTAMP(3),
  "disposed_by" TEXT,
  "disposition_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_RetentionDisposition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_RetentionDisposition_invoice_id_key" UNIQUE ("invoice_id"),
  CONSTRAINT "APInvoice_RetentionDisposition_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "APInvoice_RetentionDisposition_status_retention_idx"
  ON "APInvoice_RetentionDisposition"("status", "retention_until");
CREATE INDEX IF NOT EXISTS "APInvoice_RetentionDisposition_hold_retention_idx"
  ON "APInvoice_RetentionDisposition"("legal_hold", "retention_until");

INSERT INTO "APInvoice_RetentionDisposition" (
  "id", "invoice_id", "retention_until", "legal_hold", "status", "created_at", "updated_at"
)
SELECT md5(i."id" || ':retention-disposition'), i."id", i."retention_until", i."legal_hold", 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "APInvoice_Invoice" i
WHERE NOT EXISTS (
  SELECT 1 FROM "APInvoice_RetentionDisposition" r WHERE r."invoice_id" = i."id"
);
