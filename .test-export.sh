#!/bin/bash
# Generate JWT
cd /opt/ap-invoice/apps/api
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const t = jwt.sign(
  { id: 'test-user-id', email: 'jc@madison88.com', role: 'ACCOUNTING_SUPERVISOR' },
  'madison88-jwt-secret-dev',
  { expiresIn: '1h' }
);
console.log(t);
" 2>/dev/null)

BATCH_ID="19e23186-bc68-4719-82b1-bbb91f3394b1"

# Download the Excel
curl -s -o /tmp/test-export.xlsx \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/payment-batches/$BATCH_ID/export-per-vendor

# Parse the xlsx using node + xlsx
node -e "
const XLSX = require('xlsx');
const fs = require('fs');
const buf = fs.readFileSync('/tmp/test-export.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });

console.log('=== Sheet Names ===');
console.log(wb.SheetNames);

console.log('');
console.log('=== Payments Sheet ===');
const ws = wb.Sheets['Payments'];
const data = XLSX.utils.sheet_to_json(ws);
data.forEach((row, i) => {
  console.log(JSON.stringify(row));
});

console.log('');
console.log('=== Summary Sheet ===');
const summary = wb.Sheets['Summary'];
const summaryData = XLSX.utils.sheet_to_json(summary, { header: 1 });
summaryData.forEach(row => {
  if (row.length > 0) console.log(row.join(' | '));
});
" 2>&1
