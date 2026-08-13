#!/bin/bash
cd /opt/ap-invoice/apps/api

DBURL=$(grep DATABASE_URL .env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')
SUPABASE_URL=$(grep SUPABASE_URL .env | head -1 | sed 's/SUPABASE_URL=//' | tr -d '"')
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | head -1 | sed 's/SUPABASE_SERVICE_ROLE_KEY=//' | tr -d '"')
BUCKET=$(grep SUPABASE_STORAGE_BUCKET .env | head -1 | sed 's/SUPABASE_STORAGE_BUCKET=//' | tr -d '"')

echo "=== Get 3 recent Supabase paths ==="
PATHS=$(psql "$DBURL" -t -A -c "SELECT pdf_path FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE pdf_path LIKE 'invoices/%' ORDER BY created_at DESC LIMIT 3;" 2>&1)

echo "$PATHS"
echo ""

for STORAGE_PATH in $PATHS; do
  echo "--- Downloading: $STORAGE_PATH ---"
  
  # Download from Supabase
  HTTP_CODE=$(curl -s -o /tmp/test_download.pdf -w "%{http_code}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${STORAGE_PATH}" 2>/dev/null)
  
  echo "HTTP status: $HTTP_CODE"
  
  if [ "$HTTP_CODE" = "200" ]; then
    SIZE=$(stat -c%s /tmp/test_download.pdf 2>/dev/null)
    HEADER=$(head -c 5 /tmp/test_download.pdf 2>/dev/null)
    HEX=$(xxd -l 8 /tmp/test_download.pdf 2>/dev/null | head -1)
    
    echo "File size: ${SIZE} bytes"
    echo "Header (first 5 chars): '$HEADER'"
    echo "Hex dump (first 8 bytes): $HEX"
    
    if [ "$HEADER" = "%PDF-" ]; then
      echo "✅ REAL PDF FILE — valid binary PDF content"
    else
      echo "❌ NOT A PDF — content is not a valid PDF"
      echo "First 200 bytes:"
      head -c 200 /tmp/test_download.pdf | xxd | head -5
    fi
  else
    echo "❌ Download failed"
  fi
  echo ""
done

echo "=== Supabase bucket file count ==="
curl -s -H "Authorization: Bearer ${SUPABASE_KEY}" \
  "${SUPABASE_URL}/storage/v1/object/list/${BUCKET}" \
  -d '{"prefix":"invoices/2026/08/","limit":1000,"offset":0}' \
  -H "Content-Type: application/json" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        print(f'Total files in invoices/2026/08/: {len(data)}')
        total_size = sum(f.get('metadata',{}).get('size',0) for f in data)
        print(f'Total size: {total_size / 1024 / 1024:.2f} MB')
        print()
        print('Sample files:')
        for f in data[:5]:
            size = f.get('metadata',{}).get('size',0)
            print(f'  {f.get(\"name\",\"?\")} — {size} bytes')
    else:
        print(f'Response: {str(data)[:300]}')
except Exception as e:
    print(f'Parse error: {e}')
    print(sys.stdin.read()[:300])
" 2>&1
