#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Avery Dennison invoices — all columns ==="
psql "$DBURL" -c "SELECT invoice_number, pdf_path, raw_file_url, status FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number IN ('100746823','100749789','100750840') ORDER BY invoice_number;" 2>&1

echo ""
echo "=== Check Supabase storage from API dir ==="
cd /opt/ap-invoice/apps/api
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, key);
(async () => {
  // List 2026/08 folder
  const { data, error } = await supabase.storage.from('invoices').list('2026/08', { limit: 200 });
  if (error) { console.log('Error:', error.message); return; }
  const avery = data.filter(f => f.name.toLowerCase().includes('avery') || f.name.includes('100746') || f.name.includes('100749') || f.name.includes('100750'));
  console.log('Total files in 2026/08:', data.length);
  console.log('Avery-related files:', avery.length);
  avery.forEach(f => console.log('  ', f.name, f.metadata?.size || '?', 'bytes'));
  if (avery.length === 0) {
    console.log('');
    console.log('First 10 files in folder:');
    data.slice(0, 10).forEach(f => console.log('  ', f.name));
  }
})();
" 2>&1

echo ""
echo "=== Check processing folder on disk ==="
ls -la /opt/ap-invoice/data/incoming-invoices/processing/ 2>/dev/null | head -20
ls -la /incoming-invoices/processing/ 2>/dev/null | head -20
find / -path "*/incoming-invoices/processing*" -iname "*Avery*" 2>/dev/null | head -5
find / -path "*/incoming-invoices/processing*" -iname "*1007*" 2>/dev/null | head -5
