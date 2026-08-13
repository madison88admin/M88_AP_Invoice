const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== 1. BACKUP working tree ==="',
  'cd /opt/ap-invoice && TS=$(date +%Y%m%d-%H%M%S) && mkdir -p /root/ap-deploy-backup-$TS && git diff > /root/ap-deploy-backup-$TS/working-tree.patch 2>/dev/null; cp apps/web/src/components/Dashboard.tsx /root/ap-deploy-backup-$TS/Dashboard.tsx.hotfix 2>/dev/null; echo "backup dir: /root/ap-deploy-backup-$TS"; ls -la /root/ap-deploy-backup-$TS/',
  'echo "=== 2. VPS local commits (9b887a6..HEAD) ==="',
  'cd /opt/ap-invoice && git log --oneline 9b887a6..HEAD 2>/dev/null',
  'echo "=== 3. files touched by VPS local commits ==="',
  'cd /opt/ap-invoice && git diff --stat 9b887a6..HEAD 2>/dev/null | tail -15',
  'echo "=== 4. fetch origin ==="',
  'cd /opt/ap-invoice && git fetch origin 2>&1 | tail -2; git log --oneline origin/main -2 2>/dev/null',
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
