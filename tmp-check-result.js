
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const stuck = await p.invoice.findMany({
    where: { status: { in: ['OCR_PROCESSING', 'RECEIVED', 'VALIDATION_PENDING'] } },
    select: { id: true, invoice_number: true, status: true },
    orderBy: { created_at: 'desc' }
  });
  console.log('Still stuck: ' + stuck.length);
  if (stuck.length > 0) {
    stuck.forEach(i => console.log('  ' + i.invoice_number + ' - ' + i.status));
  }
  
  const moved = await p.invoice.findMany({
    where: { status: { in: ['PENDING_COORDINATOR', 'EXCEPTION_FLAGGED'] } },
    select: { id: true, invoice_number: true, status: true },
    orderBy: { created_at: 'desc' },
    take: 20
  });
  console.log('\nMoved to approval/exception: ' + moved.length);
  moved.forEach(i => console.log('  ' + i.invoice_number + ' - ' + i.status));
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
