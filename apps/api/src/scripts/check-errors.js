require('dotenv').config({ path: '/opt/ap-invoice/apps/api/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ids = [
    '9824befc-75cd-40a5-a396-693bd56ffb7d',
    'fa45224b-6f2d-474c-83f3-3cecf9f49ce7',
    '3996ab9e-7aa2-4b53-b335-45fba53fa2e9',
  ];

  for (const id of ids) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoice_number: true, status: true, invoice_type: true, total_amount: true, mpo_number: true },
    });
    console.log('\n=== Invoice ' + id + ' ===');
    console.log('Found:', invoice ? JSON.stringify(invoice) : 'NOT FOUND');

    if (invoice) {
      const sigs = await prisma.signature.findMany({
        where: { invoice_id: id },
        select: { id: true, signatory_role: true, signed_at: true, signatory_name: true },
        orderBy: { created_at: 'asc' },
      });
      console.log('Signatures:', JSON.stringify(sigs));
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
