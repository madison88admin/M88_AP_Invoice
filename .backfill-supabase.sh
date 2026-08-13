#!/bin/bash
# Backfill: upload local PDFs to Supabase and update pdf_path in DB
cd /opt/ap-invoice/apps/api

DBURL=$(grep DATABASE_URL .env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')
SUPABASE_URL=$(grep SUPABASE_URL .env | head -1 | sed 's/SUPABASE_URL=//' | tr -d '"')
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | head -1 | sed 's/SUPABASE_SERVICE_ROLE_KEY=//' | tr -d '"')
BUCKET=$(grep SUPABASE_STORAGE_BUCKET .env | head -1 | sed 's/SUPABASE_STORAGE_BUCKET=//' | tr -d '"')

echo "Supabase URL: $SUPABASE_URL"
echo "Bucket: $BUCKET"
echo ""

# Get all invoices with LOCAL paths
UPLOADED=0
FAILED=0
SKIPPED=0

psql "$DBURL" -t -A -c "
SELECT id || '|' || invoice_number || '|' || pdf_path
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE pdf_path LIKE '/incoming-invoices%'
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
" 2>&1 | while IFS='|' read -r id invnum path; do
  if [ -z "$path" ] || [ -z "$id" ]; then continue; fi
  if [ ! -f "$path" ]; then
    echo "SKIP (file missing): $invnum — $path"
    continue
  fi

  # Build storage path
  YEAR=$(date +%Y)
  MONTH=$(date +%m)
  TS=$(date +%s%3N)
  BASENAME=$(basename "$path")
  SAFENAME=$(echo "$BASENAME" | sed 's/[^a-zA-Z0-9._-]/_/g')
  STORAGE_PATH="invoices/${YEAR}/${MONTH}/${TS}_${SAFENAME}"

  # Upload to Supabase
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/pdf" \
    -H "x-upsert: true" \
    --data-binary @"$path" \
    "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${STORAGE_PATH}" 2>/dev/null)

  if [ "$HTTP_CODE" = "200" ]; then
    # Update DB
    psql "$DBURL" -c "UPDATE \"AP_Invoice\".\"APInvoice_Invoice\" SET pdf_path = '${STORAGE_PATH}' WHERE id = '${id}';" 2>&1 | grep -q '1 row' && \
      echo "OK: $invnum → ${STORAGE_PATH}" || \
      echo "OK (upload) but DB update failed: $invnum"
  else
    echo "FAIL ($HTTP_CODE): $invnum — upload to Supabase failed"
  fi
done

echo ""
echo "=== Done ==="
