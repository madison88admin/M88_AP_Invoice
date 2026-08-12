-- CreateTable
CREATE TABLE "AP_Invoice"."APInvoice_BillStub" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "payment_id" TEXT NOT NULL,
    "stub_date" TIMESTAMP(3),
    "type" TEXT,
    "reference" TEXT,
    "original_amount" DECIMAL(15,2),
    "balance" DECIMAL(15,2),
    "discount" DECIMAL(15,2),
    "paid_amount" DECIMAL(15,2),
    "proof_file_url" TEXT,
    "proof_file_name" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_BillStub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_BillStub_payment_id_key" ON "AP_Invoice"."APInvoice_BillStub"("payment_id");
CREATE INDEX "APInvoice_BillStub_batch_id_idx" ON "AP_Invoice"."APInvoice_BillStub"("batch_id");

-- AddForeignKey
ALTER TABLE "AP_Invoice"."APInvoice_BillStub" ADD CONSTRAINT "APInvoice_BillStub_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "AP_Invoice"."APInvoice_PaymentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AP_Invoice"."APInvoice_BillStub" ADD CONSTRAINT "APInvoice_BillStub_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "AP_Invoice"."APInvoice_Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
