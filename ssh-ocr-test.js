const fs = require('fs');
const path = require('path');
const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

// Test PDFs to compare
const testFiles = [
  { name: 'Bo Hing_Inv_1609160_HT&DRT.pdf', path: '/opt/ap-invoice/incoming-invoices/Bo Hing_Inv_1609160_HT&DRT.pdf' },
  { name: 'test_invoice.pdf', path: '/opt/ap-invoice/test_invoice.pdf' },
];

const commands = [
  'echo "=== OCR COMPARISON TEST ===" > /tmp/ocr-comparison.txt',
  'echo "" >> /tmp/ocr-comparison.txt',
];

for (const f of testFiles) {
  commands.push(
    `echo "--- Testing: ${f.name} ---" >> /tmp/ocr-comparison.txt`,
    `echo "File: ${f.path}" >> /tmp/ocr-comparison.txt`,
    `if [ -f "${f.path}" ]; then`,
    `  echo "File exists, size: $(stat -c%s "${f.path}") bytes" >> /tmp/ocr-comparison.txt`,
    `  echo "" >> /tmp/ocr-comparison.txt`,
    `  echo "=== Current OCR (OpenDataLoader + Ollama) ===" >> /tmp/ocr-comparison.txt`,
    `  START=$(date +%s%N)`,
    `  curl -s -X POST http://localhost:3001/api/invoices/upload \\`,
    `    -H "Authorization: Bearer $(cat /opt/ap-invoice/.test-token 2>/dev/null || echo 'test')" \\`,
    `    -F "file=@${f.path}" \\`,
    `    --max-time 120 >> /tmp/ocr-comparison.txt 2>&1`,
    `  END=$(date +%s%N)`,
    `  ELAPSED=$(( (END - START) / 1000000 ))`,
    `  echo "" >> /tmp/ocr-comparison.txt`,
    `  echo "Elapsed: ${ELAPSED}ms" >> /tmp/ocr-comparison.txt`,
    `else`,
    `  echo "File not found" >> /tmp/ocr-comparison.txt`,
    `fi`,
    `echo "" >> /tmp/ocr-comparison.txt`,
    `echo "========================================" >> /tmp/ocr-comparison.txt`,
    `echo "" >> /tmp/ocr-comparison.txt`,
  );
}

commands.push('echo "=== DONE ===" >> /tmp/ocr-comparison.txt');

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, running OCR comparison...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let output = '';
    stream.on('close', () => {
      // Read the result file
      conn.exec('cat /tmp/ocr-comparison.txt', (err2, stream2) => {
        if (err2) { console.error('Read error:', err2); conn.end(); return; }
        let content = '';
        stream2.on('close', () => {
          fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-comparison-result.txt', content);
          console.log(content);
          conn.end();
        });
        stream2.on('data', (data) => { content += data.toString(); });
        stream2.stderr.on('data', (data) => { content += data.toString(); });
      });
    });
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
