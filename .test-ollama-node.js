// Test Ollama with simplified prompt
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testOllama() {
  const invoice = await prisma.invoice.findFirst({
    where: { ocr_raw_data: { path: ['raw_text'], not: null } },
    orderBy: { created_at: 'desc' },
    select: { ocr_raw_data: true, invoice_number: true },
  });

  if (!invoice || !invoice.ocr_raw_data?.raw_text) {
    console.log('No raw text found in DB');
    return;
  }

  const rawText = invoice.ocr_raw_data.raw_text.substring(0, 3000);
  console.log(`Testing with invoice ${invoice.invoice_number}, text length: ${rawText.length} chars`);
  console.log(`First 150 chars: ${rawText.substring(0, 150)}`);
  console.log('');

  const EXTRACTION_PROMPT = `Extract invoice fields from the text below. Return ONLY valid JSON.
vendor_name = supplier company (NOT Madison 88), invoice_number, invoice_date (YYYY-MM-DD), due_date (YYYY-MM-DD), payment_terms, total_amount (number), currency (USD/HKD/etc), po_number (e.g. PO3011), mpo_number (e.g. MPO015713), brand, brand_code, season, qty_shipped, document_type, bank_name, swift_code, account_number, subtotal, bank_charges, freight_charges, additional_charges, discount_amount, tax_amount, line_items [{description, quantity, unit_price, total_amount, item_code, size}].
If a field is missing, use null. Return ONLY the JSON object.
`;

  const userPrompt = 'Extract invoice fields from this text. Return ONLY valid JSON:\n' + rawText;

  const body = {
    model: 'qwen2.5:3b-instruct',
    messages: [
      { role: 'system', content: 'You are an invoice data extractor. Return ONLY valid JSON, no explanation.' },
      { role: 'user', content: EXTRACTION_PROMPT + userPrompt },
    ],
    stream: false,
    think: false,
    options: { temperature: 0.1, num_ctx: 8192, num_predict: 2048 },
  };

  console.log('Sending request to Ollama...');
  const start = Date.now();

  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const elapsed = Date.now() - start;
    const data = await res.json();
    const content = data.message?.content || data.response || '';

    console.log(`Response time: ${elapsed}ms`);
    console.log(`Response length: ${content.length} chars`);
    console.log('');

    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      console.log('Parsed JSON successfully!');
      console.log('vendor_name:', parsed.vendor_name);
      console.log('invoice_number:', parsed.invoice_number);
      console.log('invoice_date:', parsed.invoice_date);
      console.log('total_amount:', parsed.total_amount);
      console.log('currency:', parsed.currency);
      console.log('mpo_number:', parsed.mpo_number);
      console.log('po_number:', parsed.po_number);
      console.log('line_items:', parsed.line_items?.length || 0, 'items');
    } catch (e) {
      console.log('Failed to parse JSON. Raw response:');
      console.log(content.substring(0, 500));
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`Error after ${elapsed}ms:`, err.message);
  }

  await prisma.$disconnect();
}

testOllama().catch(console.error);
