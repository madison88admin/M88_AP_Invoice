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

async function writeFileViaBase64(path, content) {
  const b64 = Buffer.from(content).toString('base64');
  await runCmd(`echo '${b64}' | base64 -d > ${path}`);
}

(async () => {
  try {
    // Check available Python modules
    console.log('1. Check Python modules...');
    const pyCheck = `import importlib
mods = ['socket', 'ssl', 'hashlib', 'hmac', 'struct', 'os', 'sys', 'subprocess', 
        'Crypto', 'cryptography', 'paramiko', 'asyncssh', 'ssh2', 'nacl',
        'OpenSSL', 'M2Crypto', 'select', 'time', 'base64']
for m in mods:
    try:
        importlib.import_module(m)
        print(f"  {m}: OK")
    except:
        print(f"  {m}: MISSING")
`;
    await writeFileViaBase64('/tmp/check_mods.py', pyCheck);
    console.log(await runCmd('python3 /tmp/check_mods.py 2>&1'));

    // Check if we can install paramiko via pip
    console.log('\n2. Try pip install...');
    console.log(await runCmd('python3 -m ensurepip 2>&1 | tail -3'));
    console.log(await runCmd('python3 -m pip install paramiko 2>&1 | tail -5'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
