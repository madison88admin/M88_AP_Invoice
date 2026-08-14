-- Add exported_at to PaymentBatch — records when a reviewed batch was exported
-- to the bank. Used by the stuck-batch alert to measure how long a batch has
-- sat in EXPORTED_TO_BANK without its payments being endorsed / confirmed PAID.
ALTER TABLE "AP_Invoice"."APInvoice_PaymentBatch" ADD COLUMN "exported_at" TIMESTAMP(3);
