process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // List all tables with row counts
    console.log('=== TABLE ROW COUNTS ===');
    const tables = await prisma.$queryRawUnsafe(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'AP_Invoice' ORDER BY tablename
    `);
    for (const t of tables) {
      try {
        const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."${t.tablename}"`);
        console.log(`  ${t.tablename}: ${count[0].cnt} rows`);
      } catch (e) {
        console.log(`  ${t.tablename}: ERROR - ${e.message.substring(0, 80)}`);
      }
    }

    // Check CorrectionLog specifically (AI training data)
    console.log('\n=== CORRECTION LOG (AI TRAINING DATA) ===');
    const correctionStats = await prisma.$queryRawUnsafe(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN approved_for_learning = true THEN 1 END) as approved,
        COUNT(CASE WHEN disabled_at IS NOT NULL THEN 1 END) as disabled
      FROM "AP_Invoice"."APInvoice_CorrectionLog"
    `);
    console.log(`  Total: ${correctionStats[0].total}`);
    console.log(`  Approved for learning: ${correctionStats[0].approved}`);
    console.log(`  Disabled: ${correctionStats[0].disabled}`);

    // Check invoice-related data
    console.log('\n=== INVOICE DATA ===');
    const invCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Invoice"`);
    const lineCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_InvoiceLine"`);
    const payCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Payment"`);
    const batchCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_PaymentBatch"`);
    const confCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_PaymentConfirmation"`);
    console.log(`  Invoices: ${invCount[0].cnt}`);
    console.log(`  Invoice Lines: ${lineCount[0].cnt}`);
    console.log(`  Payments: ${payCount[0].cnt}`);
    console.log(`  Payment Batches: ${batchCount[0].cnt}`);
    console.log(`  Payment Confirmations: ${confCount[0].cnt}`);

    // Check SLA/Stage data
    console.log('\n=== SLA / STAGE DATA ===');
    const stageCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_StageTimestamp"`);
    const workflowCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_WorkflowAction"`);
    const followUpCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_FollowUpTask"`);
    const exceptionCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Exception"`);
    console.log(`  Stage Timestamps: ${stageCount[0].cnt}`);
    console.log(`  Workflow Actions: ${workflowCount[0].cnt}`);
    console.log(`  Follow-up Tasks: ${followUpCount[0].cnt}`);
    console.log(`  Exceptions: ${exceptionCount[0].cnt}`);

    // Check notifications
    console.log('\n=== NOTIFICATIONS ===');
    const notifCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Notification"`);
    console.log(`  Notifications: ${notifCount[0].cnt}`);

    // Check other tables
    console.log('\n=== OTHER ===');
    const sigCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Signature"`);
    const bankCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_BankChangeRequest"`);
    const auditCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_AuditLog"`);
    console.log(`  Signatures: ${sigCount[0].cnt}`);
    console.log(`  Bank Change Requests: ${bankCount[0].cnt}`);
    console.log(`  Audit Logs: ${auditCount[0].cnt}`);

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
