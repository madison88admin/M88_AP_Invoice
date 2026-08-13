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

    // Check Python
    console.log('1. Check Python...');
    console.log(await runCmd('which python3 python 2>/dev/null'));
    console.log(await runCmd('python3 --version 2>/dev/null'));

    // Check if paramiko is available
    console.log('\n2. Check Python SSH libraries...');
    console.log(await runCmd('python3 -c "import paramiko; print(paramiko.__version__)" 2>&1 || echo "no paramiko"'));
    console.log(await runCmd('python3 -c "import pexpect; print(pexpect.__version__)" 2>&1 || echo "no pexpect"'));

    // Check if we can pip install
    console.log('\n3. Try pip install...');
    console.log(await runCmd('pip3 install paramiko 2>&1 | tail -5 || echo "pip failed"'));
    console.log(await runCmd('pip3 install --user paramiko 2>&1 | tail -5 || echo "pip --user failed"'));

    // Check nc (netcat)
    console.log('\n4. Check netcat...');
    console.log(await runCmd('which nc ncat netcat 2>/dev/null || echo "no netcat"'));

    // Check if we can use expect
    console.log('\n5. Check expect...');
    console.log(await runCmd('which expect 2>/dev/null || echo "no expect"'));

    // Try to use Python socket to send raw SSH commands
    console.log('\n6. Try Python socket approach...');
    const pyScript = `python3 -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5)
s.connect(('172.17.0.1', 22))
banner = s.recv(1024)
print('Banner:', banner.decode().strip())
s.close()
" 2>&1`;
    console.log(await runCmd(pyScript));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
