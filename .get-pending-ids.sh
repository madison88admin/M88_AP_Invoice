#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== VALIDATION_PENDING + RECEIVED invoice IDs ==="
psql "$DBURL" -t -A -F'|' -c "SELECT id, invoice_number, vendor_name_raw, total_amount FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE status IN ('VALIDATION_PENDING','RECEIVED') ORDER BY created_at DESC;" 2>&1
