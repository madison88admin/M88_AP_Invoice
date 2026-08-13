const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== 1. web dist on VPS ==="',
  'ls -la /opt/ap-invoice/apps/web/dist/ 2>/dev/null | head -8',
  'echo "=== 2. build timestamp ==="',
  'stat -c "%y %n" /opt/ap-invoice/apps/web/dist/index.html 2>/dev/null || echo NO_INDEX',
  'echo "=== 3. does the live build have the accounting reject button? ==="',
  'grep -rl "Reject &amp; Return to Approver\\|Reject & Return to Approver\\|Reject &amp; Return" /opt/ap-invoice/apps/web/dist/assets/ 2>/dev/null | head -3 || echo "NOT FOUND in dist"',
  'echo "=== 4. nginx serving? ==="',
  'curl -s -m 5 -o /dev/null -w "web80:%{http_code}\\n" http://localhost:80/ || echo NOPE',
  'echo "=== 5. is there a netlify deploy dir? ==="',
  'ls /opt/ap-invoice/apps/web/ 2>/dev/null',
];

const cmdStr = commands.join(' &&\n');

conn.on('ready', () => {
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let out = '';
    stream.on('close', () => { console.log(out.trim()); conn.end(); });
    stream.on('data', (d) => { out += d.toString(); });
    stream.stderr.on('data', (d) => { out += d.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); process.exit(1); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
