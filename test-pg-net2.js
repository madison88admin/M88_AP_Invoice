process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Check pg_net schema
    console.log('1. Checking pg_net tables/functions...');
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'net' ORDER BY table_name
    `);
    console.log('   Tables:', tables.map(t => t.table_name));

    const funcs = await prisma.$queryRawUnsafe(`
      SELECT routine_name, data_type
      FROM information_schema.routines
      WHERE routine_schema = 'net'
      ORDER BY routine_name
    `);
    console.log('   Functions:');
    funcs.forEach(f => console.log(`     ${f.routine_name} returns ${f.data_type}`));

    // Check columns of net.http_response
    console.log('\n2. Checking net.http_response columns...');
    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'net' AND table_name = 'http_response'
      ORDER BY ordinal_position
    `);
    console.log('   Columns:');
    cols.forEach(c => console.log(`     ${c.column_name}: ${c.data_type}`));

    // Make a simple request
    console.log('\n3. Making HTTP GET request to localhost:3001...');
    const result = await prisma.$queryRawUnsafe(`
      SELECT net.http_get(
        url := 'http://localhost:3001/api/health',
        timeout_milliseconds := 5000
      ) as request_id
    `);
    console.log('   Result:', JSON.stringify(result[0]));

    // Wait for response
    await new Promise(r => setTimeout(r, 3000));

    // Check response table
    console.log('\n4. Checking response...');
    const resp = await prisma.$queryRawUnsafe(`
      SELECT * FROM net.http_response ORDER BY id DESC LIMIT 1
    `);
    if (resp.length > 0) {
      console.log('   Response:', JSON.stringify(resp[0], null, 2).substring(0, 500));
    } else {
      console.log('   No response found');
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
