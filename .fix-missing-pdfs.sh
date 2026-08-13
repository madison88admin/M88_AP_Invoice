#!/bin/bash
cd /opt/ap-invoice/apps/api

DBURL=$(grep DATABASE_URL .env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')
SUPABASE_URL=$(grep SUPABASE_URL .env | head -1 | sed 's/SUPABASE_URL=//' | tr -d '"')
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | head -1 | sed 's/SUPABASE_SERVICE_ROLE_KEY=//' | tr -d '"')
BUCKET=$(grep SUPABASE_STORAGE_BUCKET .env | head -1 | sed 's/SUPABASE_STORAGE_BUCKET=//' | tr -d '"')

upload_and_update() {
  local id=$1
  local invnum=$2
  local filepath=$3

  if [ ! -f "$filepath" ]; then
    echo "SKIP (file not found): $invnum — $filepath"
    return
  fi

  YEAR=$(date +%Y)
  MONTH=$(date +%m)
  TS=$(date +%s%3N)
  BASENAME=$(basename "$filepath")
  SAFENAME=$(echo "$BASENAME" | sed 's/[^a-zA-Z0-9._-]/_/g')
  STORAGE_PATH="invoices/${YEAR}/${MONTH}/${TS}_${SAFENAME}"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/pdf" \
    -H "x-upsert: true" \
    --data-binary @"$filepath" \
    "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${STORAGE_PATH}" 2>/dev/null)

  if [ "$HTTP_CODE" = "200" ]; then
    RESULT=$(psql "$DBURL" -t -A -c "UPDATE \"AP_Invoice\".\"APInvoice_Invoice\" SET pdf_path = '${STORAGE_PATH}' WHERE id = '${id}' RETURNING invoice_number;" 2>&1)
    if echo "$RESULT" | grep -q "$invnum"; then
      echo "OK: $invnum → ${STORAGE_PATH}"
    else
      echo "DB_FAIL: $invnum — $RESULT"
    fi
  else
    echo "UPLOAD_FAIL ($HTTP_CODE): $invnum"
  fi
}

echo "=== Fixing 7 LOCAL invoices with missing files ==="

# 3 invoices pointing to processing/MADISON 88 LTD_upload.pdf → use processed/ copy
for inv in "100750840|/incoming-invoices/processed/MADISON 88 LTD_upload.pdf" \
           "100749980|/incoming-invoices/processed/MADISON 88 LTD_upload.pdf" \
           "100749789|/incoming-invoices/processed/MADISON 88 LTD_upload.pdf"; do
  invnum=$(echo "$inv" | cut -d'|' -f1)
  filepath=$(echo "$inv" | cut -d'|' -f2)
  id=$(psql "$DBURL" -t -A -c "SELECT id FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='${invnum}' AND pdf_path LIKE '/incoming-invoices%';" 2>&1)
  upload_and_update "$id" "$invnum" "$filepath"
done

# 3 invoices pointing to processing/MADISON 88 LTD.pdf → use processed/ copy
for inv in "HK29765383|/incoming-invoices/processed/MADISON 88 LTD.pdf" \
           "HK29765112|/incoming-invoices/processed/MADISON 88 LTD.pdf" \
           "HK29764832|/incoming-invoices/processed/MADISON 88 LTD.pdf"; do
  invnum=$(echo "$inv" | cut -d'|' -f1)
  filepath=$(echo "$inv" | cut -d'|' -f2)
  id=$(psql "$DBURL" -t -A -c "SELECT id FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='${invnum}' AND pdf_path LIKE '/incoming-invoices%';" 2>&1)
  upload_and_update "$id" "$invnum" "$filepath"
done

# 100746823 → use manual-review/ copy
id=$(psql "$DBURL" -t -A -c "SELECT id FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='100746823' AND pdf_path LIKE '/incoming-invoices%';" 2>&1)
upload_and_update "$id" "100746823" "/incoming-invoices/manual-review/Avery  INV 100746823.pdf"

echo ""
echo "=== Fixing 3 NULL invoices with files in manual-review ==="

id=$(psql "$DBURL" -t -A -c "SELECT id FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='SIN888959' AND (pdf_path IS NULL OR pdf_path='');" 2>&1)
upload_and_update "$id" "SIN888959" "/incoming-invoices/manual-review/BRAND ID-SIN888959.pdf"

id=$(psql "$DBURL" -t -A -c "SELECT id FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='SIN888958' AND (pdf_path IS NULL OR pdf_path='');" 2>&1)
upload_and_update "$id" "SIN888958" "/incoming-invoices/manual-review/BRAND ID_SIN888958.pdf"

id=$(psql "$DBURL" -t -A -c "SELECT id FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='SIN887186' AND (pdf_path IS NULL OR pdf_path='');" 2>&1)
upload_and_update "$id" "SIN887186" "/incoming-invoices/manual-review/BRAND ID_SIN887186.pdf"

echo ""
echo "=== Done ==="
