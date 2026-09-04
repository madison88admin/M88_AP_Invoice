CREATE TABLE "APInvoice_EmailIntakeEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mailbox" TEXT,
    "message_id" TEXT,
    "attachment_id" TEXT,
    "file_name" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "invoice_id" TEXT,
    "error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "APInvoice_EmailIntakeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "APInvoice_EmailIntakeEvent_created_at_idx" ON "APInvoice_EmailIntakeEvent"("created_at");
CREATE INDEX "APInvoice_EmailIntakeEvent_source_created_at_idx" ON "APInvoice_EmailIntakeEvent"("source", "created_at");
CREATE INDEX "APInvoice_EmailIntakeEvent_message_id_idx" ON "APInvoice_EmailIntakeEvent"("message_id");
CREATE INDEX "APInvoice_EmailIntakeEvent_status_created_at_idx" ON "APInvoice_EmailIntakeEvent"("status", "created_at");
