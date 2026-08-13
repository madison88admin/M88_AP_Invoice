const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();
const TARGET_ID = process.argv[2] || '';
const TARGET_NUM = process.argv[3] || '';

// The script is written to /tmp on the VPS via heredoc, then executed.
const setupCmd = `cat > /tmp/qa-reject.sh <<'SCRIPT'
#!/bin/bash
set -e
cd /opt/ap-invoice/apps/api
export $(grep "^JWT_SECRET" .env | head -1)
node -e '
const jwt = require("jsonwebtoken");
const fs = require("fs");
const token = jwt.sign(
  { id: "qa-accounting-associate", email: "qa-accounting@madison88.com", name: "QA Accounting", role: "ACCOUNTING_ASSOCIATE" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);
fs.writeFileSync("/tmp/qa-token.txt", token);
'
echo "== REJECT ${TARGET_NUM} (${TARGET_ID}) =="
curl -s -m 25 -w "\\nHTTP:%{http_code}\\n" \\
  -X POST "http://localhost:3001/api/invoices/${TARGET_ID}/reject" \\
  -H "Authorization: Bearer $(cat /tmp/qa-token.txt)" \\
  -H "Content-Type: application/json" \\
  -d '{"reason":"QA test: accounting reject path check"}'
echo
echo "== invoice state after =="
node -e '
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findUnique({
    where: { id: process.argv[2] },
    include: { signatures: true },
  });
  if (!inv) { console.log("NOT FOUND"); await p.$disconnect(); return; }
  console.log(JSON.stringify({
    number: inv.invoice_number,
    status: inv.status,
    current_approver_role: inv.current_approver_role,
    sigs: inv.signatures.map(s => ({ role: s.signatory_role, signed: !!s.signed_at, invalidated: !!s.invalidated_at, status: s.approval_status })),
  }));
  await p.$disconnect();
})();
' "${TARGET_ID}"
SCRIPT
chmod +x /tmp/qa-reject.sh && bash /tmp/qa-reject.sh`;

conn.on('ready', () => {
  conn.exec(setupCmd, (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return; }
    let out = '';
    stream.on('close', () => { console.log(out.trim()); conn.end(); });
    stream.on('data', (d) => { out += d.toString(); });
    stream.stderr.on('data', (d) => { out += d.toString(); });
  });
});

conn.on('error', (err) => { console.error('SSH error:', err.message); process.exit(1); });
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
