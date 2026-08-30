/**
 * fix-null-beneficiary.ts
 *
 * Auto-populate beneficiary_name from vendor name when null.
 * OCR garbage entries (containing \n, "Invoice", "Statement", etc.) are skipped.
 * This runs on the production server via SSH or directly against the DB.
 */
import prisma from '../config/database';

/** Names that are clearly OCR garbage and should not be used as beneficiary_name */
const OCR_GARBAGE_PATTERNS = [
  /\n/i,                         // newlines
  /memorandum/i,
  /proforma\s+invoice/i,
  /statement/i,
  /pls\s+consolidate/i,
  /invoice\s+brand\s+id/i,
  /unknown\s+vendor/i,
  /no\s+data/i,
  /sample/i,
];

function isOcrGarbage(name: string): boolean {
  return OCR_GARBAGE_PATTERNS.some(pattern => pattern.test(name));
}

async function main() {
  const nullVendors = await prisma.vendor.findMany({
    where: { beneficiary_name: null },
    select: { id: true, name: true },
  });

  console.log(`Found ${nullVendors.length} vendors with null beneficiary_name`);

  let fixed = 0;
  let skipped = 0;

  for (const vendor of nullVendors) {
    if (isOcrGarbage(vendor.name)) {
      console.log(`  SKIP (OCR garbage): "${vendor.name}"`);
      skipped++;
      continue;
    }

    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { beneficiary_name: vendor.name },
    });
    console.log(`  FIXED: "${vendor.name}" → beneficiary_name = "${vendor.name}"`);
    fixed++;
  }

  console.log(`\nDone: ${fixed} fixed, ${skipped} skipped (OCR garbage)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
