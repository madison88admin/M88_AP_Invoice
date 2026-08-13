#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Invoice T-26909533 status ==="
psql "$DBURL" -c "SELECT invoice_number, status FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number='T-26909533';" 2>&1

echo "=== Batch PB202608069840 status ==="
psql "$DBURL" -c "SELECT batch_number, status, payment_count, total_amount FROM \"AP_Invoice\".\"APInvoice_PaymentBatch\" WHERE batch_number='PB202608069840';" 2>&1

echo "=== Payment status ==="
psql "$DBURL" -c "SELECT p.status, p.batch_id, i.invoice_number FROM \"AP_Invoice\".\"APInvoice_Payment\" p JOIN \"AP_Invoice\".\"APInvoice_Invoice\" i ON p.invoice_id=i.id WHERE i.invoice_number='T-26909533';" 2>&1
