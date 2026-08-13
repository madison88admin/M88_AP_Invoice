process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Check RLS
    const rls = await prisma.$queryRaw`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'APInvoice_User'
    `;
    console.log('RLS on APInvoice_User:', rls);

    // Check policies
    const policies = await prisma.$queryRaw`
      SELECT polname, polcmd, polroles, polqual, polwithcheck
      FROM pg_policy
      WHERE polrelid = 'AP_Invoice.APInvoice_User'::regclass
    `;
    console.log('Policies:', policies);

    // Check triggers
    const triggers = await prisma.$queryRaw`
      SELECT trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema = 'AP_Invoice' AND event_object_table = 'APInvoice_User'
    `;
    console.log('Triggers:', triggers);

    // Check constraints
    const constraints = await prisma.$queryRaw`
      SELECT conname, contype, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'AP_Invoice.APInvoice_User'::regclass
    `;
    console.log('Constraints:', constraints);

    // Check indexes
    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'AP_Invoice' AND tablename = 'APInvoice_User'
    `;
    console.log('Indexes:', indexes);

  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
