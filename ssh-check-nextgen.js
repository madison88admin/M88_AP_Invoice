const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== A. current nextGenService.js line 1105-1125 ==="',
  'sed -n "1105,1125p" /opt/ap-invoice/apps/api/dist/services/nextGenService.js',
  'echo "=== B. source nextGenService.ts around GetById ==="',
  'grep -n "GetById" /opt/ap-invoice/apps/api/src/services/nextGenService.ts | head -3',
  'echo "=== C. dist file mtimes ==="',
  'stat -c "%y %n" /opt/ap-invoice/apps/api/dist/services/nextGenService.js /opt/ap-invoice/apps/api/dist/index.js 2>/dev/null',
  'echo "=== D. running API uptime ==="',
  'systemctl show ap-invoice-api -p ActiveEnterTimestamp -p NRestarts 2>/dev/null',
  'echo "=== E. any SyntaxError in last 2h ==="',
  'journalctl -u ap-invoice-api.service --since "2 hours ago" --no-pager 2>/dev/null | grep -c "SyntaxError"',
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
