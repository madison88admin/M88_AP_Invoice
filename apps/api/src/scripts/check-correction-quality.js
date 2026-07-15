const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.correctionLog.count();
  console.log('Total corrections:', total);

  const withRawText = await prisma.correctionLog.count({
    where: { raw_text: { not: null } }
  });
  const withNonEmptyRawText = await prisma.correctionLog.count({
    where: { 
      AND: [
        { raw_text: { not: null } },
        { raw_text: { not: '' } }
      ]
    }
  });
  console.log('With raw_text (non-null):', withRawText);
  console.log('With non-empty raw_text:', withNonEmptyRawText);

  const byVendor = await prisma.correctionLog.groupBy({
    by: ['vendor_name'],
    _count: true,
    orderBy: { _count: { vendor_name: 'desc' } },
  });
  console.log('\nBy vendor:', JSON.stringify(byVendor, null, 2));

  // Check a sample with raw_text
  const sample = await prisma.correctionLog.findFirst({
    where: { raw_text: { not: null } },
    select: { 
      vendor_name: true, 
      raw_text: true, 
      original_fields: true, 
      corrected_fields: true 
    }
  });
  if (sample) {
    console.log('\nSample correction:');
    console.log('Vendor:', sample.vendor_name);
    console.log('Raw text length:', sample.raw_text?.length || 0);
    console.log('Raw text preview:', sample.raw_text?.substring(0, 200));
    console.log('Original fields:', JSON.stringify(sample.original_fields).substring(0, 300));
    console.log('Corrected fields:', JSON.stringify(sample.corrected_fields).substring(0, 300));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
