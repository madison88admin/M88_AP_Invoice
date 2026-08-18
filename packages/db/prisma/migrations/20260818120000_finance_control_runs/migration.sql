CREATE TABLE IF NOT EXISTS "APInvoice_FinanceControlRun" (
  "id" TEXT PRIMARY KEY,
  "run_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "summary" JSONB,
  "error" TEXT,
  "initiated_by" TEXT
);
CREATE TABLE IF NOT EXISTS "APInvoice_FinanceControlFinding" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL REFERENCES "APInvoice_FinanceControlRun"("id") ON DELETE CASCADE,
  "invoice_id" TEXT,
  "payment_id" TEXT,
  "code" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "APInvoice_FinanceControlFinding_run_id_fingerprint_key" ON "APInvoice_FinanceControlFinding"("run_id", "fingerprint");
CREATE INDEX IF NOT EXISTS "APInvoice_FinanceControlRun_run_type_started_at_idx" ON "APInvoice_FinanceControlRun"("run_type", "started_at");
CREATE INDEX IF NOT EXISTS "APInvoice_FinanceControlRun_status_idx" ON "APInvoice_FinanceControlRun"("status");
CREATE INDEX IF NOT EXISTS "APInvoice_FinanceControlFinding_invoice_id_idx" ON "APInvoice_FinanceControlFinding"("invoice_id");
CREATE INDEX IF NOT EXISTS "APInvoice_FinanceControlFinding_code_status_idx" ON "APInvoice_FinanceControlFinding"("code", "status");
