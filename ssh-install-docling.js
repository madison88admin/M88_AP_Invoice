const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const commands = [
  'echo "=== Python Check ===" > /tmp/docling-perf.txt',
  'python3 --version >> /tmp/docling-perf.txt 2>&1',
  'pip3 --version >> /tmp/docling-perf.txt 2>&1',
  'echo "" >> /tmp/docling-perf.txt',
  'echo "=== Install Docling + RapidOCR ===" >> /tmp/docling-perf.txt',
  'pip3 install --break-system-packages --ignore-installed docling rapidocr-onnxruntime pdf2image pillow 2>&1 | tail -15 >> /tmp/docling-perf.txt',
  'echo "" >> /tmp/docling-perf.txt',
  'echo "=== Check poppler ===" >> /tmp/docling-perf.txt',
  'which pdftoppm >> /tmp/docling-perf.txt 2>&1',
  'echo "=== DONE ===" >> /tmp/docling-perf.txt',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, installing Docling/RapidOCR...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    stream.on('close', () => {
      conn.exec('cat /tmp/docling-perf.txt', (err2, stream2) => {
        if (err2) { console.error(err2); conn.end(); return; }
        let content = '';
        stream2.on('close', () => {
          fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\docling-install.txt', content);
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
