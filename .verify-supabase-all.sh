#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')

echo "=== Invoices created via MANUAL_UPLOAD source — pdf_path and raw_file_url status ==="
psql "$DBURL" -c "
SELECT invoice_number, 
       CASE 
         WHEN pdf_path IS NULL THEN 'NULL'
         WHEN pdf_path LIKE 'invoices/%' THEN 'SUPABASE'
         WHEN pdf_path LIKE '/incoming%' THEN 'LOCAL'
         ELSE 'OTHER'
       END as pdf_path_type,
       CASE 
         WHEN raw_file_url IS NULL THEN 'NULL'
         WHEN raw_file_url LIKE 'invoices/%' THEN 'SUPABASE'
         ELSE 'OTHER'
       END as raw_file_url_type,
       source,
       created_at
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE source = 'MANUAL_UPLOAD'
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC
LIMIT 15;
" 2>&1

echo ""
echo "=== Summary: all sources ==="
psql "$DBURL" -c "
SELECT source,
       CASE 
         WHEN pdf_path IS NULL THEN 'NULL'
         WHEN pdf_path LIKE 'invoices/%' THEN 'SUPABASE'
         WHEN pdf_path LIKE '/incoming%' THEN 'LOCAL'
         ELSE 'OTHER'
       END as path_type,
       COUNT(*) as count
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY source, path_type
ORDER BY source, path_type;
" 2>&1
