const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== 1. API service ==="',
  'systemctl list-units --type=service --no-pager 2>/dev/null | grep -iE "ap-invoice|invoice|api" | head -5',
  'systemctl status ap-invoice-api --no-pager 2>/dev/null | head -8 || systemctl status ap-invoice --no-pager 2>/dev/null | head -8',
  'echo "=== 2. log files ==="',
  'ls -la /opt/ap-invoice/apps/api/*.log /tmp/*.log 2>/dev/null | head -8',
  'echo "=== 3. journal recent reject/error (24h) ==="',
  'journalctl --since "24 hours ago" --no-pager 2>/dev/null | grep -iE "reject|No pending approval|approval authority|Insufficient permissions|PENDING_ACCOUNTING" | grep -viE "SLA|sla" | tail -40',
  'echo "=== 4. journal 500/TypeError (24h) ==="',
  'journalctl --since "24 hours ago" --no-pager 2>/dev/null | grep -iE "TypeError|500|Internal Server" | grep -viE "SMTP|sla|SLA|Gemini|Groq|ollama" | tail -30',
  'echo "=== 5. api log tail ==="',
  'tail -60 /opt/ap-invoice/apps/api/api_server.log 2>/dev/null | grep -iE "reject|error|500" | tail -20 || echo NO_API_LOG',
  'tail -60 /tmp/api-prod.log 2>/dev/null | grep -iE "reject|error|500" | tail -20 || echo NO_TMP_LOG',
];

const cmdStr = commands.join(' &&\n');

conn.on('ready', () => {
  console.log('SSH connected\n');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let output = '';
    stream.on('close', () => { console.log(output); conn.end(); });
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); process.exit(1); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
