const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');
const path = require('path');

const script = `
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Search by invoice_number HK29764832
  const invoices = await p.invoice.findMany({
    where: { invoice_number: { contains: 'HK29764832', mode: 'insensitive' } },
    select: { id: true, invoice_number: true, pdf_path: true, raw_file_url: true, sharepoint_folder_url: true, status: true, vendor_name_raw: true, created_at: true }
  });
  
  console.log('Found ' + invoices.length + ' invoices matching HK29764832');
  invoices.forEach(i => {
    console.log('\\n--- Invoice ' + i.invoice_number + ' ---');
    console.log('  id: ' + i.id);
    console.log('  status: ' + i.status);
    console.log('  vendor: ' + i.vendor_name_raw);
    console.log('  pdf_path: ' + (i.pdf_path || 'NULL'));
    console.log('  raw_file_url: ' + (i.raw_file_url || 'NULL'));
    console.log('  sharepoint_folder_url: ' + (i.sharepoint_folder_url || 'NULL'));
    console.log('  created_at: ' + i.created_at);
  });

  // Also check a few random invoices to see pdf_path patterns
  const sample = await p.invoice.findMany({
    select: { id: true, invoice_number: true, pdf_path: true, raw_file_url: true, sharepoint_folder_url: true },
    take: 10,
    orderBy: { created_at: 'desc' }
  });
  
  console.log('\\n=== Sample of 10 recent invoices ===');
  sample.forEach(i => {
    console.log(i.invoice_number + ' | pdf_path: ' + (i.pdf_path || 'NULL') + ' | raw_file_url: ' + (i.raw_file_url || 'NULL') + ' | sp_url: ' + (i.sharepoint_folder_url ? 'YES' : 'NO'));
  });
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
`;

const localFile = path.join(__dirname, 'tmp-check-pdf.js');
fs.writeFileSync(localFile, script);

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected...');
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    const ws = sftp.createWriteStream('/opt/ap-invoice/apps/api/tmp-check-pdf.js');
    ws.on('close', () => {
      conn.exec('cd /opt/ap-invoice/apps/api && node tmp-check-pdf.js 2>&1', (err, stream) => {
        if (err) { console.error('Exec error:', err); conn.end(); return; }
        let out = '';
        stream.on('data', d => out += d);
        stream.stderr.on('data', d => out += d);
        stream.on('close', () => { console.log(out); conn.end(); });
      });
    });
    fs.createReadStream(localFile).pipe(ws);
  });
});
conn.on('error', (err) => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
