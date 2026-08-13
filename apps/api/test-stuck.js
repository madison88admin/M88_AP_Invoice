const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    // Get the 3 stuck invoices with their exception details
    const stuck = await prisma.$queryRaw`
      SELECT i.id, i.invoice_number, i.status,
             e.reason, e.status as exc_status, e.detail
      FROM "AP_Invoice"."APInvoice_Invoice" i
      JOIN "AP_Invoice"."APInvoice_Exception" e ON e.invoice_id = i.id
      WHERE i.status IN ('EXCEPTION_FLAGGED', 'ON_HOLD')
      AND e.status IN ('RESOLVED', 'WAIVED')
      ORDER BY i.invoice_number
    `;
    console.log('=== Stuck invoices (EXCEPTION_FLAGGED/ON_HOLD with RESOLVED/WAIVED exceptions) ===');
    const byInvoice = {};
    stuck.forEach(row => {
      if (!byInvoice[row.invoice_number]) {
        byInvoice[row.invoice_number] = { status: row.status, exceptions: [] };
      }
      byInvoice[row.invoice_number].exceptions.push(`${row.exc_status}: ${row.reason}`);
    });
    Object.entries(byInvoice).forEach(([inv, data]) => {
      console.log(`\n  ${inv} (status=${data.status})`);
      data.exceptions.forEach(exc => console.log(`    ${exc}`));
    });

    // Now check: do these invoices ALSO have PENDING exceptions?
    for (const inv of Object.keys(byInvoice)) {
      const pending = await prisma.$queryRaw`
        SELECT reason, status, detail
        FROM "AP_Invoice"."APInvoice_Exception"
        WHERE invoice_id = (
          SELECT id FROM "AP_Invoice"."APInvoice_Invoice" WHERE invoice_number = ${inv}
        )
        AND status = 'PENDING'
      `;
      console.log(`\n  ${inv} PENDING exceptions: ${pending.length}`);
      pending.forEach(p => console.log(`    PENDING: ${p.reason} - ${(p.detail || '').substring(0, 80)}`));
    }

  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
