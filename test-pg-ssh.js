process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

async function runCmd(cmd) {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE cmd_output`);
    await prisma.$executeRawUnsafe(`COPY cmd_output FROM PROGRAM '${cmd.replace(/'/g, "'\\''")}'`);
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM cmd_output`);
    return rows.map(r => r.line).join('\n');
  } catch (e) {
    return 'ERROR: ' + e.message.substring(0, 300);
  }
}

(async () => {
  try {
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);

    // Check if we can reach the host's SSH port
    console.log('1. Check host gateway...');
    console.log(await runCmd('cat /proc/net/route 2>/dev/null | head -5'));
    console.log(await runCmd('ip route show default 2>/dev/null'));

    // Try to reach SSH on the host
    console.log('\n2. Try SSH on host gateway...');
    console.log(await runCmd('curl -s --connect-timeout 3 telnet://172.17.0.1:22 2>&1 | head -3 || echo "cannot reach"'));
    console.log(await runCmd('curl -s --connect-timeout 3 http://172.17.0.1:22 2>&1 | head -3 || echo "cannot reach"'));

    // Check if the API is on the host or another container
    console.log('\n3. Check API server location...');
    console.log(await runCmd('curl -s http://5.223.78.194/api/health 2>/dev/null'));
    console.log(await runCmd('curl -s --connect-timeout 3 http://172.17.0.1:3001/api/health 2>/dev/null || echo "not on host:3001"'));
    console.log(await runCmd('curl -s --connect-timeout 3 http://172.17.0.1:80/api/health 2>/dev/null || echo "not on host:80"'));

    // Check Docker socket
    console.log('\n4. Check Docker socket...');
    console.log(await runCmd('ls -la /var/run/docker.sock 2>/dev/null || echo "no docker socket"'));

    // Check if we can install packages
    console.log('\n5. Check package managers...');
    console.log(await runCmd('which apt apt-get apk yum 2>/dev/null || echo "no package managers"'));

    // Try to use curl to download the new code from GitHub and deploy via API
    console.log('\n6. Try to use pg_net to POST to API...');
    const result = await prisma.$queryRawUnsafe(`
      SELECT net.http_post(
        url := 'http://5.223.78.194/api/auth/login',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"email":"jc@madison88.com","password":"Ar5yG3#4"}'::jsonb
      ) as request_id
    `);
    console.log('   Request ID:', result[0].request_id.toString());

    await new Promise(r => setTimeout(r, 3000));

    // Collect response
    const resp = await prisma.$queryRawUnsafe(`
      SELECT * FROM net._http_response ORDER BY id DESC LIMIT 1
    `);
    if (resp.length > 0) {
      console.log('   Status:', resp[0].status_code);
      const body = resp[0].body;
      console.log('   Body:', body ? body.toString().substring(0, 200) : 'empty');
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
