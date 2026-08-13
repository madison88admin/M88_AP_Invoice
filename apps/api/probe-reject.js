/* Read-only probe: inspect PENDING_ACCOUNTING invoices + signatures to trace the accounting reject path. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { status: 'PENDING_ACCOUNTING' },
    orderBy: { updated_at: 'desc' },
    take: 20,
    include: {
      signatures: { orderBy: { created_at: 'asc' } },
      vendor: true,
    },
  });

  console.log(`PENDING_ACCOUNTING invoices: ${invoices.length}\n`);
  for (const inv of invoices) {
    console.log('='.repeat(80));
    console.log(`# ${inv.invoice_number}  (${inv.id})`);
    console.log(`  status=${inv.status} current_approver_role=${inv.current_approver_role} revision=${inv.revision} amount=${inv.total_amount}`);
    console.log(`  updated_at=${inv.updated_at.toISOString()}`);
    if (inv.signatures.length === 0) {
      console.log('  SIGNATURES: NONE');
    }
    for (const s of inv.signatures) {
      console.log(`  sig: role=${s.signatory_role} signed=${s.signed_at ? 'YES' : 'no'} invalidated=${s.invalidated_at ? 'YES' : 'no'} status=${s.approval_status} revision=${s.invoice_revision} ocr=${s.ocr_detected ? 'YES' : 'no'}`);
    }
    // Accounting role check: would pendingSignature be found?
    const unsignedAccounting = inv.signatures.find(
      (s) => s.signatory_role === 'ACCOUNTING_REVIEWER' && !s.signed_at
    );
    console.log(`  -> unsigned ACCOUNTING_REVIEWER sig: ${unsignedAccounting ? 'YES (regular reject path)' : 'NO (rejectFromAccounting path)'}`);
  }
}

main()
  .catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
