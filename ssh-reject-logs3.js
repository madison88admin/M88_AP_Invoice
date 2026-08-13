const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'echo "=== A. all errors 06:05-06:30 UTC today ==="',
  'journalctl --since "2026-08-13 06:05:00" --until "2026-08-13 06:30:00" --no-pager 2>/dev/null | grep -iE "error|statusCode|reject|approval|No pending|400|403|500" | grep -viE "OCR|Groq|Gemini|Ollama|NextGen|Upstage|SMTP" | head -60',
  'echo "=== B. SSE connections (who was online) ==="',
  'journalctl --since "2026-08-13 06:05:00" --until "2026-08-13 06:30:00" --no-pager 2>/dev/null | grep -iE "SSE.*Client (connected|disconnected)" | head -20',
  'echo "=== C. full journal window 06:10-06:20 (info level, non-OCR) ==="',
  'journalctl --since "2026-08-13 06:10:00" --until "2026-08-13 06:20:00" --no-pager 2>/dev/null | grep -viE "OCR|Groq|Gemini|Ollama|NextGen|Upstage|quota|rate_limit" | head -60',
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
