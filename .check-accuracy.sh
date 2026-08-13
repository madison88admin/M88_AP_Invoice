#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Recent invoices (last 20) — extraction accuracy ==="
psql "$DBURL" -c "SELECT invoice_number, vendor_name_raw, total_amount, currency, mpo_number, customer_po_number, ocr_confidence_score, status, created_at FROM \"AP_Invoice\".\"APInvoice_Invoice\" ORDER BY created_at DESC LIMIT 20;" 2>&1

echo ""
echo "=== Confidence comparison: Before vs After Ollama change ==="
echo "--- Old extractions (before 07:00 UTC today) ---"
psql "$DBURL" -t -c "SELECT COUNT(*), AVG(ocr_confidence_score), MIN(ocr_confidence_score), MAX(ocr_confidence_score) FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE created_at < '2026-08-06T07:00:00Z' AND ocr_confidence_score IS NOT NULL;" 2>&1

echo "--- New extractions (after 07:00 UTC today) ---"
psql "$DBURL" -t -c "SELECT COUNT(*), AVG(ocr_confidence_score), MIN(ocr_confidence_score), MAX(ocr_confidence_score) FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE created_at >= '2026-08-06T07:00:00Z' AND ocr_confidence_score IS NOT NULL;" 2>&1

echo ""
echo "=== PO/MPO fill rate ==="
echo "--- Old (before 07:00) ---"
psql "$DBURL" -t -c "SELECT COUNT(*) as total, COUNT(mpo_number) as has_mpo, COUNT(customer_po_number) as has_po, COUNT(NULLIF(customer_po_number,'')) as has_po_value FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE created_at < '2026-08-06T07:00:00Z';" 2>&1

echo "--- New (after 07:00) ---"
psql "$DBURL" -t -c "SELECT COUNT(*) as total, COUNT(mpo_number) as has_mpo, COUNT(customer_po_number) as has_po, COUNT(NULLIF(customer_po_number,'')) as has_po_value FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE created_at >= '2026-08-06T07:00:00Z';" 2>&1
