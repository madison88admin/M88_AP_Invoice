#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Before cleanup ==="
psql "$DBURL" -c "SELECT s.signatory_name, s.signatory_role, s.approval_status, s.signed_at, i.invoice_number, i.status FROM \"AP_Invoice\".\"APInvoice_Signature\" s JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON s.invoice_id = i.id WHERE s.signatory_name ILIKE '%neneng%';" 2>&1

echo ""
echo "=== Resetting Neneng signatures to PENDING ==="
psql "$DBURL" -c "UPDATE \"AP_Invoice\".\"APInvoice_Signature\" SET signatory_name = '', signed_at = NULL, approval_status = 'PENDING' WHERE signatory_name ILIKE '%neneng%' AND ocr_detected = true;" 2>&1

echo ""
echo "=== After cleanup ==="
psql "$DBURL" -c "SELECT s.signatory_name, s.signatory_role, s.approval_status, s.signed_at, i.invoice_number FROM \"AP_Invoice\".\"APInvoice_Signature\" s JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON s.invoice_id = i.id WHERE i.invoice_number IN ('SI26072055','SI26072266','SI26072267','SI26072049','SI26072051') ORDER BY i.invoice_number, s.signatory_role;" 2>&1
