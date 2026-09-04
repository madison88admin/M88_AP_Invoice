-- QuickBooks "Pay Bills"-style payment setup on a payment batch, chosen by the
-- Accounting Associate while the batch is DRAFT / RETURNED_FOR_CORRECTION:
--   payment_method       CHECK | EFT | WIRE
--   payment_bank_account free-text company bank account used for the run
--   payment_date         the intended payment date for the whole batch (QB Pay Bills date)
ALTER TABLE "APInvoice_PaymentBatch" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "APInvoice_PaymentBatch" ADD COLUMN "payment_bank_account" TEXT;
ALTER TABLE "APInvoice_PaymentBatch" ADD COLUMN "payment_date" TIMESTAMP(3);
