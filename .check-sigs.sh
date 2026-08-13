#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
echo "=== Signatures for SI26072055 ==="
psql "$DBURL" -c "SELECT s.signatory_name, s.signatory_role, s.signature_type, s.signed_date FROM \"AP_Invoice\".\"APInvoice_Signature\" s JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON s.invoice_id = i.id WHERE i.invoice_number = 'SI26072055';" 2>&1
echo ""
echo "=== All signatures with Neneng ==="
psql "$DBURL" -c "SELECT s.signatory_name, s.signatory_role, s.signature_type, i.invoice_number, i.vendor_name_raw FROM \"AP_Invoice\".\"APInvoice_Signature\" s JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON s.invoice_id = i.id WHERE s.signatory_name ILIKE '%neneng%';" 2>&1
