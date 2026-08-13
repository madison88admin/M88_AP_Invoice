process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Grant ALL permissions on schema and all tables to postgres.m88
    console.log('1. Granting schema permissions...');
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA "AP_Invoice" TO "postgres.m88";`);
    console.log('   Schema permissions granted');

    // Grant ALL on all existing tables
    console.log('\n2. Granting table permissions...');
    const tables = await prisma.$queryRawUnsafe(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'AP_Invoice' ORDER BY tablename
    `);
    for (const t of tables) {
      try {
        await prisma.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA "AP_Invoice" TO "postgres.m88";`);
        console.log(`   Granted ALL on ${t.tablename}`);
      } catch (e) {
        console.log(`   FAILED on ${t.tablename}: ${e.message.substring(0, 100)}`);
      }
    }

    // Grant ALL on all sequences
    console.log('\n3. Granting sequence permissions...');
    await prisma.$executeRawUnsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "AP_Invoice" TO "postgres.m88";`);
    console.log('   Sequence permissions granted');

    // Alter default privileges for future tables
    console.log('\n4. Setting default privileges...');
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "AP_Invoice" GRANT ALL ON TABLES TO "postgres.m88";`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA "AP_Invoice" GRANT ALL ON SEQUENCES TO "postgres.m88";`);
    console.log('   Default privileges set');

    // Verify
    console.log('\n5. Verifying permissions...');
    const perms = await prisma.$queryRawUnsafe(`
      SELECT table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE grantee = 'postgres.m88' 
        AND table_schema = 'AP_Invoice'
      ORDER BY table_name, privilege_type
      LIMIT 20
    `);
    perms.forEach(p => console.log(`   ${p.table_name}: ${p.privilege_type}`));

    console.log('\n✅ Permissions granted!');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
