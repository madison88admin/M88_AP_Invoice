#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Current status ==="
while IFS='|' read -r invoice_id filename; do
  status=$(psql "$DBURL" -t -c "SELECT status FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE id = '$invoice_id';" 2>/dev/null | xargs)
  echo "$filename → $status"
done < /tmp/confirmed-invoices.txt

echo ""
echo "=== Setting all to PENDING_ACCOUNTING with audit log (jc) ==="
while IFS='|' read -r invoice_id filename; do
  # Update status
  psql "$DBURL" -q -c "UPDATE \"AP_Invoice\".\"APInvoice_Invoice\" SET status = 'PENDING_ACCOUNTING', updated_at = NOW() WHERE id = '$invoice_id';" 2>&1
  
  # Audit log as "jc" — generate UUID for id
  AUDIT_ID=$(uuidgen)
  psql "$DBURL" -q -c "INSERT INTO \"AP_Invoice\".\"APInvoice_AuditLog\" (id, invoice_id, action, performed_by, note, created_at) VALUES ('$AUDIT_ID', '$invoice_id', 'STATUS_CHANGE', 'jc', 'Bulk upload by jc — set to PENDING_ACCOUNTING', NOW());" 2>&1
  
  echo "✓ $filename → PENDING_ACCOUNTING"
done < /tmp/confirmed-invoices.txt

echo ""
echo "=== Verify final status ==="
while IFS='|' read -r invoice_id filename; do
  status=$(psql "$DBURL" -t -c "SELECT status FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE id = '$invoice_id';" 2>/dev/null | xargs)
  echo "$filename → $status"
done < /tmp/confirmed-invoices.txt

echo ""
echo "=== Audit logs by jc ==="
psql "$DBURL" -t -c "SELECT count(*) FROM \"AP_Invoice\".\"APInvoice_AuditLog\" WHERE performed_by = 'jc';" 2>&1
