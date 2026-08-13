const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();

// Upload files and deploy
const filesToUpload = [
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\ocr-service\\main.py',
    remote: '/opt/ap-invoice/apps/ocr-service/main.py',
  },
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\ocr-service\\requirements.txt',
    remote: '/opt/ap-invoice/apps/ocr-service/requirements.txt',
  },
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\rapidOCRService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/rapidOCRService.ts',
  },
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\ocrService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/ocrService.ts',
  },
  {
    local: 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\apps\\api\\src\\services\\groqOCRService.ts',
    remote: '/opt/ap-invoice/apps/api/src/services/groqOCRService.ts',
  },
];

// systemd service file for RapidOCR
const systemdService = `[Unit]
Description=RapidOCR Python Microservice
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ap-invoice/apps/ocr-service
ExecStart=/usr/bin/python3 /opt/ap-invoice/apps/ocr-service/main.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target`;

const commands = [
  // Create ocr-service directory
  'mkdir -p /opt/ap-invoice/apps/ocr-service',
  // Install FastAPI + uvicorn (RapidOCR already installed)
  'pip3 install --break-system-packages fastapi uvicorn python-multipart 2>&1 | tail -3',
  // Create systemd service for RapidOCR
  'echo "' + systemdService.replace(/"/g, '\\"').replace(/\n/g, '\\n') + '" > /etc/systemd/system/rapidocr.service',
  'systemctl daemon-reload',
  'systemctl enable rapidocr',
  'systemctl restart rapidocr',
  'sleep 3',
  // Check RapidOCR health
  'curl -s http://localhost:8500/health 2>&1',
  // Build API
  'cd /opt/ap-invoice && pnpm build --filter @ap-invoice/api 2>&1 | tail -5',
  // Restart API
  'systemctl restart ap-invoice-api 2>&1',
  'sleep 3',
  'curl -s http://localhost:3001/api/health 2>&1',
  'echo DEPLOY_DONE',
];

conn.on('ready', () => {
  console.log('SSH connected, creating directories...');
  
  // First create remote directories
  conn.exec('mkdir -p /opt/ap-invoice/apps/ocr-service /opt/ap-invoice/apps/api/src/services', (err, stream) => {
    if (err) { console.error('Mkdir error:', err); conn.end(); return; }
    stream.on('close', () => {
      console.log('Directories created, uploading files...');
      uploadFiles();
    });
    stream.on('data', () => {});
    stream.stderr.on('data', () => {});
  });
});

function uploadFiles() {
  let uploaded = 0;
  const uploadNext = () => {
    if (uploaded >= filesToUpload.length) {
      console.log('All files uploaded, running deployment commands...');
      runCommands();
      return;
    }
    
    const f = filesToUpload[uploaded];
    console.log(`Uploading ${f.local} → ${f.remote}...`);
    
    conn.sftp((err, sftp) => {
      if (err) { console.error('SFTP error:', err); conn.end(); return; }
      
      // Ensure remote directory exists
      const remoteDir = f.remote.substring(0, f.remote.lastIndexOf('/'));
      
      const readStream = fs.createReadStream(f.local);
      const writeStream = sftp.createWriteStream(f.remote);
      
      writeStream.on('close', () => {
        uploaded++;
        uploadNext();
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
        fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\deploy-result.txt', output);
        console.log(output);
        conn.end();
      });
      stream.on('data', (data) => { output += data.toString(); });
      stream.stderr.on('data', (data) => { output += data.toString(); });
    });
  };
  
  uploadNext();
}

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
