const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const vendors = await prisma.vendor.findMany({
    select: { name: true, bank_name: true, swift_code: true, account_number: true, is_active: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: 30,
  });
  
  console.log('Total vendors:', vendors.length);
  console.log('---');
  for (const v of vendors) {
    console.log(`${v.name} | bank: ${v.bank_name || 'none'} | swift: ${v.swift_code || 'none'} | acct: ${v.account_number || 'none'} | active: ${v.is_active}`);
  }
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
