#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Re-extracted invoices — BEFORE vs AFTER comparison ==="
psql "$DBURL" -c "SELECT invoice_number, vendor_name_raw, total_amount, currency, mpo_number, customer_po_number, ocr_confidence_score, status FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number IN ('SI26072050','SI26072048','SI26072047','8266895405','SO20261266','SIN887186','100750840','100749789','100746823') ORDER BY invoice_number;" 2>&1
