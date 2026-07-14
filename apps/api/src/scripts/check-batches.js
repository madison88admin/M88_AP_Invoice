require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check payment batches
  const batches = await prisma.paymentBatch.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    include: { _count: { select: { payments: true } } }
  });
  console.log('Payment batches:', JSON.stringify(batches, null, 2));

  // Check payments
  const payments = await prisma.payment.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    include: { invoice: { select: { invoice_number: true, status: true, vendor_name_raw: true } } }
  });
  console.log('\nRecent payments:', JSON.stringify(payments, null, 2));

  // Check invoices in APPROVED or PENDING_ACCOUNTING status (should be ready for payment scheduling)
  const readyForPayment = await prisma.invoice.findMany({
    where: {
      status: { in: ['APPROVED', 'PENDING_ACCOUNTING', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'] }
    },
    select: {
      id: true,
      invoice_number: true,
      status: true,
      total_amount: true,
      vendor_name_raw: true,
      approval_tier: true,
    }
  });
  console.log('\nInvoices ready for payment flow:', JSON.stringify(readyForPayment, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
