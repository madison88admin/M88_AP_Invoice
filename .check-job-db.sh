#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
psql "$DBURL" -t -c "SELECT status, result::text FROM \"AP_Invoice\".\"APInvoice_UploadJob\" WHERE id = '4707ba58-23f1-4ca1-b2e4-be96c24421d5';" 2>&1 | head -5
