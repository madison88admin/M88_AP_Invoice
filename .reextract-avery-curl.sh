#!/bin/bash
# Generate JWT token
TOKEN=$(node -e "const jwt = require('jsonwebtoken'); console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))" --cwd /opt/ap-invoice/apps/api 2>/dev/null || node -e "const jwt = require('/opt/ap-invoice/apps/api/node_modules/jsonwebtoken'); console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))")

echo "Token: ${TOKEN:0:30}..."

# Re-extract 100746823
echo "Sending re-extract request for 100746823..."
curl -s -X POST "http://localhost:3001/api/reprocess/bulk-re-extract" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"invoiceIds":["637253ea-faec-435e-9345-b05773360c79"],"reason":"Re-extract via raw_file_url"}' \
  --max-time 300 2>&1 | head -c 1000

echo ""
echo "=== Recent logs ==="
journalctl -u ap-invoice-api --since '2 min ago' --no-pager -o cat 2>&1 | grep -iE 'ReExtract|raw_file|Supabase|Ollama|error|100746' | grep -v 'stack\|node_modules\|at async\|rawLine' | tail -15
