#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Incoming folder (new PDFs waiting) ==="
ls -la /opt/ap-invoice/data/incoming-invoices/ 2>/dev/null | head -10
echo ""
ls -la /opt/ap-invoice/data/incoming-invoices/incoming/ 2>/dev/null | head -10
echo ""
ls -la /opt/ap-invoice/data/incoming-invoices/processing/ 2>/dev/null | head -10

echo ""
echo "=== Last 10 invoices in DB ==="
psql "$DBURL" -c "SELECT invoice_number, vendor_name_raw, status, created_at FROM \"AP_Invoice\".\"APInvoice_Invoice\" ORDER BY created_at DESC LIMIT 10;" 2>&1

echo ""
echo "=== Invoices in OCR_PROCESSING status ==="
psql "$DBURL" -c "SELECT invoice_number, status, created_at FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE status = 'OCR_PROCESSING' OR status = 'RECEIVED' ORDER BY created_at DESC;" 2>&1

echo ""
echo "=== API uptime ==="
systemctl show ap-invoice-api --property=ActiveEnterTimestamp 2>&1
