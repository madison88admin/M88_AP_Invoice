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
    // Check nix
    console.log('1. Check nix...');
    console.log(await runCmd('ls /nix/var/nix/profiles/default/bin/ 2>/dev/null | head -10 || echo "no nix bin"'));
    console.log(await runCmd('/nix/var/nix/profiles/default/bin/nix --version 2>/dev/null || echo "no nix"'));
    console.log(await runCmd('ls /nixpg/ 2>/dev/null | head -10'));

    // Check if there's a nix-installed ssh
    console.log('\n2. Find ssh in nix...');
    console.log(await runCmd('find /nix -name "ssh" -type f 2>/dev/null | head -5'));
    console.log(await runCmd('find /nix -name "sshpass" -type f 2>/dev/null | head -5'));

    // Check PATH
    console.log('\n3. Check PATH...');
    console.log(await runCmd('echo $PATH'));

    // Check if we can use nix-env to install ssh
    console.log('\n4. Try nix-env...');
    console.log(await runCmd('/nix/var/nix/profiles/default/bin/nix-env -iA nixpkgs.openssh 2>&1 | tail -5 || echo "nix-env failed"'));

    // Alternative: try to download a static busybox with ssh
    console.log('\n5. Try downloading static sshpass...');
    console.log(await runCmd('curl -s -L --connect-timeout 10 "https://github.com/xhc/sshpass/releases/download/v1.10/sshpass" -o /tmp/sshpass 2>&1 && chmod +x /tmp/sshpass && file /tmp/sshpass && /tmp/sshpass 2>&1 | head -3 || echo "download failed"'));

    // Try another source for sshpass
    console.log('\n6. Try apt download (no install)...');
    console.log(await runCmd('apt-get download sshpass 2>&1 || echo "apt download failed"'));
    console.log(await runCmd('ls -la /tmp/*.deb 2>/dev/null || echo "no deb files"'));

    // Check if we can use conda
    console.log('\n7. Check conda...');
    console.log(await runCmd('which conda 2>/dev/null || echo "no conda"'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
