process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['query', 'error'] });

(async () => {
  // Test: INSERT with updated_at = NULL explicitly (this is what a buggy Prisma client might do)
  console.log('Test: INSERT with updated_at = NULL explicitly...');
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
      VALUES ('test-null-updated', 'Test', 'testnull@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW(), NULL)
    `);
    console.log('  SUCCESS');
    await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-null-updated'`);
  } catch (e) {
    console.log('  FAILED:', e.message.substring(0, 300));
  }

  // Test: What does Prisma actually generate for user.create?
  console.log('\nTest: Prisma user.create() with explicit query logging...');
  try {
    const user = await prisma.user.create({
      data: {
        name: 'Test Prisma',
        email: 'testprisma@update.test',
        role: 'PURCHASING_COORDINATOR',
        password_hash: 'hash',
        active: true,
      },
    });
    console.log('  SUCCESS:', user.id);
    await prisma.user.delete({ where: { id: user.id } });
  } catch (e) {
    console.log('  FAILED:', e.message.substring(0, 300));
  }

  // Test: Prisma user.update() with explicit query logging
  console.log('\nTest: Prisma user.update() with explicit query logging...');
  try {
    const jc = await prisma.user.findFirst({ where: { email: 'jc@madison88.com' } });
    if (jc) {
      const updated = await prisma.user.update({
        where: { id: jc.id },
        data: { name: 'JC' },
      });
      console.log('  SUCCESS:', updated.id, 'updated_at:', updated.updated_at);
    }
  } catch (e) {
    console.log('  FAILED:', e.message.substring(0, 300));
  }
})();
