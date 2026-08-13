#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')
psql "$DBURL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname='AP_Invoice' AND tablename LIKE '%Job%';" 2>&1
echo "---"
psql "$DBURL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname='AP_Invoice' AND tablename LIKE '%Upload%';" 2>&1
