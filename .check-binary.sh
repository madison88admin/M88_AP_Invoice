#!/bin/bash
echo "=== Recent base64 decode logs ==="
journalctl -u ap-invoice-api --since '7 days ago' --no-pager -o cat 2>&1 | grep -i 'base64.*decode\|JVBERi\|base64.*detect' | tail -10

echo ""
echo "=== Check for base64 files in incoming ==="
find /incoming-invoices -maxdepth 1 -name '*.pdf' -exec sh -c '
  HEADER=$(head -c 6 "$1" 2>/dev/null)
  if [ "$HEADER" = "JVBERi" ]; then
    echo "BASE64: $1 ($(stat -c%s "$1") bytes)"
  elif [ "$HEADER" = "%PDF-" ]; then
    echo "BINARY: $1 ($(stat -c%s "$1") bytes)"
  else
    echo "UNKNOWN: $1 (header: $(head -c 6 "$1" | xxd -p 2>/dev/null))"
  fi
' _ {} \; 2>/dev/null | head -20

echo ""
echo "=== Check processing folder ==="
ls -la /incoming-invoices/processing/ 2>/dev/null | head -10

echo ""
echo "=== DB: invoices with no raw_file_url (last 7 days) ==="
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')
psql "$DBURL" -c "
SELECT invoice_number, pdf_path, raw_file_url, source, created_at
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE (raw_file_url IS NULL OR raw_file_url = '')
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 10;
" 2>&1
