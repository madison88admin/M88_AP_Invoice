#!/bin/bash
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

# Get all invoice IDs
INVOICE_IDS=$(while IFS='|' read -r invoice_id filename; do
  echo -n "\"$invoice_id\","
done < /tmp/confirmed-invoices.txt | sed 's/,$//')

echo "=== Bulk re-extracting 20 invoices ==="
HTTP_CODE=$(curl -s -o /tmp/reextract-response.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"invoiceIds\":[$INVOICE_IDS]}" \
  http://localhost:3001/api/reprocess/bulk-re-extract)

echo "HTTP Status: $HTTP_CODE"
echo "Response:"
cat /tmp/reextract-response.json | python3 -m json.tool 2>/dev/null || cat /tmp/reextract-response.json
