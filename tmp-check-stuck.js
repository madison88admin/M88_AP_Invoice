
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.invoice.findMany({
  where: { status: { in: ['OCR_PROCESSING', 'RECEIVED', 'VALIDATION_PENDING'] } },
  select: { id: true, invoice_number: true, status: true, created_at: true, vendor_name_raw: true },
  orderBy: { created_at: 'desc' }
}).then(r => {
  console.log(JSON.stringify(r, null, 2));
  p.$disconnect();
}).catch(e => {
  console.error(e);
  p.$disconnect();
});
