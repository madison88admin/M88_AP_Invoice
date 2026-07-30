#!/bin/bash
BASE="http://localhost:3001"

TOKEN=$(curl -s -X POST "$BASE/api/auth/demo-login" -H 'Content-Type: application/json' -d '{"email":"jc@madison88.com","password":"madison88"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "FAILED to get auth token"
  exit 1
fi

# Get a real invoice ID
INVOICE_ID=$(curl -s "$BASE/api/invoices?limit=1" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else d.get('data',[{}])[0].get('id',''))" 2>/dev/null)
echo "Using invoice ID: $INVOICE_ID"
echo ""

test_endpoint() {
  local method=$1
  local path=$2
  local data=$3
  local status
  local body
  if [ -n "$data" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$data" --max-time 10 2>/dev/null)
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" --max-time 10 2>/dev/null)
  fi
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "OK   $method $path -> $status"
  elif [ "$status" -eq 404 ]; then
    echo "MISS $method $path -> $status"
  elif [ "$status" -eq 500 ]; then
    body=$(curl -s -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$data" --max-time 10 2>/dev/null | head -c 200)
    echo "ERR  $method $path -> $status : $body"
  else
    echo "WARN $method $path -> $status"
  fi
}

echo "=== INVOICE ACTION ENDPOINTS (with real ID) ==="
test_endpoint GET "/api/invoices/$INVOICE_ID"
test_endpoint GET "/api/invoices/$INVOICE_ID/timeline"
test_endpoint GET "/api/exceptions/invoice/$INVOICE_ID"

echo ""
echo "=== BANK MATCHING (with data) ==="
test_endpoint POST "/api/bank-matching/compare" "{\"invoiceId\":\"$INVOICE_ID\",\"bankDetails\":{\"bank_name\":\"Test\",\"swift_code\":\"TEST\",\"account_number\":\"123\"}}"

echo ""
echo "=== REPROCESS (with real ID) ==="
test_endpoint POST "/api/reprocess/$INVOICE_ID/reprocess"

echo ""
echo "=== DASHBOARD ROLE ==="
DASH=$(curl -s "$BASE/api/dashboard/role" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2)[:500])" 2>/dev/null)
echo "$DASH"

echo ""
echo "=== CHECK RECENT SERVER ERRORS ==="
journalctl -u ap-invoice-api --no-pager --since '5 min ago' 2>/dev/null | grep -iE 'error|500|ERR' | grep -v 'prisma:' | tail -10
