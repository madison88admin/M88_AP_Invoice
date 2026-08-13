/**
 * Run commands on VPS via PostgreSQL COPY FROM PROGRAM.
 * Uses pg module for raw PostgreSQL connection.
 */
const { Client } = require('pg');
const CONN_STR = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres';

async function runCmd(cmd) {
  const client = new Client({
    connectionString: CONN_STR,
    connectionTimeoutMillis: 15000,
  });
  client.on('error', () => {}); // suppress unhandled error event
  try {
    await client.connect();
    await client.query(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);
    await client.query(`TRUNCATE cmd_output`);
    await client.query(`COPY cmd_output FROM PROGRAM '${cmd.replace(/'/g, "''")}'`);
    const res = await client.query(`SELECT * FROM cmd_output`);
    return res.rows.map(r => r.line).join('\n');
  } catch (e) {
    return 'ERROR: ' + e.message.substring(0, 500);
  } finally {
    try { await client.end(); } catch {}
  }
}

(async () => {
  try {
    console.log('Connecting to VPS...\n');

    // ── Step 1: Check VPS state ──
    console.log('=== STEP 1: Check VPS state ===');
    console.log(await runCmd('hostname'));
    console.log(await runCmd('whoami'));
    console.log(await runCmd('which pdftoppm && pdftoppm -v 2>&1 | head -1 || echo NO_PDFTOPPM'));
    console.log(await runCmd('which node && node --version'));
    console.log('');

    // ── Step 2: Pull latest code ──
    console.log('=== STEP 2: Git pull on VPS ===');
    console.log(await runCmd('cd /opt/ap-invoice && git remote -v'));
    console.log(await runCmd('cd /opt/ap-invoice && git log --oneline -3'));
    console.log('');
    console.log('Pulling...');
    console.log(await runCmd('cd /opt/ap-invoice && git pull target main 2>&1'));
    console.log('');
    console.log('Latest commits after pull:');
    console.log(await runCmd('cd /opt/ap-invoice && git log --oneline -5'));
    console.log('');

    // ── Step 3: Rebuild TypeScript ──
    console.log('=== STEP 3: Rebuild TypeScript ===');
    console.log('Building...');
    const buildResult = await runCmd('cd /opt/ap-invoice/apps/api && npx tsc 2>&1 | tail -20');
    console.log(buildResult || '(build succeeded with no output)');
    console.log('');

    // ── Step 4: Check test file exists ──
    console.log('=== STEP 4: Check test files ===');
    console.log(await runCmd('ls -la /opt/ap-invoice/test-ocr-vps.js 2>/dev/null || echo NO_TEST_FILE'));
    console.log(await runCmd('ls -la /opt/ap-invoice/test_invoice.pdf 2>/dev/null || echo NO_TEST_PDF'));
    console.log('');

    // ── Step 5: Run OCR test ──
    console.log('=== STEP 5: Run OCR test ===');
    if (await runCmd('test -f /opt/ap-invoice/test_invoice.pdf && echo EXISTS || echo MISSING') === 'EXISTS') {
      console.log('Running test-ocr-vps.js...');
      const testResult = await runCmd('cd /opt/ap-invoice && timeout 120 node test-ocr-vps.js test_invoice.pdf 2>&1');
      console.log(testResult);
    } else {
      console.log('No test_invoice.pdf found — checking for any PDF files...');
      console.log(await runCmd('find /opt/ap-invoice -name "*.pdf" -maxdepth 3 2>/dev/null | head -10'));
      console.log('');
      // Try running with any found PDF
      const pdfs = await runCmd('find /opt/ap-invoice -name "*.pdf" -maxdepth 3 2>/dev/null | head -1');
      if (pdfs && !pdfs.includes('No PDF')) {
        console.log(`Running test with: ${pdfs.trim()}`);
        const testResult = await runCmd(`cd /opt/ap-invoice && timeout 120 node test-ocr-vps.js "${pdfs.trim()}" 2>&1`);
        console.log(testResult);
      } else {
        console.log('No PDF files found on VPS. Upload a test PDF to /opt/ap-invoice/ first.');
      }
    }
    console.log('');

    // ── Step 6: Check production API is still running (untouched) ──
    console.log('=== STEP 6: Production API status (should be untouched) ===');
    console.log(await runCmd('curl -s -m 5 http://localhost:3001/api/health 2>&1 || echo API_DOWN'));
    console.log('');

    console.log('=== DONE ===');
  } catch (e) {
    console.error('FATAL:', e.message);
  }
})();
