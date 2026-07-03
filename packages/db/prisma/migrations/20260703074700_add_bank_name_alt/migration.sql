-- AlterTable
ALTER TABLE "APInvoice_Vendor" ADD COLUMN "bank_name_alt" TEXT[];
ALTER TABLE "APInvoice_Vendor" ADD COLUMN "swift_code_alt" TEXT[];
ALTER TABLE "APInvoice_Invoice" ADD COLUMN "hs_code" TEXT;
