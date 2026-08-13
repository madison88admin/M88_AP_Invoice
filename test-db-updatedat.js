process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Test 1: Insert WITHOUT updated_at (simulating what a buggy Prisma client might do)
    console.log('Test 1: Raw INSERT without updated_at...');
    try {
      await prisma.$executeRaw`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at)
        VALUES ('test-no-updated', 'Test', 'testno@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW())
      `;
      console.log('  SUCCESS — updated_at has a default or is nullable');
      // Clean up
      await prisma.$executeRaw`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-no-updated'`;
    } catch (e) {
      console.log('  FAILED:', e.message.substring(0, 200));
    }

    // Test 2: Insert WITH updated_at
    console.log('\nTest 2: Raw INSERT with updated_at...');
    try {
      await prisma.$executeRaw`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES ('test-with-updated', 'Test', 'testwith@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW(), NOW())
      `;
      console.log('  SUCCESS');
      await prisma.$executeRaw`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-with-updated'`;
    } catch (e) {
      console.log('  FAILED:', e.message.substring(0, 200));
    }

    // Test 3: Check the Prisma client version
    console.log('\nPrisma client version:', require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client/package.json').version);

    // Test 4: Check which tables have updated_at with NO default
    const tables = await prisma.$queryRaw`
      SELECT table_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'AP_Invoice'
        AND column_name = 'updated_at'
      ORDER BY table_name
    `;
    console.log('\nTables with updated_at column:');
    tables.forEach(t => {
      const hasDefault = t.column_default !== null;
      const nullable = t.is_nullable === 'YES';
      console.log(`  ${t.table_name}: default=${hasDefault ? 'YES' : 'NO'}, nullable=${nullable ? 'YES' : 'NO'}`);
    });

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
