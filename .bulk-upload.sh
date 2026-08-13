#!/bin/bash
# Generate JWT for jc@madison88.com (SUPERADMIN role)
cd /opt/ap-invoice/apps/api
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const t = jwt.sign(
  { id: 'jc-user-id', email: 'jc@madison88.com', role: 'IT_ADMIN' },
  'madison88-jwt-secret-dev',
  { expiresIn: '2h' }
);
console.log(t);
" 2>/dev/null)

echo "Token length: ${#TOKEN}"

UPLOAD_DIR="/tmp/bulk-upload"
rm -f /tmp/uploaded-invoices.txt

echo ""
echo "=== Step 1: Upload PDFs via /api/invoices/upload-madison-async ==="
find "$UPLOAD_DIR" -name "*.pdf" -type f | sort | while read -r pdf; do
  filename=$(basename "$pdf")
  echo "Uploading: $filename"
  
  response=$(curl -s -w "\nHTTP:%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$pdf" \
    http://localhost:3001/api/invoices/upload-madison-async)
  
  http_code=$(echo "$response" | grep HTTP: | cut -d: -f2)
  body=$(echo "$response" | grep -v HTTP:)
  echo "  Status: $http_code"
  
  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ] || [ "$http_code" = "202" ]; then
    invoice_id=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('invoice_id','') or d.get('invoice',{}).get('id','') or d.get('id','') or d.get('jobId',''))" 2>/dev/null)
    echo "  ID: $invoice_id"
    echo "$invoice_id|$filename" >> /tmp/uploaded-invoices.txt
  else
    echo "  Response: $(echo $body | head -c 200)"
    echo ""
  fi
  sleep 1
done

echo ""
echo "=== Uploaded files ==="
cat /tmp/uploaded-invoices.txt 2>/dev/null
echo ""
echo "Total: $(wc -l < /tmp/uploaded-invoices.txt 2>/dev/null || echo 0) files"
