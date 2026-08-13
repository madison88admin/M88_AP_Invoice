process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Grant ALL permissions to postgres role on AP_Invoice schema
    console.log('1. Granting schema permissions to postgres...');
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "AP_Invoice" TO postgres;`);
    await prisma.$executeRawUnsafe(`GRANT CREATE ON SCHEMA "AP_Invoice" TO postgres;`);
    console.log('   Schema permissions granted');

    // Grant ALL on all tables in AP_Invoice schema
    console.log('\n2. Granting table permissions to postgres...');
    await prisma.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA "AP_Invoice" TO postgres;`);
    console.log('   Table permissions granted');

    // Grant ALL on all sequences
    console.log('\n3. Granting sequence permissions to postgres...');
    await prisma.$executeRawUnsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "AP_Invoice" TO postgres;`);
    console.log('   Sequence permissions granted');

    // Set default privileges for future tables
    console.log('\n4. Setting default privileges...');
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA "AP_Invoice" GRANT ALL ON TABLES TO postgres;`);
    await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "AP_Invoice" GRANT ALL ON TABLES TO postgres;`);
    console.log('   Default privileges set');

    // Verify
    console.log('\n5. Verifying permissions for postgres...');
    const perms = await prisma.$queryRawUnsafe(`
      SELECT table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE grantee = 'postgres' AND table_schema = 'AP_Invoice'
      ORDER BY table_name, privilege_type
    `);
    perms.forEach(p => console.log(`   ${p.table_name}: ${p.privilege_type}`));

    console.log('\n✅ Permissions granted to postgres!');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
