-- Add the system user ID that signed each workflow signature so returned
-- invoices can be matched to their owner by user ID instead of by name.
ALTER TABLE "APInvoice_Signature"
  ADD COLUMN "signatory_user_id" TEXT;

CREATE INDEX "APInvoice_Signature_signatory_user_id_idx" ON "APInvoice_Signature"("signatory_user_id");
