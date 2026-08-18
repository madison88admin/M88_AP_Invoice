ALTER TABLE "APInvoice_AuditLog"
  ADD COLUMN "actor_name" TEXT,
  ADD COLUMN "actor_role" TEXT,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "correlation_id" TEXT;

CREATE TABLE "APInvoice_ValidationSnapshot" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "invoice_revision" INTEGER NOT NULL,
  "validation_state" TEXT NOT NULL,
  "source_system" TEXT NOT NULL DEFAULT 'NEXTGEN',
  "source_version" TEXT,
  "request_fingerprint" TEXT NOT NULL,
  "response_fingerprint" TEXT,
  "request_payload" JSONB,
  "response_payload" JSONB,
  "rule_results" JSONB NOT NULL,
  "vendor_id_invoice" TEXT,
  "vendor_id_source" TEXT,
  "retrieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "superseded_at" TIMESTAMP(3),
  CONSTRAINT "APInvoice_ValidationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_ValidationSnapshot_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "APInvoice_ValidationSnapshot_invoice_id_retrieved_at_idx" ON "APInvoice_ValidationSnapshot"("invoice_id", "retrieved_at");
CREATE INDEX "APInvoice_ValidationSnapshot_request_fingerprint_idx" ON "APInvoice_ValidationSnapshot"("request_fingerprint");

CREATE TABLE "APInvoice_AsyncJob" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "job_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB,
  "result" JSONB,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMP(3),
  "claimed_by" TEXT,
  "completed_at" TIMESTAMP(3),
  "idempotency_key" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_AsyncJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "APInvoice_AsyncJob_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "APInvoice_AsyncJob_idempotency_key_key" ON "APInvoice_AsyncJob"("idempotency_key");
CREATE INDEX "APInvoice_AsyncJob_status_available_at_idx" ON "APInvoice_AsyncJob"("status", "available_at");
CREATE INDEX "APInvoice_AsyncJob_invoice_id_job_type_idx" ON "APInvoice_AsyncJob"("invoice_id", "job_type");

ALTER TABLE "APInvoice_FinanceControlFinding"
  ADD COLUMN "assigned_to" TEXT,
  ADD COLUMN "acknowledged_by" TEXT,
  ADD COLUMN "acknowledged_at" TIMESTAMP(3),
  ADD COLUMN "resolved_by" TEXT,
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "reopened_by" TEXT,
  ADD COLUMN "reopened_at" TIMESTAMP(3),
  ADD COLUMN "escalated_to" TEXT,
  ADD COLUMN "escalated_at" TIMESTAMP(3),
  ADD COLUMN "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
