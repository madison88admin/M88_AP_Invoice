const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

const TARGET_ID = process.argv[2] || '';
const TARGET_NUM = process.argv[3] || '';

const commands = [
  'grep "^JWT_SECRET" /opt/ap-invoice/apps/api/.env | head -1',
].join(' && ');

conn.on('ready', () => {
  conn.exec(commands, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let out = '';
    stream.on('close', () => {
      const secret = out.trim().replace(/^JWT_SECRET\s*=\s*["']?/, '').replace(/["']?\s*$/, '');
      // Mint token via node on the VPS (has jsonwebtoken installed)
      const mintCmd = `cd /opt/ap-invoice/apps/api && node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({ id: 'qa-accounting-associate', email: 'qa-accounting@madison88.com', name: 'QA Accounting', role: 'ACCOUNTING_ASSOCIATE' }, process.env.JWT_SECRET, { expiresIn: '1h' });
require('fs').writeFileSync('/tmp/qa-token.txt', token);
" JWT_SECRET="${secret}" 2>&1 && wc -c /tmp/qa-token.txt`;
      conn.exec(mintCmd, (err2, stream2) => {
        if (err2) { console.error('Exec2 error:', err2); conn.end(); return; }
        let out2 = '';
        stream2.on('close', () => {
          console.log('mint:', out2.trim());
          const rejectCmd = `TOKEN=$(cat /tmp/qa-token.txt); echo "== REJECT ${TARGET_NUM} (${TARGET_ID}) =="; curl -s -m 25 -w "\\nHTTP:%{http_code}\\n" -X POST "http://localhost:3001/api/invoices/${TARGET_ID}/reject" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"reason":"QA test: accounting reject path check"}'; echo; echo "== invoice state after =="; cd /opt/ap-invoice/apps/api && node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findUnique({ where: { id: process.argv[1] }, include: { signatures: true } });
  console.log(JSON.stringify({ number: inv.invoice_number, status: inv.status, current_approver_role: inv.current_approver_role, sigs: inv.signatures.map(s => ({ role: s.signatory_role, signed: !!s.signed_at, invalidated: !!s.invalidated_at, status: s.approval_status })) }));
  await p.$disconnect();
})();
" "${TARGET_ID}"`;
          conn.exec(rejectCmd, (err3, stream3) => {
            if (err3) { console.error('Exec3 error:', err3); conn.end(); return; }
            let out3 = '';
            stream3.on('close', () => { console.log(out3.trim()); conn.end(); });
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
