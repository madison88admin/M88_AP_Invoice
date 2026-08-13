#!/bin/bash
echo "=== PDF STORAGE CHECK ==="
echo ""

echo "--- 1. Recent invoices with pdf_path ---"
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
SELECT invoice_number, vendor_name_raw, pdf_path, created_at::date
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE pdf_path IS NOT NULL AND pdf_path != ''
ORDER BY created_at DESC LIMIT 10;
SQL

echo ""
echo "--- 2. Invoices with Supabase storage path ---"
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
SELECT count(*) AS supabase_count
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE pdf_path LIKE 'invoices/%';
SQL

echo ""
echo "--- 3. Invoices with local path only ---"
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
SELECT count(*) AS local_count
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE pdf_path LIKE '/%';
SQL

echo ""
echo "--- 4. Invoices without pdf_path ---"
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
SELECT count(*) AS no_pdf
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE pdf_path IS NULL OR pdf_path = '';
SQL

echo ""
echo "--- 5. Test Supabase storage API ---"
SUPABASE_URL=$(grep SUPABASE_URL /opt/ap-invoice/apps/api/.env | cut -d= -f2)
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /opt/ap-invoice/apps/api/.env | cut -d= -f2)
BUCKET=$(grep SUPABASE_STORAGE_BUCKET /opt/ap-invoice/apps/api/.env | cut -d= -f2)

echo "Supabase URL: $SUPABASE_URL"
echo "Bucket: $BUCKET"
echo ""

# List objects in the bucket
echo "Listing files in Supabase bucket..."
curl -s "${SUPABASE_URL}/storage/v1/object/list/${BUCKET}" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"invoices/","limit":10,"offset":0}' 2>&1 | python3 -m json.tool 2>/dev/null | head -40

echo ""
echo "--- 6. Check Hetzner S3 ---"
source /opt/ap-invoice/apps/api/.env 2>/dev/null
if command -v aws &>/dev/null; then
  echo "Listing Hetzner S3 bucket..."
  AWS_ACCESS_KEY_ID=$HETZNER_S3_ACCESS_KEY \
  AWS_SECRET_ACCESS_KEY=$HETZNER_S3_SECRET_KEY \
  AWS_DEFAULT_REGION=$HETZNER_S3_REGION \
  aws s3 ls "s3://${HETZNER_S3_BUCKET}/${HETZNER_S3_PREFIX}/" --endpoint-url $HETZNER_S3_ENDPOINT 2>&1 | head -10
else
  echo "aws CLI not installed, checking with curl..."
  # Just check if we can reach Hetzner
  curl -s -o /dev/null -w "Hetzner endpoint status: %{http_code}\n" $HETZNER_S3_ENDPOINT 2>&1
fi
