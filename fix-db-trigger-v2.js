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
    // Update trigger to also handle created_at = NULL
    console.log('1. Updating trigger to handle id, created_at, and updated_at...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "AP_Invoice".set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.id IS NULL THEN
            NEW.id = gen_random_uuid()::text;
          END IF;
          IF NEW.created_at IS NULL THEN
            NEW.created_at = NOW();
          END IF;
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

    // Test: INSERT with ALL timestamps = NULL and id = NULL
    console.log('\n2. Testing INSERT with id=NULL, created_at=NULL, updated_at=NULL...');
    try {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES (NULL, 'Test All Null', 'testallnull@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NULL, NULL)
        RETURNING id, created_at, updated_at
      `);
      console.log('   SUCCESS — id:', rows[0].id, 'created_at:', rows[0].created_at, 'updated_at:', rows[0].updated_at);
      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE email = 'testallnull@update.test'`);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Test: INSERT with NO id, NO created_at, NO updated_at at all (omitted from column list)
    console.log('\n3. Testing INSERT with id, created_at, updated_at omitted entirely...');
    try {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (name, email, role, password_hash, active)
        VALUES ('Test Omitted', 'testomitted@update.test', 'PURCHASING_COORDINATOR', 'hash', true)
        RETURNING id, created_at, updated_at
      `);
      console.log('   SUCCESS — id:', rows[0].id, 'created_at:', rows[0].created_at, 'updated_at:', rows[0].updated_at);
      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE email = 'testomitted@update.test'`);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Test: INSERT with active = NULL (Prisma might send NULL for boolean if schema doesn't have @default(true))
    console.log('\n4. Testing INSERT with active=NULL...');
    try {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES (NULL, 'Test Active Null', 'testactivenull@update.test', 'PURCHASING_COORDINATOR', 'hash', NULL, NULL, NULL)
        RETURNING id, active, created_at, updated_at
      `);
      console.log('   SUCCESS — active:', rows[0].active);
      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE email = 'testactivenull@update.test'`);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Check if active column has a default
    console.log('\n5. Checking active column defaults...');
    for (const table of TABLES) {
      const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'AP_Invoice' AND table_name = '${table}' AND column_name = 'active'
      `);
      if (cols.length > 0) {
        console.log(`   ${table}: active default=${cols[0].column_default || 'NONE'}, nullable=${cols[0].is_nullable}`);
      }
    }

    console.log('\n✅ Trigger updated!');
  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
