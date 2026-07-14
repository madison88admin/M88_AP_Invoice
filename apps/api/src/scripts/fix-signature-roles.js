require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Fix roles based on known names
  const fixes = [
    { name: 'Maricar Tanaleon', role: 'PURCHASING_MANAGER' },
    { name: 'Mary Ann Del Monte', role: 'PURCHASING_MANAGER' },
    { name: 'Mary Del Monte', role: 'PURCHASING_MANAGER' },
  ];

  for (const fix of fixes) {
    const result = await prisma.signature.updateMany({
      where: {
        signatory_name: { contains: fix.name, mode: 'insensitive' },
        ocr_detected: true,
        signatory_role: 'COORDINATOR',
      },
      data: { signatory_role: fix.role },
    });
    if (result.count > 0) {
      console.log(`Fixed ${result.count} signature(s): ${fix.name} → ${fix.role}`);
    }
  }

  // Show all OCR-detected signatures
  const sigs = await prisma.signature.findMany({
    where: { ocr_detected: true },
    include: { invoice: { select: { invoice_number: true, status: true } } },
  });
  console.log(`\nTotal OCR-detected signatures: ${sigs.length}`);
  for (const sig of sigs) {
    console.log(`  ${sig.invoice.invoice_number} (${sig.invoice.status}): ${sig.signatory_name} - ${sig.signatory_role} - signed: ${sig.signed_at ? 'YES' : 'NO'}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
