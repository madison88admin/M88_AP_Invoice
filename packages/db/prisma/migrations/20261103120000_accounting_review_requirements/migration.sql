-- Structured evidence for urgent/late invoices and explicit due-date approval-impact review.
ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "priority_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "priority_evidence_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "late_submission_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "late_submission_source" TEXT,
  ADD COLUMN IF NOT EXISTS "hold_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "hold_evidence_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "hold_owner" TEXT,
  ADD COLUMN IF NOT EXISTS "hold_review_date" TIMESTAMP(3);

ALTER TABLE "APInvoice_InvoiceDueDateChangeRequest"
  ADD COLUMN IF NOT EXISTS "approval_impact_review" TEXT;

ALTER TABLE "APInvoice_PaymentBatch"
  ADD COLUMN IF NOT EXISTS "execution_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_bank" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_remarks" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_proof_url" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_proof_name" TEXT;
