const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find corrections with invoice_id but no raw_text
  const corrections = await prisma.correctionLog.findMany({
    where: {
      AND: [
        { invoice_id: { not: null } },
        { OR: [{ raw_text: null }, { raw_text: '' }] }
      ]
    }
  });

  console.log(`Found ${corrections.length} corrections to backfill`);

  let updated = 0;
  for (const c of corrections) {
    if (!c.invoice_id) continue;
    const invoice = await prisma.invoice.findUnique({
      where: { id: c.invoice_id },
      select: { ocr_raw_data: true, vendor_name_raw: true }
    });
    if (invoice && invoice.ocr_raw_data) {
      const rawText = JSON.stringify(invoice.ocr_raw_data);
      await prisma.correctionLog.update({
        where: { id: c.id },
        data: { raw_text: rawText }
      });
      updated++;
      console.log(`Backfilled correction ${c.id} for vendor ${invoice.vendor_name_raw} (${rawText.length} chars)`);
    }
  }

  console.log(`\nBackfilled ${updated} out of ${corrections.length} corrections`);

  // Verify
  const withText = await prisma.correctionLog.count({
    where: { raw_text: { not: null } }
  });
  const total = await prisma.correctionLog.count();
  console.log(`Corrections with raw_text: ${withText}/${total}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
