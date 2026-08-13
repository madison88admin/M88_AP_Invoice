#!/bin/bash
echo "=== Checking VPS file timestamps and sizes ==="
for f in \
  /opt/ap-invoice/apps/api/src/services/paymentBatchService.ts \
  /opt/ap-invoice/apps/api/src/controllers/paymentBatch.ts \
  /opt/ap-invoice/apps/api/src/routes/paymentBatches.ts \
  /opt/ap-invoice/apps/api/src/services/perVendorExportService.ts \
  /opt/ap-invoice/apps/web/src/lib/roleAccess.ts \
  /opt/ap-invoice/apps/web/src/lib/api.ts \
  /opt/ap-invoice/apps/web/src/components/PaymentBatchManager.tsx \
  /opt/ap-invoice/apps/web/dist/index.html
do
  if [ -f "$f" ]; then
    echo "$(stat -c '%Y %s' "$f") $(date -d @$(stat -c '%Y' "$f") '+%H:%M:%S') $(wc -l < "$f") lines  $f"
  else
    echo "MISSING: $f"
  fi
done

echo ""
echo "=== Checking returnInvoicesFromBatch in compiled dist ==="
grep -l "returnInvoicesFromBatch" /opt/ap-invoice/apps/api/dist/services/paymentBatchService.js 2>/dev/null && echo "  -> Found in dist" || echo "  -> NOT in dist!"

echo ""
echo "=== Checking return-invoices route in compiled dist ==="
grep -c "return-invoices" /opt/ap-invoice/apps/api/dist/routes/paymentBatches.js 2>/dev/null && echo "  -> Route in dist" || echo "  -> Route NOT in dist!"

echo ""
echo "=== Checking returnInvoices in web dist ==="
grep -c "returnInvoices" /opt/ap-invoice/apps/web/dist/assets/*.js 2>/dev/null && echo "  -> Found in web dist" || echo "  -> NOT in web dist!"

echo ""
echo "=== API service status ==="
systemctl is-active ap-invoice-api
echo ""
echo "=== Test endpoint responds ==="
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/payment-batches
echo " (expect 401 without auth — means route exists)"
