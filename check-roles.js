process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // List all roles
    console.log('1. List all roles...');
    const roles = await prisma.$queryRawUnsafe(`
      SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin 
      FROM pg_roles 
      WHERE rolcanlogin = true
      ORDER BY rolname
    `);
    roles.forEach(r => console.log(`   ${r.rolname}: super=${r.rolsuper}, login=${r.rolcanlogin}`));

    // Check current user
    console.log('\n2. Current user...');
    const cur = await prisma.$queryRawUnsafe(`SELECT current_user, session_user`);
    console.log(`   current_user: ${cur[0].current_user}`);
    console.log(`   session_user: ${cur[0].session_user}`);

    // Check permissions on APInvoice_User
    console.log('\n3. Check table permissions...');
    const perms = await prisma.$queryRawUnsafe(`
      SELECT grantee, table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'AP_Invoice' AND table_name = 'APInvoice_User'
      ORDER BY grantee, privilege_type
    `);
    perms.forEach(p => console.log(`   ${p.grantee} -> ${p.table_name}: ${p.privilege_type}`));

    // Check table owner
    console.log('\n4. Table owners...');
    const owners = await prisma.$queryRawUnsafe(`
      SELECT tablename, tableowner FROM pg_tables 
      WHERE schemaname = 'AP_Invoice' ORDER BY tablename
    `);
    owners.forEach(o => console.log(`   ${o.tablename}: owner=${o.tableowner}`));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
