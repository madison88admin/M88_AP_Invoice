#!/bin/bash
echo "=== VENDOR DATABASE SUMMARY ==="
echo ""

PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
-- Total vendors
SELECT count(*) AS total_vendors FROM "AP_Invoice"."APInvoice_Vendor";

-- Vendors with bank details
SELECT count(*) AS vendors_with_bank 
FROM "AP_Invoice"."APInvoice_Vendor" 
WHERE bank_name IS NOT NULL AND bank_name != '';

-- Vendors with SWIFT
SELECT count(*) AS vendors_with_swift 
FROM "AP_Invoice"."APInvoice_Vendor" 
WHERE swift_code IS NOT NULL AND swift_code != '';

-- Vendors with account number
SELECT count(*) AS vendors_with_account 
FROM "AP_Invoice"."APInvoice_Vendor" 
WHERE account_number IS NOT NULL AND account_number != '';

-- Recently added vendors
SELECT name, created_at::date AS added_date 
FROM "AP_Invoice"."APInvoice_Vendor" 
ORDER BY created_at DESC LIMIT 10;

-- Vendors without bank details
SELECT count(*) AS vendors_without_bank 
FROM "AP_Invoice"."APInvoice_Vendor" 
WHERE (bank_name IS NULL OR bank_name = '') 
AND (swift_code IS NULL OR swift_code = '');

-- Sample vendors with full details
SELECT name, bank_name, swift_code, account_number, has_multiple_accounts
FROM "AP_Invoice"."APInvoice_Vendor" 
WHERE bank_name IS NOT NULL AND bank_name != ''
ORDER BY name LIMIT 15;
SQL
