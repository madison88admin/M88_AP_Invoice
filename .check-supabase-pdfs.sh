#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Recent invoices: pdf_path status ==="
psql "$DBURL" -c "
SELECT invoice_number, 
       CASE 
         WHEN pdf_path IS NULL THEN 'NULL'
         WHEN pdf_path LIKE 'invoices/%' OR pdf_path LIKE 'http%' THEN 'SUPABASE'
         WHEN pdf_path LIKE '/incoming-invoices%' THEN 'LOCAL'
         ELSE 'OTHER'
       END as path_type,
       pdf_path,
       created_at
FROM \"AP_Invoice\".\"APInvoice_Invoice\" 
ORDER BY created_at DESC 
LIMIT 20;
" 2>&1

echo ""
echo "=== Summary: path types ==="
psql "$DBURL" -c "
SELECT 
  CASE 
    WHEN pdf_path IS NULL THEN 'NULL'
    WHEN pdf_path LIKE 'invoices/%' OR pdf_path LIKE 'http%' THEN 'SUPABASE'
    WHEN pdf_path LIKE '/incoming-invoices%' THEN 'LOCAL'
    ELSE 'OTHER'
  END as path_type,
  COUNT(*) as count
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
GROUP BY path_type
ORDER BY count DESC;
" 2>&1

echo ""
echo "=== Invoices with LOCAL path (last 30 days) ==="
psql "$DBURL" -c "
SELECT invoice_number, status, pdf_path, created_at
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE pdf_path LIKE '/incoming-invoices%'
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC
LIMIT 20;
" 2>&1
