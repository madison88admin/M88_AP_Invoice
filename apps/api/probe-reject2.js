/* Read-only probe #2: direct signature rows + how invoices reached PENDING_ACCOUNTING. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const inv = await prisma.invoice.findFirst({
    where: { status: 'PENDING_ACCOUNTING' },
    include: { signatures: true, audit_logs: { orderBy: { created_at: 'asc' }, take: 15 } },
  });
  if (!inv) { console.log('none found'); return; }
  console.log(`INVOICE ${inv.invoice_number} (${inv.id})`);
  console.log(`status=${inv.status} revision=${inv.revision} created=${inv.created_at.toISOString()} updated=${inv.updated_at.toISOString()}`);
  console.log(`signatures rows: ${inv.signatures.length}`);
  console.log('\nAUDIT LOG (first 15):');
  for (const a of inv.audit_logs) {
    console.log(`  [${a.created_at.toISOString()}] ${a.action}: ${(a.note || '').slice(0, 140)}`);
  }
  console.log('\nSIGNATURES:');
  for (const s of inv.signatures) {
    console.log(`  role=${s.signatory_role} signed=${s.signed_at ? 'YES' : 'no'} invalidated=${s.invalidated_at ? 'YES' : 'no'} status=${s.approval_status} rev=${s.invoice_revision} ocr=${s.ocr_detected ? 'Y' : 'n'}`);
  }

  console.log('\n\n--- counts ---');
  const total = await prisma.invoice.count();
  const byStatus = await prisma.invoice.groupBy({ by: ['status'], _count: true });
  console.log('total invoices:', total);
  for (const r of byStatus) console.log(`  ${r.status}: ${r._count}`);

  // Any signatures at all in the DB?
  const sigCount = await prisma.signature.count();
  console.log('\ntotal signature rows in DB:', sigCount);
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
