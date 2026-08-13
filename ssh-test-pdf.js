const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');
const path = require('path');

const script = `
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Get the invoice
  const inv = await p.invoice.findFirst({
    where: { invoice_number: 'HK29764832' },
    select: { id: true, invoice_number: true, pdf_path: true, raw_file_url: true }
  });
  console.log('Invoice: ' + JSON.stringify(inv, null, 2));

  // Try downloading from Supabase
  const { downloadFromStorage } = require('./dist/services/supabaseStorageService');
  
  if (inv.pdf_path) {
    console.log('\\nTrying pdf_path: ' + inv.pdf_path);
    try {
      const buf = await downloadFromStorage(inv.pdf_path);
      if (buf) {
        console.log('SUCCESS! Downloaded ' + buf.length + ' bytes');
        // Check if it's actually a PDF
        const header = buf.slice(0, 5).toString('utf8');
        console.log('File header: ' + header);
        console.log('Is PDF: ' + (header === '%PDF-'));
      } else {
        console.log('FAILED: downloadFromStorage returned null');
      }
    } catch(e) {
      console.log('ERROR: ' + e.message);
    }
  }

  // Also check what the API endpoint returns
  console.log('\\n=== Testing API endpoint ===');
  const http = require('http');
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/invoices/' + inv.id + '/document',
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  
  // We need auth token - skip this for now, just check storage
  console.log('API endpoint: GET /api/invoices/' + inv.id + '/document');
  console.log('(Requires auth token to test fully)');
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
`;

const localFile = path.join(__dirname, 'tmp-test-pdf.js');
fs.writeFileSync(localFile, script);

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected...');
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    const ws = sftp.createWriteStream('/opt/ap-invoice/apps/api/tmp-test-pdf.js');
    ws.on('close', () => {
      conn.exec('cd /opt/ap-invoice/apps/api && node tmp-test-pdf.js 2>&1', (err, stream) => {
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
