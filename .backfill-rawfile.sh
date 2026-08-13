#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')

echo "=== Backfill raw_file_url from pdf_path ==="
psql "$DBURL" -c "UPDATE \"AP_Invoice\".\"APInvoice_Invoice\" SET raw_file_url = pdf_path WHERE pdf_path LIKE 'invoices/%' AND (raw_file_url IS NULL OR raw_file_url = '');" 2>&1

echo ""
echo "=== Verify ==="
psql "$DBURL" -c "
SELECT 
  CASE 
    WHEN pdf_path IS NULL THEN 'NULL'
    WHEN pdf_path LIKE 'invoices/%' THEN 'SUPABASE'
    ELSE 'OTHER'
  END as pdf_path,
  CASE 
    WHEN raw_file_url IS NULL THEN 'NULL'
    WHEN raw_file_url LIKE 'invoices/%' THEN 'SUPABASE'
    ELSE 'OTHER'
  END as raw_file_url,
  COUNT(*) as count
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY pdf_path, raw_file_url
ORDER BY count DESC;
" 2>&1
