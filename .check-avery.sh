#!/bin/bash
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

echo "=== Avery Dennison invoices — full details ==="
psql "$DBURL" -c "SELECT id, invoice_number, vendor_name_raw, pdf_path, sharepoint_url, raw_file_url, status, created_at FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE invoice_number IN ('100746823','100749789','100750840') ORDER BY invoice_number;" 2>&1

echo ""
echo "=== Check if pdf_path files exist on disk ==="
for path in "/incoming-invoices/processing/Avery  INV 100746823.pdf"; do
  echo "Checking: $path"
  if [ -f "$path" ]; then echo "  EXISTS on disk"; else echo "  NOT on disk"; fi
done

echo ""
echo "=== Check Supabase storage for Avery files ==="
ls -la /opt/ap-invoice/data/incoming-invoices/ 2>/dev/null | head -20
ls -la /opt/ap-invoice/incoming-invoices/ 2>/dev/null | head -20

echo ""
echo "=== Search filesystem for any Avery PDFs ==="
find /opt/ap-invoice -iname "*Avery*" -type f 2>/dev/null | head -10
find /opt/ap-invoice -iname "*100746*" -type f 2>/dev/null | head -10
find /opt/ap-invoice -iname "*100749*" -type f 2>/dev/null | head -10
find /opt/ap-invoice -iname "*100750*" -type f 2>/dev/null | head -10

echo ""
echo "=== Check Supabase storage buckets ==="
node -e "
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/opt/ap-invoice/apps/api/.env' });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, key);
(async () => {
  try {
    const { data, error } = await supabase.storage.from('invoices').list('2026/08', { limit: 100, search: 'Avery' });
    if (error) { console.log('Error:', error.message); return; }
    console.log('Found', data.length, 'files matching Avery:');
    data.forEach(f => console.log('  ', f.name));
  } catch (e) { console.log('Exception:', e.message); }
})();
" 2>&1
