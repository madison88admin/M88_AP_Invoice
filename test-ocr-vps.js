/**
 * VPS OCR test script — run on the VPS to test OCR changes without restarting production.
 * Usage (on VPS): cd /opt/ap-invoice && node test-ocr-vps.js [path-to-pdf]
 */
const path = require('path');
const fs = require('fs');

// Load .env
const envPath = path.join(__dirname, 'apps/api/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function main() {
  const pdfPath = process.argv[2] || path.join(__dirname, 'test_invoice.pdf');
  if (!fs.existsSync(pdfPath)) {
    console.error(`[TEST] PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(pdfPath);
  console.log(`[TEST] Loaded PDF: ${pdfPath} (${(fileBuffer.length / 1024).toFixed(0)}KB)\n`);

  // Use ts-node to import the TypeScript modules directly
  const { execSync } = require('child_process');
  const os = require('os');

  // ── Test 1: pdf2json text extraction ──
  console.log('═══════════════════════════════════════════');
  console.log(' TEST 1: pdf2json text extraction');
  console.log('═══════════════════════════════════════════');
  try {
    const PDFParser = require(path.join(__dirname, 'apps/api/node_modules/pdf2json'));
    const rawText = await new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser)(null, 1);
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        const text = pdfData.Pages
          .map((page) => page.Texts.map((t) => {
            try { return decodeURIComponent(t.R[0].T); } catch { return t.R[0].T; }
          }).join(' '))
          .join('\n');
        resolve(text);
      });
      pdfParser.on('pdfParser_dataError', reject);
      pdfParser.parseBuffer(fileBuffer);
    });
    console.log(`  Text length: ${rawText.length} chars`);
    console.log(`  First 300 chars:\n  ${rawText.substring(0, 300)}`);
    console.log(`  Last 300 chars:\n  ${rawText.substring(Math.max(0, rawText.length - 300))}`);
    console.log(`  Status: ${rawText.length > 50 ? '✅ Sufficient text' : '⚠️  Low text — likely scanned PDF'}\n`);
  } catch (e) {
    console.log(`  ❌ pdf2json failed: ${e.message}\n`);
  }

  // ── Test 2: PDF-to-image conversion (300 DPI, grayscale, all pages) ──
  console.log('═══════════════════════════════════════════');
  console.log(' TEST 2: PDF-to-image conversion (300 DPI, grayscale, ALL pages)');
  console.log('═══════════════════════════════════════════');
  try {
    const tmpDir = os.tmpdir();
    const tmpPdf = path.join(tmpDir, `test_ocr_${Date.now()}.pdf`);
    const tmpPrefix = path.join(tmpDir, `test_ocr_${Date.now()}`);
    fs.writeFileSync(tmpPdf, fileBuffer);

    execSync(`pdftoppm -png -gray -r 300 "${tmpPdf}" "${tmpPrefix}"`, { timeout: 60000, stdio: 'pipe' });
    const prefix = path.basename(tmpPrefix);
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(prefix) && f.endsWith('.png')).sort();

    console.log(`  Pages converted: ${files.length} ✅`);
    for (const f of files) {
      const stat = fs.statSync(path.join(tmpDir, f));
      console.log(`    ${f}: ${(stat.size / 1024).toFixed(0)}KB`);
      fs.unlinkSync(path.join(tmpDir, f));
    }
    fs.unlinkSync(tmpPdf);
    console.log('');
  } catch (e) {
    console.log(`  ❌ Image conversion failed: ${e.message}\n`);
  }

  // ── Test 3: AI engine availability ──
  console.log('═══════════════════════════════════════════');
  console.log(' TEST 3: AI engine availability');
  console.log('═══════════════════════════════════════════');
  const hasGemini = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your-gemini-api-key';
  const hasGroq = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your-groq-api-key';
  const hasOllama = !!process.env.OLLAMA_BASE_URL;
  const hasQwen = (!!process.env.DASHSCOPE_API_KEY || !!process.env.QWEN_API_KEY) &&
    process.env.DASHSCOPE_API_KEY !== 'your-dashscope-api-key';

  console.log(`  Gemini Vision:  ${hasGemini ? '✅' : '❌'} (model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
  console.log(`  Groq (Llama):   ${hasGroq ? '✅' : '❌'} (model: ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})`);
  console.log(`  Ollama (Qwen):  ${hasOllama ? '✅' : '❌'} (url: ${process.env.OLLAMA_BASE_URL || 'N/A'}, model: ${process.env.OLLAMA_MODEL || 'N/A'})`);
  console.log(`  Qwen (DashScope): ${hasQwen ? '✅' : '❌'} (model: ${process.env.QWEN_MODEL || 'qwen-plus'})`);
  console.log('');

  // ── Test 4: Full OCR extraction via analyzeInvoice ──
  console.log('═══════════════════════════════════════════');
  console.log(' TEST 4: Full OCR extraction (analyzeInvoice)');
  console.log('═══════════════════════════════════════════');
  try {
    // Use the compiled dist version
    const distPath = path.join(__dirname, 'apps/api/dist/services/ocrService.js');
    if (!fs.existsSync(distPath)) {
      console.log('  ⚠️  dist not found — building first...');
      execSync('cd apps/api && npx tsc', { cwd: __dirname, timeout: 120000, stdio: 'inherit' });
    }

    // Load the compiled module
    const ocrModule = require(distPath);
    const result = await ocrModule.analyzeInvoice(fileBuffer, 'application/pdf');

    console.log('\n  ── Extraction Results ──');
    console.log(`  Vendor:       ${result.vendor_name || '❌ MISSING'}`);
    console.log(`  Invoice #:    ${result.invoice_number || '❌ MISSING'}`);
    console.log(`  Invoice Date: ${result.invoice_date?.toISOString?.() || result.invoice_date || '❌ MISSING'}`);
    console.log(`  Due Date:     ${result.due_date?.toISOString?.() || result.due_date || '❌ MISSING'}`);
    console.log(`  Total Amount: ${result.total_amount || '❌ MISSING'} ${result.currency || ''}`);
    console.log(`  Currency:     ${result.currency || '❌ MISSING'}`);
    console.log(`  PO Reference: ${result.customer_po_number || '❌ MISSING'}`);
    console.log(`  MPO Number:   ${result.mpo_number || '❌ MISSING'}`);
    console.log(`  Payment Terms: ${result.payment_terms || '❌ MISSING'}`);
    console.log(`  Bank Name:    ${result.bank_info?.bank_name || '❌ MISSING'}`);
    console.log(`  SWIFT Code:   ${result.bank_info?.swift_code || '❌ MISSING'}`);
    console.log(`  Account #:    ${result.bank_info?.account_usd || '❌ MISSING'}`);
    console.log(`  Line Items:   ${result.line_items?.length || 0}`);
    console.log(`  Signatures:   ${result.signatures?.length || 0}`);
    console.log(`  OCR Engine:   ${result.raw_data?.ocr_engine || 'unknown'}`);
    console.log(`  Confidence:   ${((result.ocr_confidence_score || 0) * 100).toFixed(1)}%`);
    console.log(`  Invoice Type: ${result.invoice_type || '❌ MISSING'}`);
    console.log(`  Is Handwritten: ${result.is_handwritten}`);
    console.log('');
  } catch (e) {
    console.log(`  ❌ Extraction failed: ${e.message}`);
    console.log(`  Stack: ${e.stack?.split('\n').slice(0, 5).join('\n')}`);
  }

  console.log('═══════════════════════════════════════════');
  console.log(' TEST COMPLETE');
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[TEST] Fatal:', err);
  process.exit(1);
});
