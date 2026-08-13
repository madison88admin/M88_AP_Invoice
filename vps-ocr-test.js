const fs = require('fs');
const path = require('path');

// Load .env file manually
const envPath = '/opt/ap-invoice/apps/api/.env';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  console.log('Loaded .env from ' + envPath);
}

async function testOCR() {
  const files = [
    { name: 'Bo Hing_Inv_1609160_HT&DRT.pdf', path: '/opt/ap-invoice/incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf' },
    { name: 'test_invoice.pdf', path: '/opt/ap-invoice/test_invoice.pdf' },
  ];

  const { analyzeInvoice } = require('/opt/ap-invoice/apps/api/dist/services/ocrService.js');

  for (const f of files) {
    console.log('\n========== ' + f.name + ' ==========');
    if (!fs.existsSync(f.path)) {
      console.log('File not found: ' + f.path);
      continue;
    }
    
    const fileBuffer = fs.readFileSync(f.path);
    console.log('File size: ' + fileBuffer.length + ' bytes');
    
    const start = Date.now();
    try {
      const result = await analyzeInvoice(fileBuffer, 'application/pdf');
      const elapsed = Date.now() - start;
      
      console.log('\n--- Final Result ---');
      console.log('Total elapsed: ' + elapsed + 'ms');
      console.log('OCR Engine: ' + (result.raw_data?.ocr_engine || 'N/A'));
      console.log('Vendor: ' + (result.vendor_name || 'N/A'));
      console.log('Invoice #: ' + (result.invoice_number || 'N/A'));
      console.log('Date: ' + (result.invoice_date || 'N/A'));
      console.log('Due Date: ' + (result.due_date || 'N/A'));
      console.log('Total: ' + (result.total_amount || 'N/A'));
      console.log('Currency: ' + (result.currency || 'N/A'));
      console.log('PO #: ' + (result.customer_po_number || 'N/A'));
      console.log('MPO #: ' + (result.mpo_number || 'N/A'));
      console.log('Brand: ' + (result.brand || 'N/A'));
      console.log('Season: ' + (result.season || 'N/A'));
      console.log('Payment Terms: ' + (result.payment_terms || 'N/A'));
      console.log('Confidence: ' + (result.ocr_confidence_score || 'N/A'));
      console.log('Bank Name: ' + (result.bank_info?.bank_name || 'N/A'));
      console.log('Bank SWIFT: ' + (result.bank_info?.swift_code || 'N/A'));
      console.log('Bank Account: ' + (result.bank_info?.account_usd || 'N/A'));
    } catch (e) {
      console.log('Error: ' + e.message);
      console.log(e.stack);
    }
    
    console.log('\n============================================\n');
  }
}

testOCR().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
