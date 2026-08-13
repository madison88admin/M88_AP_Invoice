#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
echo "=== DB URL ==="
echo "$DBURL"
echo ""
echo "=== DB: Recent invoices ==="
psql "$DBURL" -t -c "SELECT invoice_number, status, created_at FROM AP_Invoice.invoices ORDER BY created_at DESC LIMIT 10;" 2>&1
echo ""
echo "=== DB: Invoices in processing stages ==="
psql "$DBURL" -t -c "SELECT invoice_number, status, total_amount, created_at FROM AP_Invoice.invoices WHERE status IN ('RECEIVED','OCR_PROCESSING','VALIDATION_PENDING','PENDING_COORDINATOR','PENDING_MANAGER','PENDING_ACCOUNTING','PENDING_MLO_ACCOUNT_HOLDER','PENDING_MLO_PLANNING_MANAGER','PENDING_SR_MANAGER','PENDING_POLLY','APPROVED','ON_HOLD','EXCEPTION_FLAGGED') ORDER BY created_at DESC LIMIT 15;" 2>&1
echo ""
echo "=== DB: Status counts ==="
psql "$DBURL" -t -c "SELECT status, count(*) FROM AP_Invoice.invoices GROUP BY status ORDER BY count DESC;" 2>&1
