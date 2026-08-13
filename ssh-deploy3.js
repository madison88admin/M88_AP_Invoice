const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const filesToUpload = [
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\rapidOCRService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/rapidOCRService.ts',
  },
];

const commands = [
  'cd /opt/ap-invoice && pnpm build --filter @ap-invoice/api 2>&1 | tail -15',
  'echo "=== Restart API ==="',
  'systemctl restart ap-invoice-api 2>&1',
  'sleep 3',
  'curl -s http://localhost:3001/api/health 2>&1',
  'echo ""',
  'echo "=== RapidOCR Health ==="',
  'curl -s http://localhost:8500/health 2>&1',
  'echo ""',
  'echo DEPLOY_DONE',
];

conn.on('ready', () => {
  console.log('SSH connected, uploading fixed rapidOCRService.ts...');
  
  let uploaded = 0;
  const uploadNext = () => {
    if (uploaded >= filesToUpload.length) {
      console.log('File uploaded, building...');
      runCommands();
      return;
    }
    
    const f = filesToUpload[uploaded];
    conn.sftp((err, sftp) => {
      if (err) { console.error('SFTP error:', err); conn.end(); return; }
      const readStream = fs.createReadStream(f.local);
      const writeStream = sftp.createWriteStream(f.remote);
      writeStream.on('close', () => { uploaded++; uploadNext(); });
      writeStream.on('error', (e) => { console.error('Write error:', e); conn.end(); });
      readStream.pipe(writeStream);
    });
  };
  
  const runCommands = () => {
    const cmdStr = commands.join(' && ');
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
  };
  
  uploadNext();
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
