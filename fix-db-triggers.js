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
    // Step 1: Update trigger function to handle BOTH INSERT and UPDATE
    // If updated_at is NULL, set it to NOW(). Always set it to NOW() on UPDATE.
    console.log('1. Updating trigger function to handle INSERT and UPDATE...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "AP_Invoice".set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.updated_at IS NULL THEN
            NEW.updated_at = NOW();
          END IF;
        ELSIF TG_OP = 'UPDATE' THEN
          NEW.updated_at = NOW();
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('   OK');

    // Step 2: Add BEFORE INSERT triggers (in addition to existing BEFORE UPDATE triggers)
    console.log('\n2. Adding BEFORE INSERT triggers...');
    for (const table of TABLES) {
      const triggerNameInsert = `trg_${table}_updated_at_insert`;
      const triggerNameUpdate = `trg_${table}_updated_at`;
      try {
        // Drop existing update trigger
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerNameUpdate} ON "AP_Invoice"."${table}";`);

        // Create BEFORE INSERT trigger
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerNameInsert} ON "AP_Invoice"."${table}";`);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER ${triggerNameInsert}
          BEFORE INSERT ON "AP_Invoice"."${table}"
          FOR EACH ROW
          EXECUTE FUNCTION "AP_Invoice".set_updated_at();
        `);
        console.log(`   ${table}: INSERT trigger created`);

        // Recreate BEFORE UPDATE trigger
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER ${triggerNameUpdate}
          BEFORE UPDATE ON "AP_Invoice"."${table}"
          FOR EACH ROW
          EXECUTE FUNCTION "AP_Invoice".set_updated_at();
        `);
        console.log(`   ${table}: UPDATE trigger created`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 150)}`);
      }
    }

    // Step 3: Test INSERT with updated_at = NULL (simulating buggy VPS Prisma client)
    console.log('\n3. Testing INSERT with updated_at = NULL...');
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES ('test-null-trigger', 'Test', 'testnulltrig@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW(), NULL)
      `);
      console.log('   SUCCESS — trigger set updated_at automatically!');

      const row = await prisma.$queryRawUnsafe(`
        SELECT updated_at FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-null-trigger'
      `);
      console.log('   updated_at value:', row[0].updated_at);

      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-null-trigger'`);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Step 4: Test UPDATE with updated_at = NULL
    console.log('\n4. Testing UPDATE with updated_at = NULL...');
    try {
      // First create a test row
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES ('test-update-null', 'Test', 'testupdatenull@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW(), NOW())
      `);

      // Now try to update with updated_at = NULL
      await prisma.$executeRawUnsafe(`
        UPDATE "AP_Invoice"."APInvoice_User" SET name = 'Updated', updated_at = NULL WHERE id = 'test-update-null'
      `);
      console.log('   SUCCESS — trigger set updated_at on update!');

      const row = await prisma.$queryRawUnsafe(`
        SELECT updated_at FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-update-null'
      `);
      console.log('   updated_at value:', row[0].updated_at);

      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE id = 'test-update-null'`);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    console.log('\n✅ Database triggers updated!');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
