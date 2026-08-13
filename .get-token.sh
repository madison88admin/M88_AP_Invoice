#!/bin/bash
echo "=== IT Admin users ==="
PGPASSWORD='Madison_88_admin**' psql -h localhost -U 'supabase_admin.m88' -d postgres -t -A -F'|' << 'SQL'
SELECT email, name, role::text FROM "AP_Invoice"."APInvoice_User" 
WHERE role::text ILIKE '%IT%' OR role::text ILIKE '%ADMIN%' LIMIT 5;
SQL

echo ""
echo "=== Try login with test user ==="
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test.purchasing@madison88.com","password":"Test1234!"}' | head -c 200
echo ""
