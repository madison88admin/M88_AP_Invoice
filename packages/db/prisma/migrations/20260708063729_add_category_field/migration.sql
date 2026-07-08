-- AlterEnum
ALTER TYPE "ExceptionReason" ADD VALUE 'PO_NOT_FOUND';

-- AlterTable
ALTER TABLE "APInvoice_Invoice" ADD COLUMN     "account_number" TEXT,
ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "category" "InvoiceCategory" NOT NULL DEFAULT 'TRIMS',
ADD COLUMN     "ocr_raw_data" JSONB,
ADD COLUMN     "po_validation" JSONB,
ADD COLUMN     "qty_shipped" INTEGER,
ADD COLUMN     "swift_code" TEXT;

-- AlterTable
ALTER TABLE "APInvoice_Signature" ADD COLUMN     "ocr_detected" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "APInvoice_CorrectionLog" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "vendor_name" TEXT,
    "invoice_template_type" TEXT,
    "raw_text" TEXT,
    "original_fields" JSONB,
    "corrected_fields" JSONB,
    "note" TEXT,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "APInvoice_CorrectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "APInvoice_CorrectionLog_vendor_name_idx" ON "APInvoice_CorrectionLog"("vendor_name");

-- CreateIndex
CREATE INDEX "APInvoice_CorrectionLog_invoice_template_type_idx" ON "APInvoice_CorrectionLog"("invoice_template_type");

-- CreateIndex
CREATE INDEX "APInvoice_CorrectionLog_use_count_idx" ON "APInvoice_CorrectionLog"("use_count");

-- CreateIndex
CREATE INDEX "APInvoice_CorrectionLog_created_at_idx" ON "APInvoice_CorrectionLog"("created_at");
