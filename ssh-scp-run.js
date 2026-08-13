const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');

const conn = new Client();
const localFile = 'c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\vps-ocr-test.js';
const remoteFile = '/tmp/vps-ocr-test.js';

conn.on('ready', () => {
  console.log('SSH connected, uploading test script...');
  
  // Upload the test script
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    
    const readStream = fs.createReadStream(localFile);
    const writeStream = sftp.createWriteStream(remoteFile);
    
    writeStream.on('close', () => {
      console.log('Upload complete, running OCR test...');
      
      // Run the test script
      conn.exec('cd /opt/ap-invoice && node /tmp/vps-ocr-test.js 2>&1', (err2, stream) => {
        if (err2) { console.error('Exec error:', err2); conn.end(); return; }
        let output = '';
        stream.on('close', () => {
          fs.writeFileSync('c:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\ocr-direct-result.txt', output);
          console.log(output);
          conn.end();
        });
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', (data) => { output += data.toString(); });
      });
    });
    
    writeStream.on('error', (e) => { console.error('Write error:', e); conn.end(); });
    readStream.pipe(writeStream);
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
