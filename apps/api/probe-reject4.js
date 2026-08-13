/* Read-only probe #4: which bulk-uploaded invoices got rejected, and current PENDING_COORDINATOR stranded state. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Recent REJECTED audit entries (last 48h)
  console.log('=== REJECTED audit entries (48h) ===');
  const rejects = await prisma.auditLog.findMany({
    where: { action: 'REJECTED', created_at: { gte: new Date(Date.now() - 48 * 3600 * 1000) } },
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  for (const r of rejects) {
    const inv = await prisma.invoice.findUnique({ where: { id: r.invoice_id } });
    console.log(`  [${r.created_at.toISOString()}] ${inv ? inv.invoice_number : r.invoice_id} status=${inv?.status} sigs=${inv ? (await prisma.signature.count({ where: { invoice_id: inv.id } })) : '?'} | ${(r.note || '').slice(0, 120)}`);
  }

  // 2. PENDING_COORDINATOR invoices with 0 signatures (stranded)
  console.log('\n=== PENDING_COORDINATOR invoices with 0 signatures ===');
  const stranded = await prisma.invoice.findMany({
    where: { status: 'PENDING_COORDINATOR' },
    include: { _count: { select: { signatures: true } } },
    orderBy: { updated_at: 'desc' },
  });
  for (const inv of stranded.filter((i) => i._count.signatures === 0)) {
    console.log(`  ${inv.invoice_number} (${inv.id}) updated=${inv.updated_at.toISOString()}`);
  }

  // 3. Any invoices in PENDING_MANAGER or others stranded?
  console.log('\n=== ALL PENDING_* invoices lacking signatures (stranded) ===');
  const allPending = await prisma.invoice.findMany({
    where: { status: { in: ['PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY'] } },
    include: { _count: { select: { signatures: true } } },
  });
  for (const inv of allPending.filter((i) => i._count.signatures === 0)) {
    console.log(`  ${inv.invoice_number} [${inv.status}] (${inv.id}) updated=${inv.updated_at.toISOString()}`);
  }
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
