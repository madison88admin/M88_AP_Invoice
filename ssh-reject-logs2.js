const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== A. express router 500 events with context ==="',
  'journalctl --since "36 hours ago" --no-pager 2>/dev/null | grep -B 3 -A 3 "at router (.*express" | grep -vE "Groq|Gemini|OCR|Ollama|NextGen" | tail -60',
  'echo "=== B. recent 4xx client errors (24h) ==="',
  'journalctl --since "24 hours ago" --no-pager 2>/dev/null | grep -iE "statusCode.: 4|statusCode.: 5|HTTP 400|HTTP 403|HTTP 404" | tail -30',
  'echo "=== C. reject endpoint hits (24h) ==="',
  'journalctl --since "24 hours ago" --no-pager 2>/dev/null | grep -iE "reject" | grep -viE "OCR|Groq|Gemini|Ollama|NextGen" | tail -30',
  'echo "=== D. PENDING_ACCOUNTING / approval errors (24h) ==="',
  'journalctl --since "24 hours ago" --no-pager 2>/dev/null | grep -iE "approval|No pending approval|signature|approver" | grep -viE "OCR|Groq|Gemini|Ollama|NextGen" | tail -30',
];

const cmdStr = commands.join(' &&\n');

conn.on('ready', () => {
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
