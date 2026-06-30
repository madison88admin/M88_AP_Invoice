-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'PROFORMA', 'COMMERCIAL', 'SALES', 'STATEMENT', 'PREPAID', 'PROTO_SAMPLE');

-- CreateEnum
CREATE TYPE "InvoiceTemplateType" AS ENUM ('PRO_FORMA', 'INVOICE', 'COMMERCIAL_INVOICE', 'SALES_INVOICE', 'PROTO_SAMPLE_INVOICE', 'PREPAID_INVOICE', 'NO_DATA');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RECEIVED', 'OCR_PROCESSING', 'VALIDATION_PENDING', 'EXCEPTION_FLAGGED', 'PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY', 'PENDING_ACCOUNTING', 'APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID', 'REJECTED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "SignatoryRole" AS ENUM ('COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY', 'ACCOUNTING_REVIEWER');

-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('WET', 'DIGITAL', 'COMPUTER_GENERATED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('BULK', 'SMS', 'SAMPLE');

-- CreateEnum
CREATE TYPE "ExceptionReason" AS ENUM ('AMOUNT_MISMATCH', 'VENDOR_NOT_FOUND', 'DUPLICATE_INVOICE', 'MISSING_SIGNATURE', 'MISSING_BANK_INFO', 'BANK_DETAIL_MISMATCH', 'OCR_LOW_CONFIDENCE', 'LATE_SUBMISSION', 'HANDWRITTEN_DOCUMENT', 'MISSING_PO_REFERENCE', 'MULTI_PO_CONSOLIDATED', 'MISSING_BRAND_TIER');

-- CreateEnum
CREATE TYPE "BillToEntity" AS ENUM ('MADISON_88_LTD', 'MADISON_88_HK_LIMITED');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('EMAIL', 'MANUAL_UPLOAD', 'PORTAL');

-- CreateEnum
CREATE TYPE "InvoiceCategory" AS ENUM ('TRIMS', 'YARN', 'SAMPLE_CHARGES', 'SHIPPING_FREIGHT', 'LAB_TESTING', 'FACTORY', 'FACTORY_AUDIT', 'PROFESSIONAL_FEE', 'SMS', 'CONSULTATION');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('PENDING', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentBatchStatus" AS ENUM ('DRAFT', 'PENDING_CFO', 'APPROVED', 'PROCESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BrandTier" AS ENUM ('TOP_10', 'OTHER');

-- CreateTable
CREATE TABLE "APInvoice_Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_aliases" TEXT[],
    "beneficiary_name" TEXT,
    "supplier_location" TEXT,
    "invoice_template_type" "InvoiceTemplateType" NOT NULL,
    "bank_name" TEXT,
    "bank_address" TEXT,
    "account_number" TEXT,
    "swift_code" TEXT,
    "iban" TEXT,
    "sort_code" TEXT,
    "aba_routing_number" TEXT,
    "intermediary_bank_name" TEXT,
    "intermediary_bank_swift" TEXT,
    "has_multiple_accounts" BOOLEAN NOT NULL DEFAULT false,
    "gstin_number" TEXT,
    "bir_tin" TEXT,
    "vat_number" TEXT,
    "eori_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "onboarded_by" TEXT,
    "bank_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APInvoice_Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_Invoice" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3),
    "invoice_received_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "subtotal" DECIMAL(65,30),
    "tax_amount" DECIMAL(65,30),
    "discount_amount" DECIMAL(65,30),
    "bank_charges" DECIMAL(65,30),
    "freight_charges" DECIMAL(65,30),
    "additional_charges" DECIMAL(65,30),
    "total_amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "invoice_currency_original" TEXT,
    "exchange_rate_to_usd" DECIMAL(65,30),
    "vendor_id" TEXT NOT NULL,
    "vendor_name_raw" TEXT NOT NULL,
    "ship_to" TEXT,
    "sold_to" TEXT,
    "customer_po_number" TEXT,
    "mpo_number" TEXT,
    "brand_code" TEXT,
    "brand" TEXT,
    "brand_tier" "BrandTier",
    "season" TEXT,
    "order_type" "OrderType",
    "incoterm" TEXT,
    "invoice_type" "InvoiceType" NOT NULL,
    "invoice_template_type" "InvoiceTemplateType",
    "parent_invoice_id" TEXT,
    "date_range_start" TIMESTAMP(3),
    "date_range_end" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "approval_tier" INTEGER,
    "current_approver_role" TEXT,
    "priority_flag" BOOLEAN NOT NULL DEFAULT false,
    "priority_pay_date" TIMESTAMP(3),
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "ocr_confidence_score" DECIMAL(65,30),
    "is_handwritten" BOOLEAN NOT NULL DEFAULT false,
    "exception_reasons" "ExceptionReason"[],
    "invoice_hash" TEXT,
    "bank_match_status" TEXT,
    "bank_match_details" JSONB,
    "qb_memo" TEXT,
    "qb_account_class" TEXT,
    "qb_posted_at" TIMESTAMP(3),
    "sharepoint_folder_url" TEXT,
    "sharepoint_filed_at" TIMESTAMP(3),
    "bill_to_entity" "BillToEntity" NOT NULL DEFAULT 'MADISON_88_LTD',
    "payment_terms" TEXT,
    "payment_penalty_rate" DECIMAL(65,30),
    "source" "InvoiceSource" NOT NULL DEFAULT 'EMAIL',
    "raw_file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APInvoice_Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_Signature" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "signatory_name" TEXT NOT NULL,
    "signatory_role" "SignatoryRole" NOT NULL,
    "signed_at" TIMESTAMP(3),
    "signature_type" "SignatureType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_StageTimestamp" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "stage" "InvoiceStatus" NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMP(3),
    "sla_hours" INTEGER NOT NULL,
    "is_breached" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "APInvoice_StageTimestamp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_AuditLog" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "action" TEXT NOT NULL,
    "performed_by" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_Payment" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payment_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "batch_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "reference" TEXT,
    "selected_for_batch" BOOLEAN NOT NULL DEFAULT false,
    "selected_by" TEXT,
    "selected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APInvoice_Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_PaymentBatch" (
    "id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "payment_count" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "processed_by" TEXT,
    "processed_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_PaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_FollowUpTask" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "last_reminded_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APInvoice_FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "APInvoice_Exception" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "reason" "ExceptionReason" NOT NULL,
    "detail" TEXT,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "resolved_by" TEXT,
    "resolution_notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_Exception_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "APInvoice_Vendor_name_idx" ON "APInvoice_Vendor"("name");

-- CreateIndex
CREATE INDEX "APInvoice_Vendor_is_active_idx" ON "APInvoice_Vendor"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_Invoice_invoice_number_key" ON "APInvoice_Invoice"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_Invoice_invoice_hash_key" ON "APInvoice_Invoice"("invoice_hash");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_vendor_id_idx" ON "APInvoice_Invoice"("vendor_id");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_status_idx" ON "APInvoice_Invoice"("status");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_invoice_date_idx" ON "APInvoice_Invoice"("invoice_date");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_invoice_type_idx" ON "APInvoice_Invoice"("invoice_type");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_bill_to_entity_idx" ON "APInvoice_Invoice"("bill_to_entity");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_approval_tier_idx" ON "APInvoice_Invoice"("approval_tier");

-- CreateIndex
CREATE INDEX "APInvoice_Invoice_invoice_hash_idx" ON "APInvoice_Invoice"("invoice_hash");

-- CreateIndex
CREATE INDEX "APInvoice_Signature_invoice_id_idx" ON "APInvoice_Signature"("invoice_id");

-- CreateIndex
CREATE INDEX "APInvoice_Signature_signatory_role_idx" ON "APInvoice_Signature"("signatory_role");

-- CreateIndex
CREATE INDEX "APInvoice_StageTimestamp_invoice_id_idx" ON "APInvoice_StageTimestamp"("invoice_id");

-- CreateIndex
CREATE INDEX "APInvoice_StageTimestamp_stage_idx" ON "APInvoice_StageTimestamp"("stage");

-- CreateIndex
CREATE INDEX "APInvoice_AuditLog_invoice_id_idx" ON "APInvoice_AuditLog"("invoice_id");

-- CreateIndex
CREATE INDEX "APInvoice_AuditLog_created_at_idx" ON "APInvoice_AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "APInvoice_Payment_invoice_id_idx" ON "APInvoice_Payment"("invoice_id");

-- CreateIndex
CREATE INDEX "APInvoice_Payment_status_idx" ON "APInvoice_Payment"("status");

-- CreateIndex
CREATE INDEX "APInvoice_Payment_selected_for_batch_idx" ON "APInvoice_Payment"("selected_for_batch");

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_PaymentBatch_batch_number_key" ON "APInvoice_PaymentBatch"("batch_number");

-- CreateIndex
CREATE INDEX "APInvoice_FollowUpTask_invoice_id_idx" ON "APInvoice_FollowUpTask"("invoice_id");

-- CreateIndex
CREATE INDEX "APInvoice_FollowUpTask_assigned_to_idx" ON "APInvoice_FollowUpTask"("assigned_to");

-- CreateIndex
CREATE INDEX "APInvoice_FollowUpTask_status_idx" ON "APInvoice_FollowUpTask"("status");

-- CreateIndex
CREATE INDEX "APInvoice_FollowUpTask_due_date_idx" ON "APInvoice_FollowUpTask"("due_date");

-- CreateIndex
CREATE INDEX "APInvoice_Exception_invoice_id_idx" ON "APInvoice_Exception"("invoice_id");

-- CreateIndex
CREATE INDEX "APInvoice_Exception_status_idx" ON "APInvoice_Exception"("status");

-- AddForeignKey
ALTER TABLE "APInvoice_Invoice" ADD CONSTRAINT "APInvoice_Invoice_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "APInvoice_Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_Invoice" ADD CONSTRAINT "APInvoice_Invoice_parent_invoice_id_fkey" FOREIGN KEY ("parent_invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_Signature" ADD CONSTRAINT "APInvoice_Signature_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_StageTimestamp" ADD CONSTRAINT "APInvoice_StageTimestamp_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_AuditLog" ADD CONSTRAINT "APInvoice_AuditLog_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_Payment" ADD CONSTRAINT "APInvoice_Payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_Payment" ADD CONSTRAINT "APInvoice_Payment_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "APInvoice_PaymentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_FollowUpTask" ADD CONSTRAINT "APInvoice_FollowUpTask_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APInvoice_Exception" ADD CONSTRAINT "APInvoice_Exception_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "APInvoice_Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
