const { convert } = require('@opendataloader/pdf');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

async function main() {
  // Create a realistic invoice PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([612, 792]);

  let y = 750;
  page.drawText('TAX INVOICE', { x: 250, y, size: 20, font: boldFont });
  y -= 40;

  page.drawText('Vendor: CHECKPOINT SYSTEMS LIMITED', { x: 50, y, size: 11, font: boldFont });
  y -= 20;
  page.drawText('Address: 123 Industrial Park, Singapore 123456', { x: 50, y, size: 10, font });
  y -= 15;
  page.drawText('Tax ID: SG12345678', { x: 50, y, size: 10, font });
  y -= 30;

  page.drawText('Invoice No: IA00495363', { x: 50, y, size: 11, font: boldFont });
  page.drawText('Date: 15 January 2024', { x: 400, y, size: 10, font });
  y -= 20;
  page.drawText('Due Date: 14 February 2024', { x: 50, y, size: 10, font });
  page.drawText('Currency: USD', { x: 400, y, size: 10, font });
  y -= 20;
  page.drawText('Customer PO: PO-2024-001', { x: 50, y, size: 10, font });
  page.drawText('MPO: MPO-2024-001', { x: 400, y, size: 10, font });
  y -= 30;

  // Table header
  page.drawText('Description', { x: 50, y, size: 10, font: boldFont });
  page.drawText('Qty', { x: 300, y, size: 10, font: boldFont });
  page.drawText('Unit Price', { x: 380, y, size: 10, font: boldFont });
  page.drawText('Amount', { x: 480, y, size: 10, font: boldFont });
  y -= 15;
  page.drawText('Security Tags Model A', { x: 50, y, size: 10, font });
  page.drawText('100', { x: 310, y, size: 10, font });
  page.drawText('$5.00', { x: 390, y, size: 10, font });
  page.drawText('$500.00', { x: 480, y, size: 10, font });
  y -= 15;
  page.drawText('Security Tags Model B', { x: 50, y, size: 10, font });
  page.drawText('50', { x: 310, y, size: 10, font });
  page.drawText('$3.50', { x: 390, y, size: 10, font });
  page.drawText('$175.00', { x: 480, y, size: 10, font });
  y -= 30;

  page.drawText('Subtotal: $675.00', { x: 400, y, size: 10, font });
  y -= 15;
  page.drawText('Freight Charges: $25.00', { x: 400, y, size: 10, font });
  y -= 15;
  page.drawText('Bank Charges: $15.00', { x: 400, y, size: 10, font });
  y -= 15;
  page.drawText('TOTAL: $715.00 USD', { x: 400, y, size: 11, font: boldFont });
  y -= 30;

  page.drawText('Payment Terms: 30 Days', { x: 50, y, size: 10, font });
  y -= 15;
  page.drawText('Incoterm: FOB Singapore', { x: 50, y, size: 10, font });
  y -= 30;

  page.drawText('Bank Details:', { x: 50, y, size: 10, font: boldFont });
  y -= 15;
  page.drawText('Bank Name: DBS Bank Ltd', { x: 50, y, size: 10, font });
  y -= 15;
  page.drawText('SWIFT: DBSSSGSG', { x: 50, y, size: 10, font });
  y -= 15;
  page.drawText('Account No: 001-12345-678', { x: 50, y, size: 10, font });
  y -= 30;

  page.drawText('Ship To: Madison 88, Ltd., 2423 Curtis Street, Denver, Colorado 80205 USA', { x: 50, y, size: 9, font });
  y -= 15;
  page.drawText('Brand: KUHL  |  Season: F27  |  Category: TRIMS', { x: 50, y, size: 9, font });

  const pdfBytes = await pdfDoc.save();
  console.log('Created test invoice PDF:', pdfBytes.length, 'bytes');

  // Test 1: OpenDataLoader direct extraction
  console.log('\n=== Test 1: OpenDataLoader direct extraction ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odl-test-'));
  const inputPath = path.join(tmpDir, 'invoice.pdf');
  const outputDir = path.join(tmpDir, 'output');
  fs.writeFileSync(inputPath, pdfBytes);

  try {
    await convert(inputPath, { outputDir, format: 'text', quiet: true, keepLineBreaks: true });
    const files = fs.readdirSync(outputDir);
    const txtFile = files.find(f => f.endsWith('.txt'));
    if (txtFile) {
      const text = fs.readFileSync(path.join(outputDir, txtFile), 'utf8');
      console.log('Extracted text length:', text.length);
      console.log('Extracted text:');
      console.log(text);
      console.log('Contains "CHECKPOINT":', text.includes('CHECKPOINT'));
      console.log('Contains "IA00495363":', text.includes('IA00495363'));
      console.log('Contains "715.00":', text.includes('715.00'));
      console.log('Contains "DBSSSGSG":', text.includes('DBSSSGSG'));
      console.log('OpenDataLoader: PASS');
    }
  } catch (e) {
    console.error('OpenDataLoader: FAIL -', e.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Test 2: Upload through API
  console.log('\n=== Test 2: Upload through API ===');
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="test-invoice.pdf"\r\n`),
    Buffer.from(`Content-Type: application/pdf\r\n\r\n`),
    pdfBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/invoices/upload',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  };

  await new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Upload status:', res.statusCode);
        try {
          const parsed = JSON.parse(data);
          console.log('Upload response:', JSON.stringify(parsed).substring(0, 1000));
        } catch {
          console.log('Upload response:', data.substring(0, 500));
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      console.error('Upload error:', e.message);
      resolve();
    });
    req.write(body);
    req.end();
  });

  // Wait for async processing
  console.log('\nWaiting 10s for async processing...');
  await new Promise(r => setTimeout(r, 10000));

  // Check API logs for OpenDataLoader
  console.log('\n=== Checking API logs ===');
}

main().catch(e => { console.error(e); process.exit(1); });
