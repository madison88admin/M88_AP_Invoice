const { convert } = require('@opendataloader/pdf');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([612, 792]);

  page.drawText('INVOICE', { x: 50, y: 750, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('Vendor: Test Vendor Co., Ltd.', { x: 50, y: 700, size: 12, font });
  page.drawText('Invoice No: INV-2024-001', { x: 50, y: 680, size: 12, font });
  page.drawText('Date: 2024-01-15', { x: 50, y: 660, size: 12, font });
  page.drawText('Total Amount: $1,234.56 USD', { x: 50, y: 640, size: 12, font });
  page.drawText('SWIFT: CHASUS33', { x: 50, y: 620, size: 12, font });
  page.drawText('Account: 1234567890', { x: 50, y: 600, size: 12, font });

  const pdfBytes = await pdfDoc.save();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odl-test-'));
  const inputPath = path.join(tmpDir, 'test.pdf');
  const outputDir = path.join(tmpDir, 'output');

  fs.writeFileSync(inputPath, pdfBytes);
  console.log('Created test PDF:', pdfBytes.length, 'bytes');

  try {
    console.log('Running OpenDataLoader convert...');
    await convert(inputPath, {
      outputDir: outputDir,
      format: 'text',
      quiet: true,
      keepLineBreaks: true,
    });

    const files = fs.readdirSync(outputDir);
    console.log('Output files:', files);

    const txtFile = files.find(f => f.endsWith('.txt'));
    if (txtFile) {
      const text = fs.readFileSync(path.join(outputDir, txtFile), 'utf8');
      console.log('Extracted text:');
      console.log(text);
      console.log('\nSUCCESS: OpenDataLoader is working correctly!');
    } else {
      console.log('ERROR: No .txt output found');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
