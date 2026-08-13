process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Check available extensions
    console.log('1. Checking available extensions...');
    const exts = await prisma.$queryRawUnsafe(`
      SELECT name, installed_version, default_version
      FROM pg_available_extensions
      WHERE name IN ('plpythonu', 'plperlu', 'plv8', 'pllua', 'plsh', 'adminpack', 'pgstattuple')
      ORDER BY name
    `);
    exts.forEach(e => console.log(`   ${e.name}: installed=${e.installed_version || 'NO'}, available=${e.default_version}`));

    // Check if plpythonu is already installed
    console.log('\n2. Checking installed extensions...');
    const installed = await prisma.$queryRawUnsafe(`
      SELECT extname, extversion FROM pg_extension ORDER BY extname
    `);
    installed.forEach(e => console.log(`   ${e.extname} ${e.extversion}`));

    // Try to create plpythonu
    console.log('\n3. Trying to install plpythonu...');
    try {
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS plpythonu;`);
      console.log('   plpythonu installed!');

      // Test: create a function that executes a shell command
      console.log('\n4. Creating test function...');
      try {
        await prisma.$executeRawUnsafe(`
          CREATE OR REPLACE FUNCTION "AP_Invoice".exec_cmd(cmd text)
          RETURNS text AS $$
          import subprocess
          result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
          return result.stdout + result.stderr
          $$ LANGUAGE plpythonu;
        `);
        console.log('   Function created!');

        // Test: run a simple command
        console.log('\n5. Testing command execution...');
        const result = await prisma.$queryRawUnsafe(`SELECT "AP_Invoice".exec_cmd('whoami') as output`);
        console.log('   Output:', result[0].output);
      } catch (e) {
        console.log('   Failed:', e.message.substring(0, 300));
      }
    } catch (e) {
      console.log('   Failed to install plpythonu:', e.message.substring(0, 300));
    }

    // Try plperlu as alternative
    console.log('\n6. Trying plperlu...');
    try {
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS plperlu;`);
      console.log('   plperlu installed!');
    } catch (e) {
      console.log('   Failed:', e.message.substring(0, 200));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
