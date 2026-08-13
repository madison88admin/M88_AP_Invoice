const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== A. systemd unit ==="',
  'cat /etc/systemd/system/ap-invoice-api.service',
  'echo "=== B. one full SyntaxError crash (with context) ==="',
  'journalctl --since "2026-08-13 06:05:40" --until "2026-08-13 06:05:55" --no-pager 2>/dev/null | head -40',
  'echo "=== C. service restart history ==="',
  'journalctl -u ap-invoice-api.service --no-pager 2>/dev/null | grep -E "Started|Stopped|Failed|Main process" | tail -15',
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
