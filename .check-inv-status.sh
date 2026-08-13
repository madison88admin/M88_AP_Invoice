#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
echo "=== Invoice Status Summary ==="
psql "$DBURL" -t -c "SELECT status, COUNT(*) FROM \"AP_Invoice\".\"APInvoice_Invoice\" GROUP BY status ORDER BY status;"
echo ""
echo "=== Recent Invoices (last 10) ==="
psql "$DBURL" -c "SELECT invoice_number, vendor_name_raw, total_amount, currency, status, mpo_number, customer_po_number, ocr_confidence_score, created_at FROM \"AP_Invoice\".\"APInvoice_Invoice\" ORDER BY created_at DESC LIMIT 10;" 2>&1
