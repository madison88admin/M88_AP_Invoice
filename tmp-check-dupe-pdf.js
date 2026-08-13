
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Check for duplicate pdf_path (multiple invoices sharing same PDF)
  const dupes = await p.$queryRaw`
    SELECT pdf_path, COUNT(*) as cnt, 
           array_agg(invoice_number) as invoice_numbers,
           array_agg(id) as invoice_ids
    FROM "APInvoice_Invoice" 
    WHERE pdf_path IS NOT NULL 
    GROUP BY pdf_path 
    HAVING COUNT(*) > 1 
    ORDER BY cnt DESC 
    LIMIT 20
  `;
  
  console.log('=== Invoices sharing same PDF ===');
  console.log('Total shared PDFs: ' + dupes.length);
  dupes.forEach(d => {
    console.log('\nPDF: ' + d.pdf_path);
    console.log('  Count: ' + d.cnt);
    console.log('  Invoices: ' + d.invoice_numbers.join(', '));
  });

  // Check invoices with NULL pdf_path
  const nullPdf = await p.invoice.count({ where: { pdf_path: null } });
  console.log('\n=== Invoices with NULL pdf_path: ' + nullPdf + ' ===');

  // Check invoices with NULL raw_file_url
  const nullRaw = await p.invoice.count({ where: { raw_file_url: null } });
  console.log('Invoices with NULL raw_file_url: ' + nullRaw);

  // Check invoices with both NULL
  const bothNull = await p.invoice.count({ where: { pdf_path: null, raw_file_url: null, sharepoint_folder_url: null } });
  console.log('Invoices with ALL NULL (no file reference): ' + bothNull);
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
