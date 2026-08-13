#!/bin/bash
cd /opt/ap-invoice/apps/api
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const t = jwt.sign(
  { id: 'jc-user-id', email: 'jc@madison88.com', role: 'IT_ADMIN' },
  'madison88-jwt-secret-dev',
  { expiresIn: '2h' }
);
console.log(t);
" 2>/dev/null)

JOB_ID="16f57f3c-e63f-493c-954f-b7dac782861e"
echo "=== Extraction data ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/invoices/upload-jobs/$JOB_ID | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
ext = r.get('extraction', {})
print('Extraction keys:', list(ext.keys())[:30])
print('invoice_number:', ext.get('invoice_number'))
print('vendor_name:', ext.get('vendor_name'))
print('amount:', ext.get('amount'))
print('total_amount:', ext.get('total_amount'))
print('currency:', ext.get('currency'))
print('invoice_date:', ext.get('invoice_date'))
print('due_date:', ext.get('due_date'))
print('po_number:', ext.get('po_number'))
print('mpo_number:', ext.get('mpo_number'))
print('vendor_match:', r.get('vendor_match'))
print('storage_path:', r.get('storage_path'))
print('requires_manual_vendor_assignment:', r.get('requires_manual_vendor_assignment'))
" 2>&1
