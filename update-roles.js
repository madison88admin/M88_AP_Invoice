process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Update Chris to CC_REPORTS
  const chris = await prisma.$executeRawUnsafe(`
    UPDATE "AP_Invoice"."APInvoice_User" SET role = 'CC_REPORTS', updated_at = NOW()
    WHERE email = 'chris@madison88.com'
  `);
  console.log('Chris updated to CC_REPORTS:', chris > 0 ? 'SUCCESS' : 'NOT FOUND');

  // Update Jennifer Paloma to INVOICE_UPLOADER
  const jennifer = await prisma.$executeRawUnsafe(`
    UPDATE "AP_Invoice"."APInvoice_User" SET role = 'INVOICE_UPLOADER', updated_at = NOW()
    WHERE email = 'jpaloma@madison88.com'
  `);
  console.log('Jennifer Paloma updated to INVOICE_UPLOADER:', jennifer > 0 ? 'SUCCESS' : 'NOT FOUND');

  // Verify
  const users = await prisma.$queryRawUnsafe(`
    SELECT name, email, role FROM "AP_Invoice"."APInvoice_User" 
    WHERE email IN ('chris@madison88.com', 'jpaloma@madison88.com')
  `);
  console.log('\nVerified:');
  users.forEach(u => console.log(`  ${u.name} | ${u.email} | ${u.role}`));

  await prisma.$disconnect();
})();
