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

    // Check if Docker API is accessible
    console.log('1. Check Docker API on various endpoints...');
    console.log(await runCmd('curl -s --connect-timeout 3 http://localhost:2375/containers/json 2>&1 | head -5 || echo "no docker on 2375"'));
    console.log(await runCmd('curl -s --connect-timeout 3 http://localhost:2376/containers/json 2>&1 | head -5 || echo "no docker on 2376"'));
    console.log(await runCmd('curl -s --connect-timeout 3 --unix-socket /var/run/docker.sock http://localhost/containers/json 2>&1 | head -5 || echo "no docker socket"'));

    // Try host gateway (usually 172.17.0.1)
    console.log('\n2. Try Docker API on host gateway...');
    console.log(await runCmd('curl -s --connect-timeout 3 http://172.17.0.1:2375/containers/json 2>&1 | head -10 || echo "no docker on host:2375"'));
    console.log(await runCmd('cat /proc/net/route 2>/dev/null'));

    // Check network config
    console.log('\n3. Network config...');
    console.log(await runCmd('cat /etc/hosts'));
    console.log(await runCmd('cat /etc/resolv.conf'));

    // Try to find the host IP
    console.log('\n4. Find host IP...');
    console.log(await runCmd('cat /proc/net/fib_trie 2>/dev/null | grep "32 host" | head -10'));

    // Try to reach Docker API on host
    console.log('\n5. Try Docker API on various IPs...');
    const ips = ['172.17.0.1', '172.18.0.1', '10.0.0.1', 'host.docker.internal'];
    for (const ip of ips) {
      console.log(await runCmd(`curl -s --connect-timeout 2 http://${ip}:2375/containers/json 2>&1 | head -3 || echo "no docker on ${ip}:2375"`));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
