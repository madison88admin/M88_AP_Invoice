#!/bin/bash
SUPABASE_URL=$(grep SUPABASE_URL /opt/ap-invoice/apps/api/.env | cut -d= -f2)
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /opt/ap-invoice/apps/api/.env | cut -d= -f2)
BUCKET=$(grep SUPABASE_STORAGE_BUCKET /opt/ap-invoice/apps/api/.env | cut -d= -f2)

echo "=== Supabase Storage Files ==="
curl -s "${SUPABASE_URL}/storage/v1/object/list/${BUCKET}" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"invoices/2026/08/","limit":20,"offset":0}' 2>&1 | python3 -m json.tool 2>/dev/null

echo ""
echo "=== Hetzner S3 Files ==="
AWS_ACCESS_KEY_ID=$(grep HETZNER_S3_ACCESS_KEY /opt/ap-invoice/apps/api/.env | cut -d= -f2) \
AWS_SECRET_ACCESS_KEY=$(grep HETZNER_S3_SECRET_KEY /opt/ap-invoice/apps/api/.env | cut -d= -f2) \
AWS_DEFAULT_REGION=$(grep HETZNER_S3_REGION /opt/ap-invoice/apps/api/.env | cut -d= -f2) \
aws s3 ls "s3://$(grep HETZNER_S3_BUCKET /opt/ap-invoice/apps/api/.env | cut -d= -f2)/$(grep HETZNER_S3_PREFIX /opt/ap-invoice/apps/api/.env | cut -d= -f2)/" \
  --endpoint-url $(grep HETZNER_S3_ENDPOINT /opt/ap-invoice/apps/api/.env | cut -d= -f2) 2>&1 | head -15
