#!/bin/bash
echo "=== Backfill mpo_base_number for existing invoices ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
-- Update invoices that have mpo_number but no mpo_base_number
-- Extract base MPO using regex (MPO followed by 5-8 digits)
UPDATE "AP_Invoice"."APInvoice_Invoice"
SET mpo_base_number = UPPER(SUBSTRING(mpo_number FROM 'MPO[0-9]{5,8}')),
    mpo_order_sequence = CASE
        WHEN mpo_number ~ 'MPO[0-9]{5,8}-[0-9]+' THEN SUBSTRING(mpo_number FROM 'MPO[0-9]{5,8}-([0-9]+)')
        ELSE NULL
    END
WHERE mpo_number IS NOT NULL
  AND mpo_number != ''
  AND (mpo_base_number IS NULL OR mpo_base_number = '')
  AND mpo_number ~* 'MPO[0-9]{5,8}';

-- Show updated rows
SELECT invoice_number, mpo_number, mpo_base_number, mpo_order_sequence
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE mpo_number IS NOT NULL AND mpo_number != ''
ORDER BY created_at DESC
LIMIT 20;
SQL
