process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Create a log table
    console.log('1. Creating debug log table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AP_Invoice"."DebugInsertLog" (
        id SERIAL PRIMARY KEY,
        table_name TEXT,
        new_data TEXT,
        error_msg TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('   OK');

    // Create a BEFORE INSERT trigger on APInvoice_User that logs the attempt
    console.log('\n2. Creating BEFORE INSERT trigger to log attempts...');

    // First, create a function that logs the insert attempt
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "AP_Invoice".log_insert_attempt()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO "AP_Invoice"."DebugInsertLog" (table_name, new_data)
        VALUES (TG_TABLE_NAME, row_to_json(NEW)::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the trigger
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_log_user_insert ON "AP_Invoice"."APInvoice_User";`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_log_user_insert
      BEFORE INSERT ON "AP_Invoice"."APInvoice_User"
      FOR EACH ROW
      EXECUTE FUNCTION "AP_Invoice".log_insert_attempt();
    `);
    console.log('   OK');

    // Also create an AFTER INSERT trigger that logs success
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "AP_Invoice".log_insert_success()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO "AP_Invoice"."DebugInsertLog" (table_name, new_data, error_msg)
        VALUES (TG_TABLE_NAME, row_to_json(NEW)::text, 'SUCCESS');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_log_user_insert_after ON "AP_Invoice"."APInvoice_User";`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_log_user_insert_after
      AFTER INSERT ON "AP_Invoice"."APInvoice_User"
      FOR EACH ROW
      EXECUTE FUNCTION "AP_Invoice".log_insert_success();
    `);
    console.log('   AFTER INSERT trigger created');

    console.log('\n✅ Debug logging set up! Now try POST /api/users on VPS and check DebugInsertLog table.');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
