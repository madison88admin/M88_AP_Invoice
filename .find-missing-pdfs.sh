#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | tr -d '"' | sed 's/?schema=.*//')

echo "=== Search for missing PDFs ==="
for invnum in 100750840 100749980 100749789 HK29765383 HK29765112 HK29764832 100746823; do
  echo "--- $invnum ---"
  # Search in all incoming-invoices subfolders
  find /incoming-invoices -name "*${invnum}*" -o -name "*MADISON 88 LTD*" 2>/dev/null | head -5
  # Also search by the original filename
done

echo ""
echo "=== Check if these are multi-invoice PDFs (split from a single upload) ==="
psql "$DBURL" -c "
SELECT invoice_number, pdf_path, ocr_raw_data->'raw_data'->>'ocr_engine' as engine, created_at
FROM \"AP_Invoice\".\"APInvoice_Invoice\"
WHERE pdf_path LIKE '/incoming-invoices/processing/MADISON 88 LTD%'
ORDER BY created_at DESC;
" 2>&1

echo ""
echo "=== NULL path invoices — check if files exist in manual-review ==="
for invnum in SIN888959 SIN888958 SIN887186 PI169580BillToMadison88 INV-PKL-202603; do
  echo "--- $invnum ---"
  find /incoming-invoices -name "*${invnum}*" 2>/dev/null | head -3
done

echo ""
echo "=== Check if NULL invoices are from multi-invoice splits ==="
psql "$DBURL" -c "
SELECT i.invoice_number, i.status, i.created_at,
       COUNT(il.id) as line_items
FROM \"AP_Invoice\".\"APInvoice_Invoice\" i
LEFT JOIN \"AP_Invoice\".\"APInvoice_InvoiceLine\" il ON il.invoice_id = i.id
WHERE i.pdf_path IS NULL OR i.pdf_path = ''
GROUP BY i.id, i.invoice_number, i.status, i.created_at
ORDER BY i.created_at DESC;
" 2>&1
