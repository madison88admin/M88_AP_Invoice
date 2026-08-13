const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const commands = [
  'cd /opt/ap-invoice',
  'echo "=== PDFs on VPS ===" > /tmp/ocr-test.txt',
  'find /opt/ap-invoice -name "*.pdf" -not -path "*/node_modules/*" | head -20 >> /tmp/ocr-test.txt 2>&1',
  'echo "" >> /tmp/ocr-test.txt',
  'echo "=== Incoming invoices ===" >> /tmp/ocr-test.txt',
  'ls -la /opt/ap-invoice/incoming-invoices/ 2>/dev/null | head -20 >> /tmp/ocr-test.txt',
  'echo "" >> /tmp/ocr-test.txt',
  'echo "=== Test token ===" >> /tmp/ocr-test.txt',
  'cat /opt/ap-invoice/.test-token 2>/dev/null || echo "No test token file" >> /tmp/ocr-test.txt',
  'echo "" >> /tmp/ocr-test.txt',
  'echo "=== Check login API ===" >> /tmp/ocr-test.txt',
  'curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d \'{"email":"admin@madison88.com","password":"Madison_88_admin**"}\' >> /tmp/ocr-test.txt 2>&1',
  'echo "" >> /tmp/ocr-test.txt',
  'echo "=== DONE ===" >> /tmp/ocr-test.txt',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    stream.on('close', () => {
      conn.exec('cat /tmp/ocr-test.txt', (err2, stream2) => {
        if (err2) { console.error(err2); conn.end(); return; }
        let content = '';
        stream2.on('close', () => {
          fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-test-result.txt', content);
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
