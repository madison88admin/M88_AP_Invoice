CREATE TABLE "AP_Invoice"."APInvoice_VendorBillStub" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "vendor_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "total_amount" DECIMAL(15,2) NOT NULL,
  "payment_reference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "return_reason" TEXT,
  "returned_by" TEXT,
  "returned_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "APInvoice_VendorBillStub_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AP_Invoice"."APInvoice_VendorBillStubLine" (
  "id" TEXT NOT NULL,
  "bill_stub_id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "APInvoice_VendorBillStubLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "APInvoice_VendorBillStubLine_payment_id_key" ON "AP_Invoice"."APInvoice_VendorBillStubLine"("payment_id");
CREATE INDEX "APInvoice_VendorBillStub_batch_id_idx" ON "AP_Invoice"."APInvoice_VendorBillStub"("batch_id");
CREATE INDEX "APInvoice_VendorBillStub_vendor_id_idx" ON "AP_Invoice"."APInvoice_VendorBillStub"("vendor_id");
CREATE INDEX "APInvoice_VendorBillStubLine_bill_stub_id_idx" ON "AP_Invoice"."APInvoice_VendorBillStubLine"("bill_stub_id");
CREATE INDEX "APInvoice_VendorBillStubLine_invoice_id_idx" ON "AP_Invoice"."APInvoice_VendorBillStubLine"("invoice_id");
ALTER TABLE "AP_Invoice"."APInvoice_VendorBillStub" ADD CONSTRAINT "APInvoice_VendorBillStub_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "AP_Invoice"."APInvoice_PaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AP_Invoice"."APInvoice_VendorBillStub" ADD CONSTRAINT "APInvoice_VendorBillStub_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "AP_Invoice"."APInvoice_Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AP_Invoice"."APInvoice_VendorBillStubLine" ADD CONSTRAINT "APInvoice_VendorBillStubLine_bill_stub_id_fkey" FOREIGN KEY ("bill_stub_id") REFERENCES "AP_Invoice"."APInvoice_VendorBillStub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AP_Invoice"."APInvoice_VendorBillStubLine" ADD CONSTRAINT "APInvoice_VendorBillStubLine_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "AP_Invoice"."APInvoice_Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
