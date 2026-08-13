#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Check if local PDF files exist for LOCAL path invoices ==="
psql "$DBURL" -t -A -c "
SELECT id || '|' || invoice_number || '|' || pdf_path
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE pdf_path LIKE '/incoming-invoices%'
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
" 2>&1 | while IFS='|' read -r id invnum path; do
  if [ -z "$path" ]; then continue; fi
  if [ -f "$path" ]; then
    SIZE=$(stat -c%s "$path" 2>/dev/null)
    echo "EXISTS  | $invnum | ${SIZE}B | $path"
  else
    echo "MISSING | $invnum | $path"
  fi
done

echo ""
echo "=== NULL path invoices ==="
psql "$DBURL" -c "
SELECT id, invoice_number, status, created_at
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE (pdf_path IS NULL OR pdf_path = '')
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
" 2>&1
