ALTER TABLE "APInvoice_CorrectionLog"
  ADD COLUMN IF NOT EXISTS "ground_truth_status" TEXT NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS "dataset_split" TEXT NOT NULL DEFAULT 'fewshot',
  ADD COLUMN IF NOT EXISTS "model_name" TEXT,
  ADD COLUMN IF NOT EXISTS "prompt_version" TEXT,
  ADD COLUMN IF NOT EXISTS "extraction_path" TEXT;

CREATE INDEX IF NOT EXISTS "APInvoice_CorrectionLog_dataset_split_ground_truth_status_approved_for_learning_idx"
  ON "APInvoice_CorrectionLog"("dataset_split", "ground_truth_status", "approved_for_learning");

-- Existing rows receive legacy_unknown/fewshot from additive column defaults.
-- Do not infer reviewer confirmation from their historical learning flag.
