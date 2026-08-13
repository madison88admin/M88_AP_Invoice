const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const commands = [
  'cd /opt/ap-invoice',
  'echo "=== Systemctl ===" > /tmp/ocr-check.txt',
  'systemctl status ap-invoice-api >> /tmp/ocr-check.txt 2>&1',
  'echo "=== Java ===" >> /tmp/ocr-check.txt',
  'java -version >> /tmp/ocr-check.txt 2>&1',
  'echo "=== Env Vars ===" >> /tmp/ocr-check.txt',
  'grep -E "SUPABASE|OCR|OPENAI|MADISON|AST|OLLAMA|GROQ" apps/api/.env 2>/dev/null | sed "s/=.*$/=***/" >> /tmp/ocr-check.txt',
  'echo "=== Journal Logs (OCR/extract/upload) ===" >> /tmp/ocr-check.txt',
  'journalctl -u ap-invoice-api --no-pager -n 500 2>&1 | grep -i "ocr\\|extract\\|madison\\|upload\\|vendor.*match\\|opendata\\|error" | tail -20 >> /tmp/ocr-check.txt',
  'echo "=== Combined Log ===" >> /tmp/ocr-check.txt',
  'grep -i "ocr\\|extract\\|madison\\|upload\\|vendor.*match" apps/api/combined.log 2>/dev/null | tail -15 >> /tmp/ocr-check.txt',
  'echo "=== API Health ===" >> /tmp/ocr-check.txt',
  'curl -s http://localhost:3001/api/health >> /tmp/ocr-check.txt 2>&1',
  'echo "=== Process ===" >> /tmp/ocr-check.txt',
  'ps aux | grep -i "node.*index\\|node.*dist" | grep -v grep >> /tmp/ocr-check.txt 2>&1',
  'echo "=== DONE ===" >> /tmp/ocr-check.txt',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, checking OCR system...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let output = '';
    stream.on('close', (code) => {
      // Now read the file
      conn.exec('cat /tmp/ocr-check.txt', (err2, stream2) => {
        if (err2) { fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-check-result.txt', output); conn.end(); return; }
        let fileContent = '';
        stream2.on('close', () => {
          fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-check-result.txt', fileContent);
          console.log(fileContent);
          conn.end();
        });
        stream2.on('data', (data) => { fileContent += data.toString(); });
        stream2.stderr.on('data', (data) => { fileContent += data.toString(); });
      });
    });
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
