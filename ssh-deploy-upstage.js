const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

const filesToUpload = [
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\upstageOCRService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/upstageOCRService.ts',
  },
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\ocrService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/ocrService.ts',
  },
];

const commands = [
  // Add UPSTAGE_API_KEY to .env if not already present
  'grep -q UPSTAGE_API_KEY /opt/ap-invoice/apps/api/.env && echo "UPSTAGE_API_KEY already in .env" || echo "UPSTAGE_API_KEY=up_Hk6EryhvPvdomcYPxcVyq2vOpn5Ya" >> /opt/ap-invoice/apps/api/.env',
  'grep -q UPSTAGE_BASE_URL /opt/ap-invoice/apps/api/.env && echo "UPSTAGE_BASE_URL already in .env" || echo "UPSTAGE_BASE_URL=https://api.upstage.ai/v1" >> /opt/ap-invoice/apps/api/.env',
  'echo "=== .env Upstage vars ==="',
  'grep UPSTAGE /opt/ap-invoice/apps/api/.env',
  // Build API
  'echo "=== Building API ==="',
  'cd /opt/ap-invoice && pnpm build --filter @ap-invoice/api 2>&1 | tail -20',
  // Restart API
  'echo "=== Restart API ==="',
  'systemctl restart ap-invoice-api 2>&1',
  'sleep 3',
  'curl -s http://localhost:3001/api/health 2>&1',
  'echo ""',
  'echo DEPLOY_DONE',
];

conn.on('ready', () => {
  console.log('SSH connected, uploading Upstage files...');
  
  let uploaded = 0;
  const uploadNext = () => {
    if (uploaded >= filesToUpload.length) {
      console.log('All files uploaded, running commands...');
      runCommands();
      return;
    }
    
    const f = filesToUpload[uploaded];
    console.log(`Uploading ${f.local} → ${f.remote}`);
    conn.sftp((err, sftp) => {
      if (err) { console.error('SFTP error:', err); conn.end(); return; }
      const readStream = fs.createReadStream(f.local);
      const writeStream = sftp.createWriteStream(f.remote);
      writeStream.on('close', () => { 
        console.log(`  ✅ Uploaded ${f.remote}`); 
        uploaded++; uploadNext(); 
      });
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
