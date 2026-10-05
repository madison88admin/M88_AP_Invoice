-- Remove temporary debug triggers that referenced the deleted DebugInsertLog table.
-- Without this cleanup every APInvoice_User insert fails before the row is written.
DROP TRIGGER IF EXISTS trg_log_user_insert ON "AP_Invoice"."APInvoice_User";
DROP TRIGGER IF EXISTS trg_log_user_insert_after ON "AP_Invoice"."APInvoice_User";
DROP FUNCTION IF EXISTS "AP_Invoice".log_insert_attempt();
DROP FUNCTION IF EXISTS "AP_Invoice".log_insert_success();
