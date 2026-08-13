
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
    console.log('\nTrying pdf_path: ' + inv.pdf_path);
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
  console.log('\n=== Testing API endpoint ===');
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
