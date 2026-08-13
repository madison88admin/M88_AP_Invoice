const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const fs = require('fs');
const path = require('path');

const script = `
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Get stuck invoices with NO exceptions
  const stuck = await p.invoice.findMany({
    where: { status: 'VALIDATION_PENDING' },
    select: { id: true, invoice_number: true, mpo_number: true, vendor_name_raw: true },
    orderBy: { created_at: 'desc' }
  });
  
  console.log('Checking ' + stuck.length + ' invoices...');
  let moved = 0;
  
  for (const inv of stuck) {
    const exceptions = await p.exception.findMany({
      where: { invoice_id: inv.id, resolved_at: null },
      select: { id: true }
    });
    
    if (exceptions.length === 0) {
      // No unresolved exceptions - move to PENDING_COORDINATOR
      await p.invoice.update({
        where: { id: inv.id },
        data: { status: 'PENDING_COORDINATOR' }
      });
      console.log('MOVED: ' + inv.invoice_number + ' -> PENDING_COORDINATOR');
      moved++;
    } else {
      // Has exceptions - move to EXCEPTION_FLAGGED
      await p.invoice.update({
        where: { id: inv.id },
        data: { status: 'EXCEPTION_FLAGGED' }
      });
      console.log('MOVED: ' + inv.invoice_number + ' -> EXCEPTION_FLAGGED (' + exceptions.length + ' exceptions)');
      moved++;
    }
  }
  
  console.log('Total moved: ' + moved);
  
  // Verify
  const remaining = await p.invoice.count({ where: { status: 'VALIDATION_PENDING' } });
  console.log('Remaining VALIDATION_PENDING: ' + remaining);
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
`;

const localFile = path.join(__dirname, 'tmp-force-process.js');
fs.writeFileSync(localFile, script);

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected. Force processing stuck invoices...');
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    const ws = sftp.createWriteStream('/opt/ap-invoice/apps/api/tmp-force-process.js');
    ws.on('close', () => {
      conn.exec('cd /opt/ap-invoice/apps/api && node tmp-force-process.js 2>&1', (err, stream) => {
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
