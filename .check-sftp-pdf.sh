#!/bin/bash
echo "=== SFTP FILE WATCHER PDF STORAGE CHECK ==="
echo ""

echo "--- 1. SFTP-sourced invoices with Supabase path ---"
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
SELECT invoice_number, vendor_name_raw, pdf_path, 
       length(pdf_path) as path_len,
       ocr_confidence_score
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE pdf_path LIKE 'invoices/%'
ORDER BY created_at DESC LIMIT 10;
SQL

echo ""
echo "--- 2. SFTP-sourced invoices with local path ---"
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres << 'SQL'
SELECT invoice_number, vendor_name_raw, pdf_path, source::text
FROM "AP_Invoice"."APInvoice_Invoice"
WHERE pdf_path LIKE '/incoming-invoices/%'
ORDER BY created_at DESC LIMIT 10;
SQL

echo ""
echo "--- 3. Download a Supabase PDF and verify it's valid binary ---"
SUPABASE_URL=$(grep SUPABASE_URL /opt/ap-invoice/apps/api/.env | cut -d= -f2)
SUPABASE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /opt/ap-invoice/apps/api/.env | cut -d= -f2)
BUCKET=$(grep SUPABASE_STORAGE_BUCKET /opt/ap-invoice/apps/api/.env | cut -d= -f2)

# Get the most recent SFTP invoice with Supabase path
PDF_PATH=$(PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -c "
SELECT pdf_path FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE pdf_path LIKE 'invoices/%'
ORDER BY created_at DESC LIMIT 1
")

echo "Downloading: $PDF_PATH"
echo ""

# Download the PDF
HTTP_CODE=$(curl -s -o /tmp/test-download.pdf -w "%{http_code}" \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PDF_PATH}" \
  -H "Authorization: Bearer $SUPABASE_KEY")

echo "HTTP Status: $HTTP_CODE"
echo "File size: $(wc -c < /tmp/test-download.pdf) bytes"
echo "File type: $(file /tmp/test-download.pdf)"

# Check PDF magic bytes (should start with %PDF)
MAGIC=$(xxd -l 5 /tmp/test-download.pdf 2>/dev/null | head -1)
echo "Magic bytes: $MAGIC"

# Check if it's a valid PDF
if head -c 4 /tmp/test-download.pdf | grep -q '%PDF'; then
  echo "✅ Valid PDF binary — file starts with %PDF"
else
  echo "❌ NOT a valid PDF — file does not start with %PDF"
  echo "First 100 bytes:"
  head -c 100 /tmp/test-download.pdf
fi

echo ""
echo "--- 4. Verify PDF can be parsed ---"
if command -v pdfinfo &>/dev/null; then
  pdfinfo /tmp/test-download.pdf 2>&1
else
  echo "pdfinfo not installed, trying python..."
  python3 -c "
import subprocess
result = subprocess.run(['python3', '-c', '''
with open('/tmp/test-download.pdf', 'rb') as f:
    data = f.read(10)
    print(f'First 10 bytes: {data}')
    print(f'Is PDF: {data[:4] == b\"%PDF\"}')
'''], capture_output=True, text=True)
print(result.stdout)
print(result.stderr)
" 2>&1
fi
