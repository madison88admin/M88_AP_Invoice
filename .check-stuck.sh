#!/bin/bash
echo "=== CHECKPOINT SYSTEMS invoices over time ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL'
SELECT
  invoice_number,
  created_at,
  ROUND(ocr_confidence_score::numeric, 2) as confidence,
  status::text
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE vendor_name_raw ILIKE '%CHECKPOINT%'
ORDER BY created_at;
SQL

echo ""
echo "=== CHECKPOINT corrections over time ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL2'
SELECT
  created_at,
  use_count,
  note
FROM "AP_Invoice"."APInvoice_CorrectionLog"
WHERE vendor_name ILIKE '%CHECKPOINT%'
ORDER BY created_at;
SQL2

echo ""
echo "=== Same for C&T LABEL (3 corrections, 3 use_count) ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL3'
SELECT
  invoice_number,
  created_at,
  ROUND(ocr_confidence_score::numeric, 2) as confidence,
  status::text
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE vendor_name_raw ILIKE '%C%T%LABEL%' OR vendor_name_raw ILIKE '%CTLABEL%'
ORDER BY created_at;
SQL3

echo ""
echo "=== C&T corrections ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL4'
SELECT created_at, use_count, note
FROM "AP_Invoice"."APInvoice_CorrectionLog"
WHERE vendor_name ILIKE '%C%T%LABEL%' OR vendor_name ILIKE '%CTLABEL%'
ORDER BY created_at;
SQL4

echo ""
echo "=== Rudholm (3 corrections, 3 use_count) ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL5'
SELECT invoice_number, created_at, ROUND(ocr_confidence_score::numeric, 2) as confidence, status::text
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE vendor_name_raw ILIKE '%RUDHOLM%'
ORDER BY created_at;
SQL5

echo ""
echo "=== Rudholm corrections ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL6'
SELECT created_at, use_count, note
FROM "AP_Invoice"."APInvoice_CorrectionLog"
WHERE vendor_name ILIKE '%RUDHOLM%'
ORDER BY created_at;
SQL6
