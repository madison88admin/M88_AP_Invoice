#!/bin/bash
BASE="http://localhost:3001"

# Try demo-login first
echo "=== Testing demo-login ==="
LOGIN_RESP=$(curl -s -X POST "$BASE/api/auth/demo-login" -H 'Content-Type: application/json' -d '{"email":"jc@madison88.com","password":"madison88"}')
echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Token:', d.get('token','NONE')[:30], 'Role:', d.get('user',{}).get('role','?'))" 2>/dev/null

if echo "$LOGIN_RESP" | grep -q "Demo login is disabled"; then
  echo "Demo login disabled, trying regular login with NextGen..."
  LOGIN_RESP=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"joy.yco@madison88.com","password":"madison88"}')
  echo "$LOGIN_RESP" | head -5
fi

TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "FAILED to get auth token"
  echo "Response: $LOGIN_RESP"
  exit 1
fi
echo "Token obtained: ${TOKEN:0:20}..."
echo ""

test_endpoint() {
  local method=$1
  local path=$2
  local data=$3
  local status
  if [ -n "$data" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$data" --max-time 10 2>/dev/null)
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" --max-time 10 2>/dev/null)
  fi
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "OK   $method $path -> $status"
  elif [ "$status" -eq 404 ]; then
    echo "MISS $method $path -> $status (NOT FOUND)"
  elif [ "$status" -eq 500 ]; then
    echo "ERR  $method $path -> $status (SERVER ERROR)"
  else
    echo "WARN $method $path -> $status"
  fi
}

echo "=== INVOICE ENDPOINTS ==="
test_endpoint GET "/api/invoices"
test_endpoint GET "/api/invoices?status=RECEIVED"
test_endpoint GET "/api/invoices?status=EXCEPTION_FLAGGED"
test_endpoint GET "/api/invoices?status=PENDING_COORDINATOR"
test_endpoint GET "/api/invoices?status=PENDING_MANAGER"
test_endpoint GET "/api/invoices?status=PENDING_ACCOUNTING"
test_endpoint GET "/api/invoices?status=POSTED_TO_QB"
test_endpoint GET "/api/invoices?status=PAID"

echo ""
echo "=== APPROVAL ENDPOINTS ==="
test_endpoint GET "/api/approvals/pending"

echo ""
echo "=== EXCEPTION ENDPOINTS ==="
test_endpoint GET "/api/exceptions/pending"

echo ""
echo "=== PAYMENT ENDPOINTS ==="
test_endpoint GET "/api/payments/scheduled"

echo ""
echo "=== PAYMENT BATCH ENDPOINTS ==="
test_endpoint GET "/api/payment-batches"
test_endpoint GET "/api/payment-batches/scheduled-payments"

echo ""
echo "=== DASHBOARD ENDPOINTS ==="
test_endpoint GET "/api/dashboard/role"

echo ""
echo "=== REPORT ENDPOINTS ==="
test_endpoint GET "/api/reports/operational"

echo ""
echo "=== VENDOR ENDPOINTS ==="
test_endpoint GET "/api/vendors"
test_endpoint GET "/api/vendors/suggestions?search=test"

echo ""
echo "=== ANALYTICS ENDPOINTS ==="
test_endpoint GET "/api/analytics/processing-stats"
test_endpoint GET "/api/analytics/vendor-performance"

echo ""
echo "=== SLA ENDPOINTS ==="
test_endpoint GET "/api/sla-analytics/dashboard"

echo ""
echo "=== ON HOLD ENDPOINTS ==="
test_endpoint GET "/api/on-hold-queue"

echo ""
echo "=== AUDIT ENDPOINTS ==="
test_endpoint GET "/api/audit?limit=10"

echo ""
echo "=== NEXTGEN ENDPOINTS ==="
test_endpoint GET "/api/nextgen/entities"

echo ""
echo "=== USER ENDPOINTS ==="
test_endpoint GET "/api/users"

echo ""
echo "=== SYSTEM ENDPOINTS ==="
test_endpoint GET "/api/system/health"
test_endpoint GET "/api/system/ocr-status"

echo ""
echo "=== WORKBENCH ENDPOINTS ==="
test_endpoint GET "/api/workbench"

echo ""
echo "=== BANK MATCHING ENDPOINTS ==="
test_endpoint GET "/api/bank-matching"

echo ""
echo "=== SOA RECONCILIATION ENDPOINTS ==="
test_endpoint GET "/api/soa-reconciliation"

echo ""
echo "=== PI FOLLOW UP ENDPOINTS ==="
test_endpoint GET "/api/pi-follow-up"

echo ""
echo "=== NOTIFICATION ENDPOINTS ==="
test_endpoint GET "/api/notifications"

echo ""
echo "=== EMAIL INTAKE ENDPOINTS ==="
test_endpoint GET "/api/email-intake/accounts"

echo ""
echo "=== API KEYS ENDPOINTS ==="
test_endpoint GET "/api/api-keys"

echo ""
echo "=== REPROCESS ENDPOINTS ==="
test_endpoint GET "/api/reprocess"

echo ""
echo "=== CITIBUSINESS EXPORT ENDPOINTS ==="
test_endpoint GET "/api/citibusiness-export/status"

echo ""
echo "=== PAYMENT CONFIRMATION ENDPOINTS ==="
test_endpoint GET "/api/payment-confirmation"

echo ""
echo "=== EMAIL INVOICE ENDPOINTS ==="
test_endpoint GET "/api/email-invoice"

echo ""
echo "=== SLA REMINDER ENDPOINTS ==="
test_endpoint GET "/api/sla-reminder"
