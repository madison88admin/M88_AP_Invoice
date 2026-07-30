#!/bin/bash
BASE="http://localhost:3001"

TOKEN=$(curl -s -X POST "$BASE/api/auth/demo-login" -H 'Content-Type: application/json' -d '{"email":"jc@madison88.com","password":"madison88"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "FAILED to get auth token"
  exit 1
fi

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
    echo "MISS $method $path -> $status"
  elif [ "$status" -eq 500 ]; then
    echo "ERR  $method $path -> $status (SERVER ERROR)"
  else
    echo "WARN $method $path -> $status"
  fi
}

echo "=== CORRECTED ENDPOINT TESTS ==="
test_endpoint GET "/api/audit-logs?limit=10"
test_endpoint GET "/api/analytics/dashboard"
test_endpoint GET "/api/analytics/confidence"
test_endpoint GET "/api/analytics/vendors"
test_endpoint GET "/api/analytics/errors"
test_endpoint GET "/api/analytics/timeline"
test_endpoint GET "/api/analytics/performance"
test_endpoint GET "/api/analytics/extraction-policies"
test_endpoint GET "/api/sla-analytics/summary"
test_endpoint GET "/api/sla-analytics/cycle-times"
test_endpoint GET "/api/sla-analytics/breaches"
test_endpoint GET "/api/sla-analytics/bottlenecks"
test_endpoint GET "/api/system/status"
test_endpoint GET "/api/workbench/queue"
test_endpoint GET "/api/workbench/duplicates"
test_endpoint GET "/api/soa-reconciliation/queue"
test_endpoint GET "/api/soa-reconciliation/statistics"
test_endpoint GET "/api/pi-follow-up/paid-missing-ci"
test_endpoint GET "/api/notifications/unread-count"
test_endpoint GET "/api/on-hold-queue/stats"
test_endpoint GET "/api/nextgen/status"
test_endpoint GET "/api/nextgen/pos"
test_endpoint GET "/api/notifications?limit=10"
test_endpoint GET "/api/users/roles/list"
test_endpoint GET "/health"
test_endpoint GET "/api/health"
test_endpoint GET "/health/engines"

echo ""
echo "=== POST-ONLY ENDPOINTS (expect 400/500 for missing data, not 404) ==="
test_endpoint POST "/api/bank-matching/compare"
test_endpoint POST "/api/bank-matching/auto-check"
test_endpoint POST "/api/sla-reminder/check"
test_endpoint POST "/api/reprocess/test-id/re-extract"
