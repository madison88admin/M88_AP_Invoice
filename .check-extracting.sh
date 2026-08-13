#!/bin/bash
echo "=== Incoming PDFs ==="
ls -la /incoming-invoices/ 2>&1 | tail -10
echo ""
echo "=== VALIDATION_PENDING invoices ==="
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
psql "$DBURL" -c "SELECT invoice_number, vendor_name_raw, total_amount, status, created_at FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE status IN ('VALIDATION_PENDING','RECEIVED') ORDER BY created_at DESC;" 2>&1
echo ""
echo "=== Recent processing logs (last 5 min) ==="
journalctl -u ap-invoice-api --since '5 min ago' --no-pager -o cat 2>&1 | grep -iE 'File Watcher|Processing|extraction|Ollama|OpenDataLoader|invoice.*created|completed' | grep -v 'stack\|node_modules\|at async\|rawLine' | tail -15
