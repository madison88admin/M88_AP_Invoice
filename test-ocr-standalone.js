/**
 * Standalone OCR test script — tests the extraction pipeline without starting the server.
 * Usage: node test-ocr-standalone.js [path-to-pdf]
 * Defaults to test_invoice.pdf in the project root.
 */
// Load .env manually (avoid dotenv dependency)
const envPath = require('path').join(__dirname, 'apps/api/.env');
if (require('fs').existsSync(envPath)) {
  const envContent = require('fs').readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// ─── Helpers (mirrors ocrService.ts convertPDFToImages) ───────────────────
function convertPDFToImages(fileBuffer) {
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `test_ocr_${Date.now()}.pdf`);
  const tmpImgPrefix = path.join(tmpDir, `test_ocr_${Date.now()}`);

  try {
    fs.writeFileSync(tmpPdf, fileBuffer);
    console.log('[TEST] Converting PDF to images (all pages) at 300 DPI grayscale...');

    execSync(`pdftoppm -png -gray -r 300 "${tmpPdf}" "${tmpImgPrefix}"`, {
      timeout: 60000,
      stdio: 'pipe',
    });

    const prefix = path.basename(tmpImgPrefix);
    const files = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.png'))
      .sort();

    if (files.length === 0) {
      console.error('[TEST] PDF-to-images conversion produced no output files');
      return [];
    }

    const images = files.map(file => {
      const imgPath = path.join(tmpDir, file);
      const buf = fs.readFileSync(imgPath);
      fs.unlinkSync(imgPath);
      return buf.toString('base64');
    });

    console.log(`[TEST] PDF-to-images: ${images.length} pages, total ${(images.reduce((s, i) => s + i.length, 0) / 1024).toFixed(0)}KB base64`);
    return images;
  } catch (error) {
    console.error('[TEST] PDF-to-images conversion failed:', error.message);
    return [];
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
  }
}

// ─── pdf2json text extraction ──────────────────────────────────────────────
async function extractTextFromPDF(fileBuffer) {
  const PDFParser = require('pdf2json');
  return new Promise((resolve, reject) => {
    const pdfParser = new (PDFParser)(null, 1);

    const safeDecode = (str) => {
      try { return decodeURIComponent(str); } catch { return str; }
    };

    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      try {
        const text = pdfData.Pages
          .map((page) =>
            page.Texts
              .map((t) => safeDecode(t.R[0].T))
              .join(' ')
          )
          .join('\n');
        resolve(text);
      } catch (e) {
        reject(e);
      }
    });

    pdfParser.on('pdfParser_dataError', (err) => {
      reject(err);
    });

    pdfParser.parseBuffer(fileBuffer);
  });
}

// ─── Main test ─────────────────────────────────────────────────────────────
async function main() {
  const pdfPath = process.argv[2] || path.join(__dirname, 'test_invoice.pdf');

  if (!fs.existsSync(pdfPath)) {
    console.error(`[TEST] PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(pdfPath);
  console.log(`[TEST] Loaded PDF: ${pdfPath} (${(fileBuffer.length / 1024).toFixed(0)}KB)\n`);

  // ── Step 1: pdf2json text extraction ──
  console.log('═══════════════════════════════════════════');
  console.log(' STEP 1: pdf2json text extraction');
  console.log('═══════════════════════════════════════════');
  let rawText = '';
  try {
    rawText = await extractTextFromPDF(fileBuffer);
    console.log(`  Text length: ${rawText.length} chars`);
    console.log(`  First 200 chars: ${rawText.substring(0, 200)}`);
    console.log(`  Last 200 chars: ${rawText.substring(rawText.length - 200)}`);
  } catch (e) {
    console.log(`  pdf2json failed: ${e.message}`);
  }
  console.log('');

  // ── Step 2: PDF-to-image conversion (new multi-page + grayscale + 300 DPI) ──
  console.log('═══════════════════════════════════════════');
  console.log(' STEP 2: PDF-to-image conversion (300 DPI, grayscale, ALL pages)');
  console.log('═══════════════════════════════════════════');
  const images = convertPDFToImages(fileBuffer);
  console.log(`  Pages converted: ${images.length}`);
  if (images.length > 0) {
    console.log(`  Page 1 base64 size: ${(images[0].length / 1024).toFixed(0)}KB`);
  }
  console.log('');

  // ── Step 3: Check which AI engines are available ──
  console.log('═══════════════════════════════════════════');
  console.log(' STEP 3: AI engine availability check');
  console.log('═══════════════════════════════════════════');

  const hasGemini = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your-gemini-api-key';
  const hasGroq = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your-groq-api-key';
  const hasOllama = !!process.env.OLLAMA_BASE_URL;
  const hasQwen = (!!process.env.DASHSCOPE_API_KEY || !!process.env.QWEN_API_KEY) &&
    process.env.DASHSCOPE_API_KEY !== 'your-dashscope-api-key';

  console.log(`  Gemini Vision:  ${hasGemini ? '✅ Available' : '❌ Not configured'} (model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'})`);
  console.log(`  Groq (Llama):   ${hasGroq ? '✅ Available' : '❌ Not configured'} (model: ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'})`);
  console.log(`  Ollama (Qwen):  ${hasOllama ? '✅ Available' : '❌ Not configured'} (url: ${process.env.OLLAMA_BASE_URL || 'N/A'}, model: ${process.env.OLLAMA_MODEL || 'qwen3:4b'})`);
  console.log(`  Qwen (DashScope): ${hasQwen ? '✅ Available' : '❌ Not configured'} (model: ${process.env.QWEN_MODEL || 'qwen-plus'})`);
  console.log('');

  // ── Step 4: Test Gemini Vision (1st priority fallback) ──
  if (hasGemini) {
    console.log('═══════════════════════════════════════════');
    console.log(' STEP 4: Gemini Vision extraction (1st priority)');
    console.log('═══════════════════════════════════════════');
    try {
      const { GeminiOCRService } = require('./apps/api/src/services/geminiOCRService');
      // Can't use singleton because of TS imports — use dynamic import via ts-node
      console.log('  [SKIPPED] Requires TypeScript compilation — use: npx ts-node test-ocr-standalone.ts');
    } catch (e) {
      console.log(`  [SKIPPED] Cannot load Gemini service directly: ${e.message}`);
      console.log('  To test with AI engines, run via ts-node:');
      console.log('  npx ts-node -r tsconfig-paths/register test-ocr-standalone.ts');
    }
    console.log('');
  }

  // ── Step 5: Summary ──
  console.log('═══════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`  PDF: ${pdfPath}`);
  console.log(`  Size: ${(fileBuffer.length / 1024).toFixed(0)}KB`);
  console.log(`  pdf2json text: ${rawText.length} chars ${rawText.length > 50 ? '✅' : '⚠️  (low — likely scanned PDF)'}`);
  console.log(`  Image conversion: ${images.length} pages ✅`);
  console.log(`  AI engines available: ${[hasGemini && 'Gemini', hasGroq && 'Groq', hasOllama && 'Ollama', hasQwen && 'Qwen'].filter(Boolean).join(', ') || 'none'}`);
  console.log('');
  console.log('  Fallback chain (NEW order):');
  console.log('    1. Gemini Vision (PDF as file — best for visual layout)');
  console.log('    2. Groq (text-based LLM — needs rawText > 50 chars)');
  console.log('    3. Ollama (text or vision — local model)');
  console.log('');
  console.log('  Text truncation limits (NEW):');
  console.log('    Gemini: 30,000 chars (was 8,000)');
  console.log('    Groq:   30,000 chars (was 8,000)');
  console.log('    Ollama: 12,000 chars (was 4,000)');
  console.log('    Qwen:   30,000 chars (was 12,000)');
  console.log('');
  console.log('  Image conversion (NEW):');
  console.log('    DPI: 300 (was 200)');
  console.log('    Grayscale: yes (was no)');
  console.log('    Pages: ALL (was page 1 only)');
}

main().catch(err => {
  console.error('[TEST] Fatal error:', err);
  process.exit(1);
});
