const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'cd /opt/ap-invoice && echo "=== API src files differing between VPS working tree and origin/main ==="',
  'for f in $(git diff --name-only origin/main -- apps/api/src 2>/dev/null); do echo "$f"; done | head -30',
  'echo "=== detailed diff of API src (word-level, count of VPS-only additions) ==="',
  'git diff origin/main -- apps/api/src 2>/dev/null | grep -E "^\\+" | grep -v "^\\+\\+\\+" | wc -l',
  'echo "=== key files: approvalService diff (VPS vs origin/main) ==="',
  'git diff origin/main -- apps/api/src/services/approvalService.ts 2>/dev/null | head -40',
  'echo "=== nextGenService diff ==="',
  'git diff origin/main -- apps/api/src/services/nextGenService.ts 2>/dev/null | grep -E "^[+-]" | grep -v "^[+-][+-]" | head -20',
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
