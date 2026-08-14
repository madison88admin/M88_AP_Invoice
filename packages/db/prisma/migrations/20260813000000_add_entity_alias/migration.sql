-- CreateTable: coordinator-editable vendor/brand name aliases for NextGen comparisons
CREATE TABLE "AP_Invoice"."APInvoice_EntityAlias" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "APInvoice_EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "APInvoice_EntityAlias_entity_type_alias_key" ON "AP_Invoice"."APInvoice_EntityAlias"("entity_type", "alias");
CREATE INDEX "APInvoice_EntityAlias_entity_type_canonical_idx" ON "AP_Invoice"."APInvoice_EntityAlias"("entity_type", "canonical");
