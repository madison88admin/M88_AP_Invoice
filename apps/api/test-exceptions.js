const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    // Count by status
    const statusCounts = await prisma.$queryRaw`
      SELECT status, COUNT(*)::int as count
      FROM "AP_Invoice"."APInvoice_Exception"
      GROUP BY status
      ORDER BY count DESC
    `;
    console.log('=== Exception status counts ===');
    statusCounts.forEach(row => console.log(`  ${row.status}: ${row.count}`));

    // Show some RESOLVED/WAIVED exceptions
    const resolved = await prisma.$queryRaw`
      SELECT e.id, e.reason, e.status, e.invoice_id, i.invoice_number
      FROM "AP_Invoice"."APInvoice_Exception" e
      LEFT JOIN "AP_Invoice"."APInvoice_Invoice" i ON e.invoice_id = i.id
      WHERE e.status IN ('RESOLVED', 'WAIVED')
      ORDER BY e.updated_at DESC
      LIMIT 10
    `;
    console.log('\n=== Recent RESOLVED/WAIVED exceptions ===');
    if (resolved.length === 0) {
      console.log('  NONE FOUND - No exceptions have been resolved or waived yet!');
    } else {
      resolved.forEach(e => console.log(`  ${e.status} | ${e.reason} | ${e.invoice_number} | ${e.id.substring(0, 8)}`));
    }

    // Show some PENDING exceptions
    const pending = await prisma.$queryRaw`
      SELECT e.id, e.reason, e.status, e.invoice_id, i.invoice_number
      FROM "AP_Invoice"."APInvoice_Exception" e
      LEFT JOIN "AP_Invoice"."APInvoice_Invoice" i ON e.invoice_id = i.id
      WHERE e.status = 'PENDING'
      LIMIT 10
    `;
    console.log('\n=== Sample PENDING exceptions ===');
    pending.forEach(e => console.log(`  ${e.status} | ${e.reason} | ${e.invoice_number} | ${e.id.substring(0, 8)}`));

  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
