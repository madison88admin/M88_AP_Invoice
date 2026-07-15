const http = require('http');

const invoiceText = `Nilorn East Asia Limited
Invoice No INVP0258309
Invoice Date 06/07/2026
Bill To Madison 88 Limited
Shipment Method EXW Payment Terms 30 days net
Total USD 254.75
Bank Name: HSBC
SWIFT: HSBCHKHHHKH
Bank Account No: 500-775408-201`;

const data = JSON.stringify({
  model: 'qwen3:4b',
  messages: [
    { role: 'system', content: 'Return ONLY valid JSON. No explanation, no reasoning.' },
    { role: 'user', content: `Extract from invoice text. Output JSON only:\n{"vendor_name":"...","invoice_number":"...","invoice_date":"...","total_amount":0,"currency":"...","payment_terms":"...","bank_name":"...","swift_code":"...","account_number":"..."}\n\nInvoice:\n${invoiceText}` }
  ],
  stream: false,
  think: false,
  options: { temperature: 0.1, num_ctx: 2048, num_predict: 512 }
});

const start = Date.now();
const req = http.request({
  hostname: 'localhost',
  port: 11434,
  path: '/api/chat',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Status: ${res.statusCode}, Time: ${elapsed}s`);
    try {
      const parsed = JSON.parse(body);
      console.log('Response:', parsed.message?.content);
      console.log('Done:', parsed.done);
    } catch {
      console.log('Response:', body.substring(0, 500));
    }
  });
});
req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
