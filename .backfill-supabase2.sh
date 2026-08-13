#!/bin/bash
# Backfill: update pdf_path in DB for invoices whose PDFs were just uploaded to Supabase
cd /opt/ap-invoice/apps/api

DBURL=$(grep DATABASE_URL .env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')
SUPABASE_URL=$(grep SUPABASE_URL .env | head -1 | sed 's/SUPABASE_URL=//' | tr -d '"')
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | head -1 | sed 's/SUPABASE_SERVICE_ROLE_KEY=//' | tr -d '"')
BUCKET=$(grep SUPABASE_STORAGE_BUCKET .env | head -1 | sed 's/SUPABASE_STORAGE_BUCKET=//' | tr -d '"')

# Get all invoices with LOCAL paths where files exist
psql "$DBURL" -t -A -c "
SELECT id || '|' || invoice_number || '|' || pdf_path
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE pdf_path LIKE '/incoming-invoices%'
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
" 2>&1 | while IFS='|' read -r id invnum path; do
  if [ -z "$path" ] || [ -z "$id" ]; then continue; fi
  if [ ! -f "$path" ]; then
    echo "SKIP (file missing): $invnum"
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
    # Update DB — use parameterized query to avoid issues
    RESULT=$(psql "$DBURL" -t -A -c "UPDATE \"AP_Invoice\".\"APInvoice_Invoice\" SET pdf_path = '${STORAGE_PATH}' WHERE id = '${id}' RETURNING invoice_number;" 2>&1)
    if echo "$RESULT" | grep -q "$invnum"; then
      echo "OK: $invnum → ${STORAGE_PATH}"
    else
      echo "DB_UPDATE_FAIL: $invnum — $RESULT"
    fi
  else
    echo "UPLOAD_FAIL ($HTTP_CODE): $invnum"
  fi
done

echo ""
echo "=== Done ==="
