-- Support courier/other invoices that combine multiple shipment types.
ALTER TYPE "AP_Invoice"."OrderType" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "AP_Invoice"."OrderTypeCombination" AS ENUM (
  'COMBINED_BULK_SMS',
  'COMBINED_SMS_SAMPLE',
  'COMBINED_BULK_SAMPLE',
  'COMBINED_ALL'
);

ALTER TABLE "AP_Invoice"."APInvoice_Invoice"
  ADD COLUMN IF NOT EXISTS "order_type_detail" "AP_Invoice"."OrderTypeCombination";
