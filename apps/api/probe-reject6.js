/* Read-only probe #6: invoices with ACCOUNTING_REVIEWER signatures and their reject path. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sigs = await prisma.signature.findMany({
    where: { signatory_role: 'ACCOUNTING_REVIEWER' },
    include: { invoice: true },
    orderBy: { created_at: 'desc' },
    take: 30,
  });
  console.log(`ACCOUNTING_REVIEWER signatures: ${sigs.length} (top 30)`);
  for (const s of sigs) {
    console.log(`  inv=${s.invoice?.invoice_number} status=${s.invoice?.status} sig: signed=${s.signed_at ? 'YES' : 'no'} invalidated=${s.invalidated_at ? 'YES' : 'no'} status=${s.approval_status} rev=${s.invoice_revision} created=${s.created_at.toISOString().slice(0, 16)}`);
  }
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
