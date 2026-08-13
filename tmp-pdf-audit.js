
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Find invoices where pdf_path filename doesn't contain the invoice_number
  const invoices = await p.invoice.findMany({
    where: { pdf_path: { not: null } },
    select: { id: true, invoice_number: true, pdf_path: true, raw_file_url: true, status: true, vendor_name_raw: true },
    take: 50,
    orderBy: { created_at: 'desc' }
  });

  console.log('=== Invoices where PDF filename does NOT contain invoice_number ===');
  let mismatchCount = 0;
  for (const inv of invoices) {
    const filename = inv.pdf_path.split('/').pop() || '';
    const invNumLower = inv.invoice_number.toLowerCase();
    const fileLower = filename.toLowerCase();
    if (!fileLower.includes(invNumLower) && !invNumLower.includes(fileLower.replace(/\d+_/, '').replace(/\.pdf$/, ''))) {
      console.log('MISMATCH: ' + inv.invoice_number + ' -> ' + inv.pdf_path);
      mismatchCount++;
    }
  }
  console.log('Total mismatches: ' + mismatchCount + ' / ' + invoices.length);

  // Find invoices sharing same pdf_path
  const sharing = {};
  for (const inv of invoices) {
    if (!sharing[inv.pdf_path]) sharing[inv.pdf_path] = [];
    sharing[inv.pdf_path].push(inv.invoice_number);
  }
  const shared = Object.entries(sharing).filter(([_, nums]) => nums.length > 1);
  console.log('\n=== Invoices sharing same PDF file ===');
  console.log('Shared PDFs: ' + shared.length);
  shared.forEach(([pdf, nums]) => {
    console.log('  ' + pdf + ' -> ' + nums.join(', '));
  });

  // Check invoices with NULL pdf_path
  const nullPdf = await p.invoice.findMany({
    where: { pdf_path: null },
    select: { id: true, invoice_number: true, status: true, vendor_name_raw: true, raw_file_url: true, sharepoint_folder_url: true },
    take: 20
  });
  console.log('\n=== Invoices with NULL pdf_path (' + nullPdf.length + ') ===');
  nullPdf.forEach(i => {
    console.log('  ' + i.invoice_number + ' | status: ' + i.status + ' | raw_file_url: ' + (i.raw_file_url || 'NULL') + ' | sp_url: ' + (i.sharepoint_folder_url || 'NULL'));
  });

  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
