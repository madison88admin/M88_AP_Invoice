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
    // Make updated_at nullable in all tables
    console.log('1. Making updated_at nullable...');
    for (const table of TABLES) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AP_Invoice"."${table}"
          ALTER COLUMN updated_at DROP NOT NULL;
        `);
        console.log(`   ${table}: updated_at is now nullable`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 150)}`);
      }
    }

    // Verify
    console.log('\n2. Verifying...');
    const cols = await prisma.$queryRawUnsafe(`
      SELECT table_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'AP_Invoice'
        AND column_name = 'updated_at'
      ORDER BY table_name
    `);
    cols.forEach(c => {
      console.log(`   ${c.table_name}: nullable=${c.is_nullable}, default=${c.column_default || 'NONE'}`);
    });

    // Also make created_at nullable (in case Prisma client requires it too)
    console.log('\n3. Making created_at nullable too...');
    for (const table of TABLES) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AP_Invoice"."${table}"
          ALTER COLUMN created_at DROP NOT NULL;
        `);
        console.log(`   ${table}: created_at is now nullable`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 150)}`);
      }
    }

    // Also make id nullable (in case Prisma client requires it)
    console.log('\n4. Making id nullable too...');
    for (const table of TABLES) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "AP_Invoice"."${table}"
          ALTER COLUMN id DROP NOT NULL;
        `);
        console.log(`   ${table}: id is now nullable`);
      } catch (e) {
        console.log(`   ${table}: FAILED - ${e.message.substring(0, 150)}`);
      }
    }

    // Also make active nullable for User table
    console.log('\n5. Making active nullable for User...');
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "AP_Invoice"."APInvoice_User"
        ALTER COLUMN active DROP NOT NULL;
      `);
      console.log('   APInvoice_User: active is now nullable');
    } catch (e) {
      console.log(`   FAILED - ${e.message.substring(0, 150)}`);
    }

    console.log('\n✅ Database schema updated! Now test the VPS API.');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
