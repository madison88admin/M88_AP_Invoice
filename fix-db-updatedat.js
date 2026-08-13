process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

const TABLES = [
  'APInvoice_User',
  'APInvoice_Vendor',
  'APInvoice_Invoice',
  'APInvoice_InvoiceLine',
  'APInvoice_Payment',
  'APInvoice_CorrectionLog',
  'APInvoice_FollowUpTask',
];

(async () => {
  try {
    // Step 1: Create a trigger function that sets updated_at = NOW() on update
    console.log('1. Creating trigger function set_updated_at()...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "AP_Invoice".set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('   OK');

    // Step 2: Add DEFAULT CURRENT_TIMESTAMP to updated_at columns
    console.log('\n2. Adding DEFAULT CURRENT_TIMESTAMP to updated_at columns...');
    for (const table of TABLES) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AP_Invoice"."${table}"
          ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
        `);
        console.log(`   ${table}: DEFAULT added`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 100)}`);
      }
    }

    // Step 3: Create triggers on all tables
    console.log('\n3. Creating update triggers...');
    for (const table of TABLES) {
      const triggerName = `trg_${table}_updated_at`;
      try {
        // Drop existing trigger if any
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "AP_Invoice"."${table}";`);
        // Create new trigger
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER ${triggerName}
          BEFORE UPDATE ON "AP_Invoice"."${table}"
          FOR EACH ROW
          EXECUTE FUNCTION "AP_Invoice".set_updated_at();
        `);
        console.log(`   ${table}: trigger created`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 100)}`);
      }
    }

    // Step 4: Backfill any NULL updated_at values (shouldn't be any, but just in case)
    console.log('\n4. Backfilling any NULL updated_at values...');
    for (const table of TABLES) {
      try {
        const result = await prisma.$executeRawUnsafe(`
          UPDATE "AP_Invoice"."${table}"
          SET updated_at = created_at
          WHERE updated_at IS NULL;
        `);
        console.log(`   ${table}: ${result} rows updated`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 100)}`);
      }
    }

    // Step 5: Verify
    console.log('\n5. Verifying defaults...');
    const check = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'AP_Invoice'
        AND column_name = 'updated_at'
      ORDER BY table_name
    `);
    check.forEach(t => {
      console.log(`   ${t.table_name}: default=${t.column_default || 'NONE'}, nullable=${t.is_nullable}`);
    });

    // Step 6: Test insert without updated_at
    console.log('\n6. Testing INSERT without updated_at...');
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at)
        VALUES ('test-default-updated', 'Test', 'testdefault@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW())
      `);
      console.log('   SUCCESS — updated_at now has a default!');

      // Verify the updated_at was set
      const row = await prisma.$queryRawUnsafe(`
        SELECT updated_at FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-default-updated'
      `);
      console.log('   updated_at value:', row[0].updated_at);

      // Clean up
      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-default-updated'`);
      console.log('   Cleaned up test row');
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 200));
    }

    console.log('\n✅ Database fix applied successfully!');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
