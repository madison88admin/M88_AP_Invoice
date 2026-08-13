const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const cmds = [
  'cd /opt/ap-invoice && git pull origin main 2>&1 | tail -10',
  'echo "=== Building API ==="',
  'cd /opt/ap-invoice && pnpm build --filter @ap-invoice/api 2>&1 | tail -10',
  'echo "=== Restart API ==="',
  'systemctl restart ap-invoice-api 2>&1',
  'sleep 3',
  'echo "=== Health check ==="',
  'curl -s http://localhost:3001/api/health 2>&1',
  'echo ""',
  'echo DEPLOY_DONE',
];

let i = 0;
const runNext = () => {
  if (i >= cmds.length) { console.log('ALL DONE'); conn.end(); return; }
  const cmd = cmds[i++];
  console.log(`> ${cmd}`);
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error('Err:', err); runNext(); return; }
    let out = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => out += d);
    stream.on('close', () => { console.log(out.trim()); runNext(); });
  });
};

conn.on('ready', () => {
  console.log('SSH connected. Pulling, building, restarting...');
  runNext();
});

conn.on('error', (err) => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
