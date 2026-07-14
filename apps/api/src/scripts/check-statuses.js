require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.invoice.groupBy({
    by: ['status'],
    _count: true,
    orderBy: { _count: { status: 'desc' } },
  });
  console.log('Invoice status counts:');
  console.log(JSON.stringify(result, null, 2));

  // Also check signatures with ocr_detected
  const ocrSigs = await prisma.signature.findMany({
    where: { ocr_detected: true },
    include: { invoice: { select: { invoice_number: true, status: true } } },
  });
  console.log('\nOCR-detected signatures:', ocrSigs.length);
  for (const sig of ocrSigs) {
    console.log(`  ${sig.invoice.invoice_number} (${sig.invoice.status}): ${sig.signatory_name} - ${sig.signatory_role} - signed: ${sig.signed_at ? 'YES' : 'NO'}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
