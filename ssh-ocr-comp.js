const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const commands = [
  'cd /opt/ap-invoice',
  'echo "=== OCR COMPARISON TEST ===" > /tmp/ocr-comp.txt',
  'echo "" >> /tmp/ocr-comp.txt',
  // Login to get token
  'TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d \'{"email":"test.supervisor@madison88.com","password":"Madison_88_admin**"}\' | grep -o \'"token":"[^"]*"\' | head -1 | sed "s/.*://" | tr -d \'"\' )',
  'echo "Token obtained: ${TOKEN:0:20}..." >> /tmp/ocr-comp.txt',
  'echo "" >> /tmp/ocr-comp.txt',
  // Test 1: Bo Hing invoice
  'echo "=== TEST 1: Bo Hing_Inv_1609160_HT&DRT.pdf ===" >> /tmp/ocr-comp.txt',
  'echo "File size: $(stat -c%s "incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf") bytes" >> /tmp/ocr-comp.txt',
  'START=$(date +%s%N)',
  'curl -s -X POST http://localhost:3001/api/invoices/upload -H "Authorization: Bearer $TOKEN" -F "file=@incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf" --max-time 180 >> /tmp/ocr-comp.txt 2>&1',
  'END=$(date +%s%N)',
  'ELAPSED=$(( (END - START) / 1000000 ))',
  'echo "" >> /tmp/ocr-comp.txt',
  'echo "Elapsed: ${ELAPSED}ms" >> /tmp/ocr-comp.txt',
  'echo "" >> /tmp/ocr-comp.txt',
  // Test 2: test_invoice.pdf
  'echo "=== TEST 2: test_invoice.pdf ===" >> /tmp/ocr-comp.txt',
  'echo "File size: $(stat -c%s test_invoice.pdf) bytes" >> /tmp/ocr-comp.txt',
  'START2=$(date +%s%N)',
  'curl -s -X POST http://localhost:3001/api/invoices/upload -H "Authorization: Bearer $TOKEN" -F "file=@test_invoice.pdf" --max-time 180 >> /tmp/ocr-comp.txt 2>&1',
  'END2=$(date +%s%N)',
  'ELAPSED2=$(( (END2 - START2) / 1000000 ))',
  'echo "" >> /tmp/ocr-comp.txt',
  'echo "Elapsed: ${ELAPSED2}ms" >> /tmp/ocr-comp.txt',
  'echo "" >> /tmp/ocr-comp.txt',
  'echo "=== DONE ===" >> /tmp/ocr-comp.txt',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, running OCR comparison test...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    stream.on('close', () => {
      conn.exec('cat /tmp/ocr-comp.txt', (err2, stream2) => {
        if (err2) { console.error(err2); conn.end(); return; }
        let content = '';
        stream2.on('close', () => {
          fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-comp-result.txt', content);
          console.log(content);
          conn.end();
        });
        stream2.on('data', (data) => { content += data.toString(); });
        stream2.stderr.on('data', (data) => { content += data.toString(); });
      });
    });
    stream.on('data', () => {});
    stream.stderr.on('data', () => {});
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
