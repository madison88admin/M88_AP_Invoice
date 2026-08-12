-- AlterTable: bank charge applied at batch time, carried by one payment per batch
ALTER TABLE "AP_Invoice"."APInvoice_Payment" ADD COLUMN "bank_charge_amount" DECIMAL(15,2);
ALTER TABLE "AP_Invoice"."APInvoice_Payment" ADD COLUMN "bank_charge_note" TEXT;
