process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Test pg_net by making a request to the VPS API on localhost
    console.log('1. Testing pg_net with localhost API...');
    try {
      // First, make the request
      const reqResult = await prisma.$queryRawUnsafe(`
        SELECT * FROM net.http_get(
          url := 'http://localhost:3001/api/health',
          timeout_milliseconds := 5000
        )
      `);
      console.log('   Request started, id:', reqResult[0].id);

      // Wait for the response
      await new Promise(r => setTimeout(r, 2000));

      // Check the response
      const resp = await prisma.$queryRawUnsafe(`
        SELECT status_code, content_type, body, error_msg
        FROM net._http_response
        WHERE id = ${reqResult[0].id}
      `);
      if (resp.length > 0) {
        console.log('   Status:', resp[0].status_code);
        console.log('   Body:', resp[0].body?.toString().substring(0, 200));
      } else {
        console.log('   No response yet');
      }
    } catch (e) {
      console.log('   Failed:', e.message.substring(0, 300));
    }

    // Try using http_get with a simpler approach
    console.log('\n2. Trying net.http_get with response...');
    try {
      const result = await prisma.$queryRawUnsafe(`
        SELECT id FROM net.http_get(
          url := 'http://localhost:3001/api/health'
        )
      `);
      const reqId = result[0].id;
      console.log('   Request ID:', reqId);

      // Wait and check
      await new Promise(r => setTimeout(r, 3000));

      const resp = await prisma.$queryRawUnsafe(`
        SELECT status_code, body::text as body
        FROM net.http_response
        WHERE id = ${reqId}
      `);
      if (resp.length > 0) {
        console.log('   Status:', resp[0].status_code);
        console.log('   Body:', resp[0].body?.substring(0, 200));
      } else {
        // Try alternate table
        const resp2 = await prisma.$queryRawUnsafe(`
          SELECT * FROM net._http_response WHERE id = ${reqId}
        `);
        if (resp2.length > 0) {
          console.log('   Status:', resp2[0].status_code);
          console.log('   Body:', JSON.stringify(resp2[0]).substring(0, 300));
        } else {
          console.log('   No response found');
        }
      }
    } catch (e) {
      console.log('   Failed:', e.message.substring(0, 300));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
