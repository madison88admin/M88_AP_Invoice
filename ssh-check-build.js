const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const commands = [
  'cd /opt/ap-invoice && pnpm build --filter @ap-invoice/api 2>&1 | head -60',
];

const cmdStr = commands.join(' && ');

conn.on('ready', () => {
  console.log('SSH connected, checking build error...');
  conn.exec(cmdStr, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let output = '';
    stream.on('close', () => {
      console.log(output);
      conn.end();
    });
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { output += data.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
