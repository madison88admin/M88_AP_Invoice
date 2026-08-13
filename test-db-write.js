process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient({ log: ['query', 'error', 'warn'] });

function hashPassword(p) {
  return crypto.createHash('sha256').update(p).digest('hex');
}

(async () => {
  try {
    console.log('1. Checking table structure...');
    const cols = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'AP_Invoice' AND table_name = 'APInvoice_User'
      ORDER BY ordinal_position
    `;
    console.table(cols);

    console.log('\n2. Trying to create a test user...');
    try {
      const user = await prisma.user.create({
        data: {
          name: 'Test Debug',
          email: 'testdebug@madison88.com',
          role: 'PURCHASING_COORDINATOR',
          password_hash: hashPassword('test123'),
          active: true,
        },
      });
      console.log('CREATE succeeded:', user.id);

      // Clean up
      await prisma.user.delete({ where: { id: user.id } });
      console.log('Deleted test user');
    } catch (e) {
      console.error('CREATE FAILED:', e.message);
      console.error('Full error:', JSON.stringify(e, null, 2));
    }

    console.log('\n3. Trying to update an existing user...');
    try {
      const jc = await prisma.user.findFirst({ where: { email: 'jc@madison88.com' } });
      if (jc) {
        const updated = await prisma.user.update({
          where: { id: jc.id },
          data: { password_hash: hashPassword('Ar5yG3#4') },
        });
        console.log('UPDATE succeeded:', updated.id, 'updated_at:', updated.updated_at);
      }
    } catch (e) {
      console.error('UPDATE FAILED:', e.message);
      console.error('Full error:', JSON.stringify(e, null, 2));
    }

    console.log('\n4. Checking AuditLog table...');
    try {
      const auditCols = await prisma.$queryRaw`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'AP_Invoice' AND table_name = 'APInvoice_AuditLog'
        ORDER BY ordinal_position
      `;
      console.table(auditCols);
    } catch (e) {
      console.error('AuditLog table check FAILED:', e.message);
    }

    console.log('\n5. Trying to insert into AuditLog...');
    try {
      const log = await prisma.auditLog.create({
        data: {
          action: 'TEST_DEBUG',
          performed_by: 'debug-script',
          note: 'Testing audit log insert',
        },
      });
      console.log('AuditLog CREATE succeeded:', log.id);
      await prisma.auditLog.delete({ where: { id: log.id } });
      console.log('Deleted test audit log');
    } catch (e) {
      console.error('AuditLog CREATE FAILED:', e.message);
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
