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
    // Step 1: Check if id columns have defaults
    console.log('1. Checking id column defaults...');
    for (const table of TABLES) {
      const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'AP_Invoice' AND table_name = '${table}' AND column_name = 'id'
      `);
      console.log(`   ${table}: id default=${cols[0].column_default || 'NONE'}, nullable=${cols[0].is_nullable}`);
    }

    // Step 2: Add DEFAULT gen_random_uuid()::text to id columns
    console.log('\n2. Adding UUID defaults to id columns...');
    for (const table of TABLES) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AP_Invoice"."${table}"
          ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
        `);
        console.log(`   ${table}: id DEFAULT added`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 150)}`);
      }
    }

    // Step 3: Update trigger function to also handle id (generate UUID if NULL)
    console.log('\n3. Updating trigger function to handle id and updated_at...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "AP_Invoice".set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.id IS NULL THEN
            NEW.id = gen_random_uuid()::text;
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

    // Step 4: Test INSERT with id = NULL and updated_at = NULL
    console.log('\n4. Testing INSERT with id=NULL and updated_at=NULL...');
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (name, email, role, password_hash, active, created_at)
        VALUES ('Test No ID', 'testnoid@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW())
        RETURNING id, updated_at
      `).then(rows => {
        console.log('   SUCCESS — id:', rows[0].id, 'updated_at:', rows[0].updated_at);
        // Clean up
        prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE email = 'testnoid@update.test'`);
      });
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Step 5: Test INSERT with id = NULL explicitly and updated_at = NULL explicitly
    console.log('\n5. Testing INSERT with id=NULL explicitly and updated_at=NULL explicitly...');
    try {
      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO "AP_Invoice"."APInvoice_User" (id, name, email, role, password_hash, active, created_at, updated_at)
        VALUES (NULL, 'Test Null ID', 'testnullid@update.test', 'PURCHASING_COORDINATOR', 'hash', true, NOW(), NULL)
        RETURNING id, updated_at
      `);
      console.log('   SUCCESS — id:', rows[0].id, 'updated_at:', rows[0].updated_at);
      await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE email = 'testnullid@update.test'`);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    console.log('\n✅ Database fix complete!');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
