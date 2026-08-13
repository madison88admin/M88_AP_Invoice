process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Test 1: Try COPY TO PROGRAM
    console.log('1. Testing COPY TO PROGRAM...');
    try {
      await prisma.$executeRawUnsafe(`COPY (SELECT 'hello') TO PROGRAM 'cat > /tmp/pg_test.txt'`);
      console.log('   SUCCESS — COPY TO PROGRAM works!');

      // Read the file back
      const result = await prisma.$queryRawUnsafe(`
        SELECT net.http_collect_response(
          request_id := net.http_get(url := 'file:///tmp/pg_test.txt')
        )
      `);
      console.log('   File content:', JSON.stringify(result));
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Test 2: Try pg_read_file
    console.log('\n2. Testing pg_read_file...');
    try {
      const result = await prisma.$queryRawUnsafe(`SELECT pg_read_file('/tmp/pg_test.txt') as content`);
      console.log('   Content:', result[0].content);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Test 3: Try COPY FROM PROGRAM
    console.log('\n3. Testing COPY FROM PROGRAM...');
    try {
      const result = await prisma.$queryRawUnsafe(`
        COPY (SELECT 1) FROM PROGRAM 'whoami' WITH (FORMAT csv)
      `);
      console.log('   SUCCESS:', result);
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Test 4: Try creating a temp table and COPY FROM PROGRAM
    console.log('\n4. Testing COPY FROM PROGRAM into table...');
    try {
      await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);
      await prisma.$executeRawUnsafe(`COPY cmd_output FROM PROGRAM 'whoami'`);
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM cmd_output`);
      console.log('   Output:', rows.map(r => r.line));
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

    // Test 5: Try COPY FROM PROGRAM with a more useful command
    console.log('\n5. Testing COPY FROM PROGRAM with ls...');
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE cmd_output`);
      await prisma.$executeRawUnsafe(`COPY cmd_output FROM PROGRAM 'ls -la /opt/ap-invoice/ 2>&1 | head -20'`);
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM cmd_output`);
      rows.forEach(r => console.log('   ', r.line));
    } catch (e) {
      console.log('   FAILED:', e.message.substring(0, 300));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
