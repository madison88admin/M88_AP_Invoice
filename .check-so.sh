#!/bin/bash
echo "=== Invoices matching SO20261266 ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL'
SELECT invoice_number, status::text, vendor_name_raw, total_amount, currency,
       ocr_confidence_score, mpo_number, brand, pdf_path, created_at
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE invoice_number ILIKE '%SO20261266%'
   OR customer_po_number ILIKE '%SO20261266%'
   OR mpo_number ILIKE '%SO20261266%'
ORDER BY created_at DESC LIMIT 10;
SQL

echo ""
echo "=== Exceptions ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL2'
SELECT i.invoice_number, e.reason::text, e.detail
FROM "AP_Invoice"."APInvoice_Exception" e
JOIN "AP_Invoice"."APInvoice_Invoice" i ON e.invoice_id = i.id
WHERE i.invoice_number ILIKE '%SO20261266%';
SQL2

echo ""
echo "=== Files ==="
echo "manual-review:"
ls -la /incoming-invoices/manual-review/ | grep -i SO20261266
echo "failed:"
ls -la /incoming-invoices/failed/ | grep -i SO20261266
echo "processed:"
ls -la /incoming-invoices/processed/ | grep -i SO20261266
