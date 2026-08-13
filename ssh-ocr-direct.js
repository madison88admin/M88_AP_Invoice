const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

// Run a Node.js script on the VPS that directly calls the OCR service
const testScript = `
const fs = require('fs');
const path = require('path');

async function testOCR() {
  const files = [
    { name: 'Bo Hing_Inv_1609160_HT&DRT.pdf', path: 'incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf' },
    { name: 'test_invoice.pdf', path: 'test_invoice.pdf' },
  ];

  for (const f of files) {
    console.log('\\n=== Testing: ' + f.name + ' ===');
    if (!fs.existsSync(f.path)) {
      console.log('File not found: ' + f.path);
      continue;
    }
    
    const fileBuffer = fs.readFileSync(f.path);
    console.log('File size: ' + fileBuffer.length + ' bytes');
    
    const start = Date.now();
    try {
      // Call OCR service directly
      const { extractInvoiceFields } = require('./apps/api/dist/services/ocrService.js');
      const result = await extractInvoiceFields(fileBuffer);
      const elapsed = Date.now() - start;
      
      console.log('Elapsed: ' + elapsed + 'ms');
      console.log('Vendor: ' + (result.vendor_name || 'N/A'));
      console.log('Invoice #: ' + (result.invoice_number || 'N/A'));
      console.log('Date: ' + (result.invoice_date || 'N/A'));
      console.log('Total: ' + (result.total_amount || 'N/A'));
      console.log('Currency: ' + (result.currency || 'N/A'));
      console.log('Confidence: ' + (result.ocr_confidence_score || 'N/A'));
      console.log('PO #: ' + (result.customer_po_number || 'N/A'));
      console.log('MPO #: ' + (result.mpo_number || 'N/A'));
      console.log('Brand: ' + (result.brand || 'N/A'));
      console.log('Season: ' + (result.season || 'N/A'));
      console.log('Raw text (first 500): ' + JSON.stringify(result.raw_data || '').substring(0, 500));
    } catch (e) {
      console.log('Error: ' + e.message);
      console.log(e.stack);
    }
    console.log('---');
  }
}

testOCR().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
`;

const commands = [
  'cd /opt/ap-invoice',
  'cat > /tmp/ocr-test.js << \'ENDOFSCRIPT\'\n' + testScript + '\nENDOFSCRIPT',
  'node /tmp/ocr-test.js > /tmp/ocr-direct-result.txt 2>&1',
  'cat /tmp/ocr-direct-result.txt',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, running direct OCR test...');
  conn.exec(cmdStr, { pty: true }, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let output = '';
    stream.on('close', () => {
      fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-direct-result.txt', output);
      console.log(output);
      conn.end();
    });
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
