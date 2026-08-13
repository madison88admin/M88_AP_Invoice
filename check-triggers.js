process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Check all triggers on APInvoice_User
    console.log('Triggers on APInvoice_User:');
    const triggers = await prisma.$queryRawUnsafe(`
      SELECT trigger_name, event_manipulation, action_timing, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema = 'AP_Invoice' AND event_object_table = 'APInvoice_User'
      ORDER BY trigger_name
    `);
    triggers.forEach(t => console.log(`  ${t.action_timing} ${t.event_manipulation}: ${t.trigger_name}`));

    // Test UPDATE directly
    console.log('\nTesting UPDATE directly...');
    try {
      const result = await prisma.$executeRawUnsafe(`
        UPDATE "AP_Invoice"."APInvoice_User" SET name = 'JC' WHERE email = 'jc@madison88.com'
      `);
      console.log('UPDATE succeeded:', result, 'rows');
    } catch (e) {
      console.log('UPDATE FAILED:', e.message.substring(0, 300));
    }

    // Test INSERT directly (with all fields)
    console.log('\nTesting INSERT directly (with all fields)...');
    try {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES ('test-direct-insert', 'Test', 'testdirect@madison88.com', 'PURCHASING_COORDINATOR', 'hash', true, NOW(), NOW())
        RETURNING id
      `);
      console.log('INSERT succeeded:', rows[0].id);
      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-direct-insert'`);
    } catch (e) {
      console.log('INSERT FAILED:', e.message.substring(0, 300));
    }

    // Check functions
    console.log('\nFunctions in AP_Invoice schema:');
    const funcs = await prisma.$queryRawUnsafe(`
      SELECT routine_name, routine_type
      FROM information_schema.routines
      WHERE routine_schema = 'AP_Invoice'
    `);
    funcs.forEach(f => console.log(`  ${f.routine_name} (${f.routine_type})`));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
