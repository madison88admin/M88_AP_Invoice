/* Read-only probe #3: audit trail of no-signature PENDING_ACCOUNTING invoices. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const invs = await prisma.invoice.findMany({
    where: { status: 'PENDING_ACCOUNTING' },
    orderBy: { updated_at: 'desc' },
    take: 3,
    include: { signatures: true, audit_logs: { orderBy: { created_at: 'asc' }, take: 20 } },
  });

  for (const inv of invs) {
    console.log('='.repeat(70));
    console.log(`# ${inv.invoice_number} (${inv.id})`);
    console.log(`  status=${inv.status} sigs=${inv.signatures.length} updated=${inv.updated_at.toISOString()}`);
    for (const a of inv.audit_logs) {
      console.log(`  [${a.created_at.toISOString()}] ${a.action}: ${(a.note || '').slice(0, 110)}`);
    }
    // active stage timestamp?
    const stage = await prisma.stageTimestamp.findFirst({
      where: { invoice_id: inv.id, exited_at: null },
      orderBy: { entered_at: 'desc' },
    });
    console.log(`  ACTIVE STAGE: ${stage ? `${stage.stage} entered=${stage.entered_at.toISOString()}` : 'NONE'}`);
  }
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
