process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    console.log('=== CLEARING INVOICE DATA, SLA, AND NOTIFICATIONS ===\n');

    // Order matters due to foreign keys - delete child tables first
    const tablesToClear = [
      // Invoice-related child tables first
      'APInvoice_InvoiceLine',
      'APInvoice_StageTimestamp',
      'APInvoice_WorkflowAction',
      'APInvoice_Signature',
      'APInvoice_PaymentConfirmation',
      'APInvoice_Payment',
      'APInvoice_PaymentBatch',
      'APInvoice_FollowUpTask',
      'APInvoice_Exception',
      'APInvoice_BankChangeRequest',
      'APInvoice_Notification',
      // Parent invoice table last
      'APInvoice_Invoice',
      // Debug table
      'DebugInsertLog',
    ];

    for (const table of tablesToClear) {
      try {
        // Get count before
        const before = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."${table}"`);
        const count = before[0].cnt;
        
        if (count > 0) {
          // Use TRUNCATE with CASCADE to handle foreign key constraints
          await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AP_Invoice"."${table}" CASCADE;`);
          console.log(`  ✓ ${table}: ${count} rows deleted`);
        } else {
          console.log(`  - ${table}: already empty`);
        }
      } catch (e) {
        console.log(`  ✗ ${table}: FAILED - ${e.message.substring(0, 150)}`);
      }
    }

    // Verify everything is cleared
    console.log('\n=== VERIFICATION ===');
    for (const table of tablesToClear) {
      try {
        const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."${table}"`);
        const c = count[0].cnt;
        console.log(`  ${table}: ${c} rows ${c === 0 ? '✓' : '✗ NOT EMPTY'}`);
      } catch (e) {
        console.log(`  ${table}: ERROR - ${e.message.substring(0, 80)}`);
      }
    }

    // Verify AI training data is preserved
    console.log('\n=== AI TRAINING DATA (PRESERVED) ===');
    const correction = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_CorrectionLog"`);
    console.log(`  APInvoice_CorrectionLog: ${correction[0].cnt} rows ✓`);

    // Verify other preserved data
    console.log('\n=== OTHER PRESERVED DATA ===');
    const vendors = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Vendor"`);
    const users = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_User"`);
    const apiKeys = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_ApiKey"`);
    console.log(`  APInvoice_Vendor: ${vendors[0].cnt} rows ✓`);
    console.log(`  APInvoice_User: ${users[0].cnt} rows ✓`);
    console.log(`  APInvoice_ApiKey: ${apiKeys[0].cnt} rows ✓`);

    // Reset any sequences if they exist
    console.log('\n=== RESETTING SEQUENCES ===');
    try {
      const seqs = await prisma.$queryRawUnsafe(`
        SELECT sequence_name FROM information_schema.sequences 
        WHERE sequence_schema = 'AP_Invoice'
      `);
      for (const s of seqs) {
        try {
          await prisma.$executeRawUnsafe(`ALTER SEQUENCE "AP_Invoice"."${s.sequence_name}" RESTART WITH 1;`);
          console.log(`  ✓ Reset ${s.sequence_name}`);
        } catch (e) {
          console.log(`  - ${s.sequence_name}: ${e.message.substring(0, 80)}`);
        }
      }
      if (seqs.length === 0) console.log('  No sequences found');
    } catch (e) {
      console.log(`  No sequences to reset`);
    }

    console.log('\n✅ ALL DONE! System is ready for new invoices.');

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
