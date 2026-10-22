-- Align payment batches with the accounting manual: Associate prepares,
-- Supervisor reviews, and CFO approves when bank controls require it.
ALTER TYPE "PaymentBatchStatus" ADD VALUE IF NOT EXISTS 'PENDING_CFO';

ALTER TABLE "APInvoice_PaymentBatch"
  ADD COLUMN IF NOT EXISTS "cfo_approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "cfo_approved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cfo_note" TEXT;
