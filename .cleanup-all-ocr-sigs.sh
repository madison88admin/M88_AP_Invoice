#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Resetting ALL OCR-detected auto-signed signatures to PENDING ==="
psql "$DBURL" -c "UPDATE \"AP_Invoice\".\"APInvoice_Signature\" SET signatory_name = '', signed_at = NULL, approval_status = 'PENDING' WHERE ocr_detected = true AND signed_at IS NOT NULL;" 2>&1

echo ""
echo "=== Verify: any remaining OCR-detected signed signatures? ==="
psql "$DBURL" -c "SELECT COUNT(*) as remaining FROM \"AP_Invoice\".\"APInvoice_Signature\" WHERE ocr_detected = true AND signed_at IS NOT NULL;" 2>&1

echo ""
echo "=== SI26072055 signatures after cleanup ==="
psql "$DBURL" -c "SELECT signatory_name, signatory_role, approval_status, signed_at FROM \"AP_Invoice\".\"APInvoice_Signature\" s JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON s.invoice_id = i.id WHERE i.invoice_number = 'SI26072055' ORDER BY s.signatory_role;" 2>&1
