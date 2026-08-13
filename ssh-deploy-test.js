const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const filesToUpload = [
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\ocrService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/ocrService.ts',
  },
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\vps-ocr-test.js',
    remote: '/tmp/vps-ocr-test.js',
  },
];

const commands = [
  'cd /opt/ap-invoice && pnpm build --filter @ap-invoice/api 2>&1 | tail -5',
  'echo "=== Build done, running test ==="',
  'node /tmp/vps-ocr-test.js 2>&1',
  'echo TEST_DONE',
];

conn.on('ready', () => {
  console.log('SSH connected, uploading files...');
  
  let uploaded = 0;
  const uploadNext = () => {
    if (uploaded >= filesToUpload.length) {
      console.log('All uploaded, building and testing...');
      runCommands();
      return;
    }
    
    const f = filesToUpload[uploaded];
    console.log(`Uploading ${f.local}...`);
    
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
