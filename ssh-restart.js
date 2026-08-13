const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const commands = [
  'cd /opt/ap-invoice',
  'git stash 2>&1 || echo "stash failed, continuing"',
  'rm -f apps/api/src/services/invoiceUploadQueue.ts 2>/dev/null',
  'git pull origin main 2>&1',
  'pnpm build --filter @ap-invoice/api 2>&1',
  '(systemctl restart ap-invoice-api 2>/dev/null || pm2 restart ap-invoice-api 2>/dev/null || pm2 restart all 2>/dev/null) 2>&1',
  'sleep 3',
  'curl -s http://localhost:3001/api/health 2>&1 || echo "API not responding"',
  'echo DONE',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, running commands...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) {
      console.error('Exec error:', err);
      conn.end();
      return;
    }
    let output = '';
    stream.on('close', (code) => {
      console.log('Exit code:', code);
      console.log(output);
      conn.end();
    });
    stream.on('data', (data) => {
      output += data.toString();
    });
    stream.stderr.on('data', (data) => {
      output += data.toString();
    });
  });
});

conn.on('error', (err) => {
  console.error('SSH error:', err.message);
});

conn.connect({
  host: '5.223.78.194',
  port: 22,
  username: 'root',
  password: 'M@dis0n_88_server*',
  readyTimeout: 15000,
});
