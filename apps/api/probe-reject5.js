/* Read-only probe #5: T-26909533 detailed state after accounting reject. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const inv = await prisma.invoice.findFirst({
    where: { invoice_number: 'T-26909533' },
    include: { signatures: { orderBy: { created_at: 'asc' } }, audit_logs: { orderBy: { created_at: 'asc' }, take: 25 } },
  });
  if (!inv) { console.log('not found'); return; }
  console.log(`INVOICE ${inv.invoice_number} (${inv.id}) status=${inv.status} current_approver_role=${inv.current_approver_role} revision=${inv.revision}`);
  console.log('SIGNATURES:');
  for (const s of inv.signatures) {
    console.log(`  role=${s.signatory_role} signed=${s.signed_at ? s.signed_at.toISOString() : 'no'} invalidated=${s.invalidated_at ? s.invalidated_at.toISOString() : 'no'} status=${s.approval_status} rev=${s.invoice_revision}`);
  }
  console.log('\nAUDIT:');
  for (const a of inv.audit_logs) {
    console.log(`  [${a.created_at.toISOString()}] ${a.action}: ${(a.note || '').slice(0, 130)}`);
  }
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
