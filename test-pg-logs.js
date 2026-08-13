process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    // Check if pg_stat_statements is available
    console.log('1. Checking pg_stat_statements...');
    try {
      const stats = await prisma.$queryRawUnsafe(`
        SELECT query, calls, total_exec_time, rows
        FROM pg_stat_statements
        WHERE query LIKE '%APInvoice_User%' AND query LIKE '%INSERT%'
        ORDER BY last_exec_time DESC
        LIMIT 5
      `);
      console.log('   Recent INSERT queries on APInvoice_User:');
      stats.forEach(s => console.log('   -', s.query.substring(0, 200)));
    } catch (e) {
      console.log('   pg_stat_statements not available:', e.message.substring(0, 100));
    }

    // Check recent errors in PostgreSQL log
    console.log('\n2. Checking pg_stat_activity...');
    try {
      const activity = await prisma.$queryRawUnsafe(`
        SELECT pid, state, query
        FROM pg_stat_activity
        WHERE query LIKE '%APInvoice_User%'
        ORDER BY query_start DESC
        LIMIT 5
      `);
      console.log('   Active queries:');
      activity.forEach(a => console.log('   -', a.state, ':', a.query?.substring(0, 200)));
    } catch (e) {
      console.log('   Failed:', e.message.substring(0, 100));
    }

    // Try to read PostgreSQL log file
    console.log('\n3. Checking PostgreSQL log...');
    try {
      const log = await prisma.$queryRawUnsafe(`
        SELECT pg_read_file('log/postgresql-' || to_char(NOW(), 'YYYY-MM-DD') || '.log', 0, 1000000) as log_text
      `);
      const lines = log[0].log_text.split('\n').filter(l => l.includes('APInvoice_User') && l.includes('ERROR'));
      console.log('   Error lines mentioning APInvoice_User:');
      lines.slice(-10).forEach(l => console.log('   -', l.substring(0, 300)));
    } catch (e) {
      console.log('   Cannot read log file:', e.message.substring(0, 200));
    }

    // Try alternative log location
    console.log('\n4. Trying alternative log location...');
    try {
      const log = await prisma.$queryRawUnsafe(`
        SELECT setting FROM pg_settings WHERE name = 'log_directory'
      `);
      console.log('   Log directory:', log[0].setting);

      const logFile = await prisma.$queryRawUnsafe(`
        SELECT setting FROM pg_settings WHERE name = 'data_directory'
      `);
      console.log('   Data directory:', logFile[0].setting);

      const logDest = await prisma.$queryRawUnsafe(`
        SELECT setting FROM pg_settings WHERE name = 'logging_collector'
      `);
      console.log('   Logging collector:', logDest[0].setting);
    } catch (e) {
      console.log('   Failed:', e.message.substring(0, 100));
    }

    // Check if we can use pg_current_logfile
    console.log('\n5. Trying pg_current_logfile()...');
    try {
      const logfile = await prisma.$queryRawUnsafe(`SELECT pg_current_logfile() as logfile`);
      console.log('   Current log file:', logfile[0].logfile);

      // Try to read the last part of the log
      const logContent = await prisma.$queryRawUnsafe(`
        SELECT pg_read_file(pg_current_logfile(), 0, 100000000) as log_text
      `);
      const lines = logContent[0].log_text.split('\n').filter(l => l.includes('APInvoice_User') && (l.includes('ERROR') || l.includes('23502')));
      console.log('   Error lines mentioning APInvoice_User:');
      lines.slice(-10).forEach(l => console.log('   -', l.substring(0, 400)));
    } catch (e) {
      console.log('   Failed:', e.message.substring(0, 200));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
