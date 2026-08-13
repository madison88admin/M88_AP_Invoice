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
    // Search for ssh binaries in nix store
    console.log('1. Search for SSH in nix store...');
    console.log(await runCmd('find /nix/store -maxdepth 3 -name "ssh" -type f 2>/dev/null | head -10'));
    console.log(await runCmd('find /nix/store -maxdepth 3 -name "sshpass" -type f 2>/dev/null | head -10'));
    console.log(await runCmd('find /nix/store -maxdepth 4 -name "ssh" -type f 2>/dev/null | head -10'));

    // Check nix store directories
    console.log('\n2. List nix store packages...');
    console.log(await runCmd('ls /nix/store/ 2>/dev/null | grep -i ssh | head -10'));
    console.log(await runCmd('ls /nix/store/ 2>/dev/null | grep -i openssh | head -10'));

    // Check nixpg directory
    console.log('\n3. Check nixpg...');
    console.log(await runCmd('ls /nixpg/ 2>/dev/null | head -20'));
    console.log(await runCmd('find /nixpg -name "ssh" -type f 2>/dev/null | head -5'));

    // Check if there's a nix profile with ssh
    console.log('\n4. Check nix profiles...');
    console.log(await runCmd('ls /nix/var/nix/profiles/ 2>/dev/null'));
    console.log(await runCmd('ls /nix/var/nix/profiles/default/bin/ 2>/dev/null | head -30'));

    // Try to find any executable that can do SSH
    console.log('\n5. Find any SSH-related executables...');
    console.log(await runCmd('find /nix -type f -executable -name "*ssh*" 2>/dev/null | head -10'));
    console.log(await runCmd('find /usr -type f -executable -name "*ssh*" 2>/dev/null | head -10'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
