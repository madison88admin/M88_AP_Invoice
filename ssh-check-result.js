const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');
const path = require('path');

const script = `
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const stuck = await p.invoice.findMany({
    where: { status: { in: ['OCR_PROCESSING', 'RECEIVED', 'VALIDATION_PENDING'] } },
    select: { id: true, invoice_number: true, status: true },
    orderBy: { created_at: 'desc' }
  });
  console.log('Still stuck: ' + stuck.length);
  if (stuck.length > 0) {
    stuck.forEach(i => console.log('  ' + i.invoice_number + ' - ' + i.status));
  }
  
  const moved = await p.invoice.findMany({
    where: { status: { in: ['PENDING_COORDINATOR', 'EXCEPTION_FLAGGED'] } },
    select: { id: true, invoice_number: true, status: true },
    orderBy: { created_at: 'desc' },
    take: 20
  });
  console.log('\\nMoved to approval/exception: ' + moved.length);
  moved.forEach(i => console.log('  ' + i.invoice_number + ' - ' + i.status));
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
`;

const localFile = path.join(__dirname, 'tmp-check-result.js');
fs.writeFileSync(localFile, script);

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    const ws = sftp.createWriteStream('/opt/ap-invoice/apps/api/tmp-check-result.js');
    ws.on('close', () => {
      conn.exec('cd /opt/ap-invoice/apps/api && node tmp-check-result.js 2>&1', (err, stream) => {
        if (err) { console.error('Exec error:', err); conn.end(); return; }
        let out = '';
        stream.on('data', d => out += d);
        stream.stderr.on('data', d => out += d);
        stream.on('close', () => { console.log(out); conn.end(); });
      });
    });
    fs.createReadStream(localFile).pipe(ws);
  });
});
conn.on('error', (err) => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
