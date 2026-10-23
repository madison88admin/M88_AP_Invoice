-- Weekly payment scheduling, purchasing decisions and QuickBooks import controls.
ALTER TABLE "APInvoice_Invoice" ADD COLUMN IF NOT EXISTS "qb_open_balance" DECIMAL(15,2);
ALTER TABLE "APInvoice_Invoice" ADD COLUMN IF NOT EXISTS "qb_balance_as_of" TIMESTAMP(3);

ALTER TABLE "APInvoice_Payment" ADD COLUMN IF NOT EXISTS "below_threshold_decision" TEXT;
ALTER TABLE "APInvoice_Payment" ADD COLUMN IF NOT EXISTS "below_threshold_reason" TEXT;
ALTER TABLE "APInvoice_Payment" ADD COLUMN IF NOT EXISTS "below_threshold_decided_by" TEXT;
ALTER TABLE "APInvoice_Payment" ADD COLUMN IF NOT EXISTS "below_threshold_decided_at" TIMESTAMP(3);
ALTER TABLE "APInvoice_Payment" ADD COLUMN IF NOT EXISTS "below_threshold_deadline" TIMESTAMP(3);
ALTER TABLE "APInvoice_Payment" ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "APInvoice_PaymentBatch" ADD COLUMN IF NOT EXISTS "weekly_schedule_ref" TEXT;
ALTER TABLE "APInvoice_PaymentBatch" ADD COLUMN IF NOT EXISTS "weekly_cutoff_date" TIMESTAMP(3);
ALTER TABLE "APInvoice_PaymentBatch" ADD COLUMN IF NOT EXISTS "weekly_as_of_date" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "APInvoice_PaymentBatch_weekly_schedule_ref_idx" ON "APInvoice_PaymentBatch"("weekly_schedule_ref");

ALTER TABLE "APInvoice_QuickBooksReconciliation" ADD COLUMN IF NOT EXISTS "report_as_of_date" TIMESTAMP(3);
ALTER TABLE "APInvoice_QuickBooksReconciliation" ADD COLUMN IF NOT EXISTS "source_filename" TEXT;
ALTER TABLE "APInvoice_QuickBooksReconciliation" ADD COLUMN IF NOT EXISTS "import_key" TEXT;
CREATE INDEX IF NOT EXISTS "APInvoice_QuickBooksReconciliation_import_key_idx" ON "APInvoice_QuickBooksReconciliation"("import_key");
CREATE INDEX IF NOT EXISTS "APInvoice_QuickBooksReconciliation_qb_transaction_id_idx" ON "APInvoice_QuickBooksReconciliation"("qb_transaction_id");
