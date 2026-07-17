-- Invoice repository, revision-aware approvals, material-line matching, and
-- Accounting Associate -> Supervisor Review -> Associate execution workflow.

DROP INDEX IF EXISTS "APInvoice_Invoice_invoice_number_key";
DROP INDEX IF EXISTS "APInvoice_Invoice_invoice_hash_key";

ALTER TABLE "APInvoice_Invoice"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "mpo_base_number" TEXT,
  ADD COLUMN "mpo_order_sequence" TEXT,
  ADD COLUMN "material_code" TEXT,
  ADD COLUMN "material_name" TEXT;

CREATE INDEX "APInvoice_Invoice_invoice_number_vendor_id_invoice_type_idx"
  ON "APInvoice_Invoice"("invoice_number", "vendor_id", "invoice_type");
CREATE INDEX "APInvoice_Invoice_mpo_base_number_mpo_order_sequence_material_code_idx"
  ON "APInvoice_Invoice"("mpo_base_number", "mpo_order_sequence", "material_code");

ALTER TABLE "APInvoice_Signature"
  ADD COLUMN "invoice_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "approval_status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "invalidated_at" TIMESTAMP(3),
  ADD COLUMN "invalidation_reason" TEXT;

CREATE TABLE "APInvoice_InvoiceLine" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "description" TEXT,
  "mpo_base_number" TEXT,
  "mpo_order_sequence" TEXT,
  "material_code" TEXT,
  "material_name" TEXT,
  "quantity" DECIMAL(65,30),
  "selling_quantity" DECIMAL(65,30),
  "unit_price" DECIMAL(65,30),
  "line_amount" DECIMAL(65,30),
  "matched_nextgen_line_id" TEXT,
  "match_level" TEXT,
  "match_confidence" DECIMAL(65,30),
  "match_status" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_InvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "APInvoice_InvoiceLine_invoice_id_line_number_key"
  ON "APInvoice_InvoiceLine"("invoice_id", "line_number");
CREATE INDEX "APInvoice_InvoiceLine_mpo_base_number_mpo_order_sequence_material_code_idx"
  ON "APInvoice_InvoiceLine"("mpo_base_number", "mpo_order_sequence", "material_code");
ALTER TABLE "APInvoice_InvoiceLine" ADD CONSTRAINT "APInvoice_InvoiceLine_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "APInvoice_WorkflowAction" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "invoice_revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "from_stage" TEXT,
  "to_stage" TEXT,
  "reason" TEXT,
  "performed_by" TEXT NOT NULL,
  "performed_by_role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "APInvoice_WorkflowAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "APInvoice_WorkflowAction_invoice_id_created_at_idx"
  ON "APInvoice_WorkflowAction"("invoice_id", "created_at");
ALTER TABLE "APInvoice_WorkflowAction" ADD CONSTRAINT "APInvoice_WorkflowAction_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "PaymentBatchStatus" RENAME TO "PaymentBatchStatus_old";
CREATE TYPE "PaymentBatchStatus" AS ENUM (
  'DRAFT', 'PENDING_SUPERVISOR_REVIEW', 'RETURNED_FOR_CORRECTION', 'REVIEWED',
  'EXPORTED_TO_BANK', 'PROCESSING', 'PROCESSED', 'PARTIALLY_PAID', 'FAILED', 'CANCELLED'
);
ALTER TABLE "APInvoice_PaymentBatch" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "APInvoice_PaymentBatch" ALTER COLUMN "status" TYPE "PaymentBatchStatus"
USING (
  CASE "status"::text
    WHEN 'PENDING_CFO' THEN 'PENDING_SUPERVISOR_REVIEW'
    WHEN 'APPROVED' THEN 'REVIEWED'
    ELSE "status"::text
  END
)::"PaymentBatchStatus";
ALTER TABLE "APInvoice_PaymentBatch" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "PaymentBatchStatus_old";

ALTER TABLE "APInvoice_PaymentBatch"
  ADD COLUMN "submitted_by" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "review_note" TEXT,
  ADD COLUMN "returned_by" TEXT,
  ADD COLUMN "returned_at" TIMESTAMP(3),
  ADD COLUMN "return_reason" TEXT;
