#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
echo "=== Users with COORDINATOR role ==="
psql "$DBURL" -c "SELECT id, email, name, role, active, created_at FROM \"AP_Invoice\".\"APInvoice_User\" WHERE role::text ILIKE '%COORDINATOR%' ORDER BY name;" 2>&1
echo ""
echo "=== Users named Neneng or similar ==="
psql "$DBURL" -c "SELECT id, email, name, role, active, created_at FROM \"AP_Invoice\".\"APInvoice_User\" WHERE name ILIKE '%neneng%' OR name ILIKE '%nening%' OR email ILIKE '%neneng%';" 2>&1
echo ""
echo "=== All active users ==="
psql "$DBURL" -c "SELECT name, email, role, active FROM \"AP_Invoice\".\"APInvoice_User\" WHERE active = true ORDER BY role, name;" 2>&1
