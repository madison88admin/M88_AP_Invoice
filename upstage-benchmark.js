/**
 * Upstage OCR Benchmark
 * Tests 3 Upstage APIs against sample invoices:
 *   1. Document OCR — text extraction (compare with RapidOCR)
 *   2. Document Parse — structured HTML/Markdown
 *   3. Information Extraction — direct field extraction (compare with Groq)
 *
 * Usage: node upstage-benchmark.js
 */

const fs = require('fs');
const path = require('path');

const UPSTAGE_API_KEY = 'up_Hk6EryhvPvdomcYPxcVyq2vOpn5Ya';
const UPSTAGE_BASE = 'https://api.upstage.ai/v1';

const SAMPLE_FILES = [
  {
    name: 'Bo Hing_Inv_1609160_HT&DRT.pdf',
    path: path.join(__dirname, 'incoming-invoices', 'Bo Hing_Inv_1609160_HT&DRT.pdf'),
  },
  {
    name: 'test_invoice.pdf',
    path: path.join(__dirname, 'test_invoice.pdf'),
  },
];

// ─── Invoice extraction schema for Information Extraction API ───
// Note: first-level properties must be string/integer/number/array (no objects)
const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    vendor_name: { type: 'string', description: 'Company name of the vendor/supplier (NOT Madison 88)' },
    invoice_number: { type: 'string', description: 'Invoice number or reference' },
    invoice_date: { type: 'string', description: 'Date of invoice (YYYY-MM-DD)' },
    due_date: { type: 'string', description: 'Due date / payment due date (YYYY-MM-DD)' },
    payment_terms: { type: 'string', description: 'Payment terms text (e.g. Net 30, T/T 100%)' },
    total_amount: { type: 'string', description: 'Final total amount (number only, no currency symbol)' },
    currency: { type: 'string', description: 'Currency code (USD, HKD, EUR, etc.)' },
    po_number: { type: 'string', description: 'Purchase Order number (e.g. PO000002_KEY)' },
    mpo_number: { type: 'string', description: 'Material Purchase Order number (e.g. MPO015713)' },
    brand: { type: 'string', description: 'Brand name (The North Face, Under Armour, Vans, etc.)' },
    brand_code: { type: 'string', description: 'Brand code (TNF, UA, VNS, CSC, HH, BUR, etc.)' },
    season: { type: 'string', description: 'Season code (F26, S26, F25, etc.)' },
    ship_to: { type: 'string', description: 'Ship to / delivery address' },
    sold_to: { type: 'string', description: 'Sold to / invoice address' },
    qty_shipped: { type: 'string', description: 'Total quantity shipped' },
    document_type: { type: 'string', description: 'INVOICE, PROFORMA, COMMERCIAL_INVOICE, CREDIT_NOTE, STATEMENT' },
    beneficiary_name: { type: 'string', description: 'Beneficiary / account holder name' },
    bank_name: { type: 'string', description: 'Bank name of vendor bank' },
    swift_code: { type: 'string', description: 'SWIFT/BIC code' },
    account_number: { type: 'string', description: 'Bank account number' },
    subtotal: { type: 'string', description: 'Sub-total before charges and tax (number only)' },
    bank_charges: { type: 'string', description: 'Bank charge fee (number only)' },
    tt_charge: { type: 'string', description: 'Telegraphic Transfer charge (number only)' },
    freight_charges: { type: 'string', description: 'Freight charge (number only)' },
    courier_charges: { type: 'string', description: 'Courier charge (number only)' },
    handling_fee: { type: 'string', description: 'Handling fee (number only)' },
    finance_surcharge: { type: 'string', description: 'Finance surcharge (number only)' },
    tax_amount: { type: 'string', description: 'VAT/GST/Tax amount (number only)' },
    discount_amount: { type: 'string', description: 'Discount amount (number only)' },
    incoterm: { type: 'string', description: 'Trade term (EXW, DAP, FOB, CIF, DDP, etc.)' },
    exchange_rate: { type: 'string', description: 'Exchange rate if mentioned (number only)' },
    is_handwritten: { type: 'string', description: 'true if handwritten' },
    is_statement: { type: 'string', description: 'true if statement not invoice' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Item description' },
          quantity: { type: 'string', description: 'Quantity as number' },
          unit_price: { type: 'string', description: 'Unit price as number' },
          total_amount: { type: 'string', description: 'Line total as number' },
          item_code: { type: 'string', description: 'Item code if present' },
          size: { type: 'string', description: 'Size if present (S, M, L, XL, etc.)' },
          mpo_number: { type: 'string', description: 'MPO for this specific line' },
          po_number: { type: 'string', description: 'PO for this specific line' },
        },
      },
    },
    signatures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          signatory_name: { type: 'string', description: 'Person name as printed/signed' },
          signatory_role: { type: 'string', description: 'Role if stated' },
          signed_date: { type: 'string', description: 'Date next to signature (YYYY-MM-DD)' },
        },
      },
    },
  },
  required: ['vendor_name', 'invoice_number', 'total_amount'],
};

// ─── Helper: multipart/form-data builder ───
function buildMultipart(fields) {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const buffers = [];

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'document') {
      // File part: header string + binary data + trailing CRLF
      const header =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="document"; filename="${value.filename}"\r\n` +
        `Content-Type: ${value.contentType}\r\n\r\n`;
      buffers.push(Buffer.from(header, 'utf8'));
      buffers.push(value.data); // binary file data
      buffers.push(Buffer.from('\r\n', 'utf8'));
    } else {
      // Text field part
      const part =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}\r\n`;
      buffers.push(Buffer.from(part, 'utf8'));
    }
  }

  // Closing boundary
  buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  const body = Buffer.concat(buffers);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── 1. Document OCR ───
async function testDocumentOCR(fileBuffer, filename) {
  const start = Date.now();
  const { body, contentType } = buildMultipart({
    model: 'ocr',
    document: { data: fileBuffer, filename, contentType: 'application/pdf' },
  });

  const response = await fetch(`${UPSTAGE_BASE}/document-digitization`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTAGE_API_KEY}`,
      'Content-Type': contentType,
    },
    body,
    signal: AbortSignal.timeout(120000),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Document OCR HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return { data, elapsed };
}

// ─── 2. Document Parse ───
async function testDocumentParse(fileBuffer, filename) {
  const start = Date.now();
  const { body, contentType } = buildMultipart({
    model: 'document-parse',
    document: { data: fileBuffer, filename, contentType: 'application/pdf' },
    output_formats: '["text", "markdown"]',
    ocr: 'force',
    coordinates: 'false',
  });

  const response = await fetch(`${UPSTAGE_BASE}/document-digitization`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTAGE_API_KEY}`,
      'Content-Type': contentType,
    },
    body,
    signal: AbortSignal.timeout(120000),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Document Parse HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return { data, elapsed };
}

// ─── 3. Information Extraction ───
async function testInformationExtraction(fileBuffer, filename) {
  const start = Date.now();
  const base64Data = fileBuffer.toString('base64');

  const requestBody = {
    model: 'information-extract',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:application/octet-stream;base64,${base64Data}`,
            },
          },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'invoice_schema',
        schema: INVOICE_SCHEMA,
      },
    },
  };

  const response = await fetch(`${UPSTAGE_BASE}/information-extraction`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(120000),
  });

  const elapsed = Date.now() - start;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Information Extraction HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return { data, elapsed };
}

// ─── Extract text from Document Parse response ───
function extractParseText(data) {
  if (data.content && data.content.text) return data.content.text;
  if (data.content && data.content.markdown) return data.content.markdown;
  if (data.text) return data.text;
  if (data.elements) {
    return data.elements
      .map(el => el.text || el.html || el.markdown || '')
      .filter(Boolean)
      .join('\n');
  }
  if (data.results) {
    return data.results
      .map(r => r.text || r.markdown || r.html || '')
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(data).substring(0, 2000);
}

// ─── Main benchmark ───
async function runBenchmark() {
  console.log('='.repeat(80));
  console.log('  Upstage OCR Benchmark');
  console.log('  API Key: ' + UPSTAGE_API_KEY.substring(0, 10) + '...');
  console.log('='.repeat(80));

  const results = [];

  for (const file of SAMPLE_FILES) {
    if (!fs.existsSync(file.path)) {
      console.log(`\n[SKIP] File not found: ${file.path}`);
      continue;
    }

    const fileBuffer = fs.readFileSync(file.path);
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  FILE: ${file.name} (${fileBuffer.length} bytes)`);
    console.log(`${'─'.repeat(80)}`);

    const fileResult = { name: file.name, size: fileBuffer.length, tests: {} };

    // Test 1: Document OCR
    console.log('\n  [1/3] Document OCR (model=ocr)...');
    try {
      const { data, elapsed } = await testDocumentOCR(fileBuffer, file.name);
      const textLength = data.text ? data.text.length : 0;
      const confidence = data.confidence || 'N/A';
      const pages = data.numBilledPages || (data.pages ? data.pages.length : '?');

      console.log(`    ✅ Success — ${elapsed}ms, ${textLength} chars, confidence: ${confidence}, ${pages} pages`);
      console.log(`    Text preview (first 300 chars):`);
      console.log(`    ${(data.text || '').substring(0, 300).replace(/\n/g, '\n    ')}`);

      fileResult.tests.documentOCR = {
        success: true,
        elapsed_ms: elapsed,
        text_length: textLength,
        confidence,
        pages,
        text_preview: (data.text || '').substring(0, 500),
      };
    } catch (e) {
      console.log(`    ❌ Failed: ${e.message}`);
      fileResult.tests.documentOCR = { success: false, error: e.message };
    }

    // Rate limit: 1 RPS — wait 1.5s between calls
    await sleep(1500);

    // Test 2: Document Parse
    console.log('\n  [2/3] Document Parse (model=document-parse)...');
    try {
      const { data, elapsed } = await testDocumentParse(fileBuffer, file.name);
      const parsedText = extractParseText(data);
      const textLength = parsedText.length;

      console.log(`    ✅ Success — ${elapsed}ms, ${textLength} chars`);
      console.log(`    Text preview (first 300 chars):`);
      console.log(`    ${parsedText.substring(0, 300).replace(/\n/g, '\n    ')}`);

      fileResult.tests.documentParse = {
        success: true,
        elapsed_ms: elapsed,
        text_length: textLength,
        text_preview: parsedText.substring(0, 500),
        raw_keys: Object.keys(data),
      };
    } catch (e) {
      console.log(`    ❌ Failed: ${e.message}`);
      fileResult.tests.documentParse = { success: false, error: e.message };
    }

    await sleep(1500);

    // Test 3: Information Extraction
    console.log('\n  [3/3] Information Extraction (model=information-extract)...');
    try {
      const { data, elapsed } = await testInformationExtraction(fileBuffer, file.name);

      // Parse the extracted JSON from response
      let extracted = null;
      try {
        const content = data.choices?.[0]?.message?.content || '';
        extracted = JSON.parse(content);
      } catch {
        extracted = { raw_content: data.choices?.[0]?.message?.content };
      }

      const usage = data.usage || {};
      const fields = extracted ? Object.keys(extracted).filter(k => extracted[k] && extracted[k] !== '') : [];

      console.log(`    ✅ Success — ${elapsed}ms, ${fields.length} fields extracted`);
      console.log(`    Tokens: prompt=${usage.prompt_tokens || '?'}, completion=${usage.completion_tokens || '?'}, total=${usage.total_tokens || '?'}`);
      console.log(`    Extracted fields:`);

      // Print all non-empty fields
      for (const [key, value] of Object.entries(extracted || {})) {
        if (value && value !== '' && !(Array.isArray(value) && value.length === 0)) {
          const display = Array.isArray(value)
            ? `[${value.length} items] ${JSON.stringify(value[0] || {}).substring(0, 100)}...`
            : String(value).substring(0, 120);
          console.log(`      ${key}: ${display}`);
        }
      }

      fileResult.tests.informationExtraction = {
        success: true,
        elapsed_ms: elapsed,
        fields_extracted: fields,
        field_count: fields.length,
        extracted,
        usage,
      };
    } catch (e) {
      console.log(`    ❌ Failed: ${e.message}`);
      fileResult.tests.informationExtraction = { success: false, error: e.message };
    }

    results.push(fileResult);
  }

  // ─── Summary ───
  console.log('\n\n' + '='.repeat(80));
  console.log('  BENCHMARK SUMMARY');
  console.log('='.repeat(80));

  for (const file of results) {
    console.log(`\n  📄 ${file.name} (${file.size} bytes)`);
    console.log('  ' + '─'.repeat(60));

    for (const [testName, testResult] of Object.entries(file.tests)) {
      const status = testResult.success ? '✅' : '❌';
      const time = testResult.success ? `${testResult.elapsed_ms}ms` : 'N/A';
      const detail = testResult.success
        ? testName === 'informationExtraction'
          ? `${testResult.field_count} fields`
          : `${testResult.text_length} chars`
        : testResult.error?.substring(0, 80);
      console.log(`    ${status} ${testName.padEnd(25)} ${time.padStart(8)}   ${detail}`);
    }
  }

  // ─── Comparison with existing pipeline ───
  console.log('\n\n' + '='.repeat(80));
  console.log('  COMPARISON WITH EXISTING PIPELINE');
  console.log('='.repeat(80));
  console.log('  ┌─────────────────────────┬──────────┬──────────┬──────────┐');
  console.log('  │ Engine                  │ Time     │ Text/Fields│ Source   │');
  console.log('  ├─────────────────────────┼──────────┼──────────┼──────────┤');
  console.log('  │ RapidOCR (local)        │ 5-9s     │ Text only │ VPS      │');
  console.log('  │ RapidOCR + Groq         │ 7-11s    │ Fields    │ VPS+API  │');
  console.log('  │ Groq (text only)        │ 1.9s     │ Fields    │ API      │');
  console.log('  │ Ollama (text only)      │ 73-88s   │ Fields    │ VPS      │');
  console.log('  │ Gemini Vision           │ 3-5s     │ Fields    │ API      │');
  console.log('  │ Upstage Doc OCR         │ See above│ Text only │ API      │');
  console.log('  │ Upstage Doc Parse       │ See above│ Structured│ API      │');
  console.log('  │ Upstage Info Extract    │ See above│ Fields    │ API      │');
  console.log('  └─────────────────────────┴──────────┴──────────┴──────────┘');

  // Save full results to file
  const resultsFile = path.join(__dirname, 'upstage-benchmark-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n  📁 Full results saved to: ${resultsFile}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runBenchmark().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
