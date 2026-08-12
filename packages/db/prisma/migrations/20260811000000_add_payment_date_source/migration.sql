-- AlterTable
ALTER TABLE "AP_Invoice"."APInvoice_Payment" ADD COLUMN "payment_date_source" TEXT NOT NULL DEFAULT 'DUE_DATE';

-- Backfill existing rows using the same inference the app previously computed
-- in memory (date equality with invoice.due_date):
--   * date matches due date (or due date missing and payment date = posting fallback)
--   * DUE_DATE  → payment date derived from invoice.due_date
--   * DEFAULT   → invoice had no due date (fallback = posting date)
--   * MANUAL    → date was explicitly typed
UPDATE "AP_Invoice"."APInvoice_Payment" p
SET "payment_date_source" = CASE
  WHEN i."due_date" IS NOT NULL
       AND date_trunc('day', p."payment_date") = date_trunc('day', i."due_date") THEN 'DUE_DATE'
  WHEN i."due_date" IS NULL THEN 'DEFAULT'
  ELSE 'MANUAL'
END
FROM "AP_Invoice"."APInvoice_Invoice" i
WHERE i."id" = p."invoice_id";
