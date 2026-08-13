const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');
const jwt = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\jsonwebtoken@9.0.2\\node_modules\\jsonwebtoken');

const conn = new Client();

// 1. Get the JWT_SECRET from the VPS .env
const getSecretCmd = 'grep "^JWT_SECRET" /opt/ap-invoice/apps/api/.env | head -1';

conn.on('ready', () => {
  conn.exec(getSecretCmd, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let out = '';
    stream.on('close', () => {
      const line = out.trim();
      const secret = line.replace(/^JWT_SECRET\s*=\s*["']?/, '').replace(/["']?\s*$/, '');
      console.log('secret length:', secret.length);
      // 2. Mint an ACCOUNTING_ASSOCIATE token
      const token = jwt.sign(
        { id: 'test-accounting-associate', email: 'qa-accounting@madison88.com', name: 'QA Accounting', role: 'ACCOUNTING_ASSOCIATE' },
        secret,
        { expiresIn: '1h' }
      );
      console.log('TOKEN_READY len=', token.length);
      // 3. Query for a PENDING_ACCOUNTING invoice to test against (with signatures)
      const findCmd = `cd /opt/ap-invoice/apps/api && cat > /tmp/find-inv.js <<'EOF'
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findFirst({
    where: { status: 'PENDING_ACCOUNTING' },
    include: { signatures: { orderBy: { created_at: 'asc' } } },
    orderBy: { updated_at: 'desc' },
  });
  console.log(JSON.stringify({
    id: inv.id, number: inv.invoice_number, status: inv.status,
    sigs: inv.signatures.map(s => ({ role: s.signatory_role, signed: !!s.signed_at, invalidated: !!s.invalidated_at })),
  }));
  await p.$disconnect();
})();
EOF
node /tmp/find-inv.js`;
      conn.exec(findCmd, (err2, stream2) => {
        if (err2) { console.error('Exec2 error:', err2); conn.end(); return; }
        let out2 = '';
        stream2.on('close', () => {
          let info;
          try { info = JSON.parse(out2.trim().split('\n').pop()); } catch { console.error('parse fail:', out2); conn.end(); return; }
          console.log('target invoice:', JSON.stringify(info));
          // 4. Call the reject endpoint on it
          const rejectCmd = `curl -s -m 20 -X POST "http://localhost:3001/api/invoices/${info.id}/reject" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"reason":"QA test of accounting reject path"}'`;
          conn.exec(rejectCmd, (err3, stream3) => {
            if (err3) { console.error('Exec3 error:', err3); conn.end(); return; }
            let out3 = '';
            stream3.on('close', () => { console.log('REJECT RESPONSE:', out3.trim().slice(0, 1000)); conn.end(); });
            stream3.on('data', (d) => { out3 += d.toString(); });
            stream3.stderr.on('data', (d) => { out3 += d.toString(); });
          });
        });
        stream2.on('data', (d) => { out2 += d.toString(); });
        stream2.stderr.on('data', (d) => { out2 += d.toString(); });
      });
    });
    stream.on('data', (d) => { out += d.toString(); });
    stream.stderr.on('data', (d) => { out += d.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); process.exit(1); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
