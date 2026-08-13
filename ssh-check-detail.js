const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');
const path = require('path');

const script = `
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const stuck = await p.invoice.findMany({
    where: { status: 'VALIDATION_PENDING' },
    select: { id: true, invoice_number: true, mpo_number: true, vendor_name_raw: true, total_amount: true, invoice_date: true, currency: true },
    orderBy: { created_at: 'desc' }
  });
  
  for (const inv of stuck) {
    const exceptions = await p.exception.findMany({
      where: { invoice_id: inv.id },
      select: { type: true, message: true, resolved_at: true }
    });
    console.log(inv.invoice_number + ' | MPO: ' + (inv.mpo_number || 'NONE') + ' | Amount: ' + inv.total_amount + ' | Exceptions: ' + exceptions.length);
    exceptions.forEach(e => console.log('  -> ' + e.type + ': ' + (e.message || '').substring(0, 80)));
  }
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
`;

const localFile = path.join(__dirname, 'tmp-check-detail.js');
fs.writeFileSync(localFile, script);

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    const ws = sftp.createWriteStream('/opt/ap-invoice/apps/api/tmp-check-detail.js');
    ws.on('close', () => {
      conn.exec('cd /opt/ap-invoice/apps/api && node tmp-check-detail.js 2>&1', (err, stream) => {
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
