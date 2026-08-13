#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
echo "=== API Keys in DB ==="
psql "$DBURL" -t -c "SELECT id, name, key_prefix, key_hash FROM \"AP_Invoice\".\"APInvoice_ApiKey\" WHERE revoked_at IS NULL LIMIT 5;" 2>&1
