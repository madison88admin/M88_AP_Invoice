#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== All OCR-detected signatures that are signed (auto-signed from PDF) ==="
psql "$DBURL" -c "SELECT s.signatory_name, s.signatory_role, s.approval_status, s.signed_at, i.invoice_number, i.vendor_name_raw FROM \"AP_Invoice\".\"APInvoice_Signature\" s JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON s.invoice_id = i.id WHERE s.ocr_detected = true AND s.signed_at IS NOT NULL ORDER BY s.signed_at DESC;" 2>&1
