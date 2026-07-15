const { convert } = require('@opendataloader/pdf');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const inputPath = '/incoming-invoices/manual-review/Nilorn HK Invoice INVP0258309 Care Label.pdf';
  
  if (!fs.existsSync(inputPath)) {
    console.log('File not found:', inputPath);
    return;
  }

  const fileBuffer = fs.readFileSync(inputPath);
  console.log('PDF size:', fileBuffer.length, 'bytes');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odl-bank-'));
  const tmpInput = path.join(tmpDir, 'input.pdf');
  const outputDir = path.join(tmpDir, 'output');
  fs.writeFileSync(tmpInput, fileBuffer);

  try {
    console.log('Running OpenDataLoader...');
    await convert(tmpInput, { outputDir, format: 'text', quiet: true, keepLineBreaks: true });
    
    const files = fs.readdirSync(outputDir);
    const txtFile = files.find(f => f.endsWith('.txt'));
    if (txtFile) {
      const text = fs.readFileSync(path.join(outputDir, txtFile), 'utf8');
      console.log('=== FULL EXTRACTED TEXT ===');
      console.log(text);
      console.log('=== TEXT LENGTH ===');
      console.log(text.length, 'chars');
      
      // Search for bank keywords
      console.log('\n=== BANK KEYWORD SEARCH ===');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/bank|swift|account|beneficiar|remittance|payment/i)) {
          console.log(`Line ${i}: ${lines[i]}`);
        }
      }
    }
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
