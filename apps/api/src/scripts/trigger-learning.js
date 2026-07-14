require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Show all corrections with details
  const corrections = await prisma.correctionLog.findMany({
    select: {
      id: true,
      vendor_name: true,
      use_count: true,
      created_at: true,
      last_used_at: true,
      original_fields: true,
      corrected_fields: true,
      note: true,
    },
    orderBy: { created_at: 'desc' },
  });

  console.log(`=== CORRECTION LOGS (${corrections.length} total) ===\n`);
  for (const c of corrections) {
    const origKeys = Object.keys(c.original_fields || {}).filter(k => c.original_fields[k] !== null);
    const corrKeys = Object.keys(c.corrected_fields || {}).filter(k => c.corrected_fields[k] !== null);
    console.log(`[${c.id.slice(0, 8)}] vendor: "${c.vendor_name}" | used: ${c.use_count}x | last: ${c.last_used_at?.toISOString().split('T')[0] || 'never'}`);
    console.log(`  corrected fields: ${corrKeys.join(', ')}`);
    if (c.note) console.log(`  note: ${c.note.slice(0, 100)}`);
    console.log('');
  }

  // 2. Test few-shot prompt generation for each vendor
  console.log('=== FEW-SHOT PROMPT TEST ===\n');
  const { correctionLogService } = require('../../dist/services/correctionLogService');
  
  const vendors = ['Trimco Group', 'Rudholm & Haak', 'C & T LABEL COMPANY LIMITED', 'Avery Dennison'];
  for (const vendor of vendors) {
    const prompt = await correctionLogService.getFewShotPrompt('', vendor, undefined, 3);
    if (prompt) {
      console.log(`✅ Vendor "${vendor}" — few-shot prompt generated (${prompt.length} chars)`);
      console.log(`   Preview: ${prompt.slice(0, 150).replace(/\n/g, ' ')}...`);
    } else {
      console.log(`❌ Vendor "${vendor}" — no few-shot prompt (no matching corrections)`);
    }
    console.log('');
  }

  // 3. Check correction use counts after few-shot test
  const afterCorrections = await prisma.correctionLog.findMany({
    select: { id: true, vendor_name: true, use_count: true, last_used_at: true },
    orderBy: { use_count: 'desc' },
  });
  console.log('=== USE COUNTS AFTER FEW-SHOT TEST ===\n');
  for (const c of afterCorrections) {
    console.log(`  ${c.vendor_name} — used ${c.use_count}x — last: ${c.last_used_at?.toISOString().split('T')[0] || 'never'}`);
  }

  // 4. Try to build fine-tune dataset
  console.log('\n=== FINE-TUNE DATASET BUILD ===\n');
  try {
    const { ollamaFineTuneService } = require('../../dist/services/ollamaFineTuneService');
    const result = await ollamaFineTuneService.buildDataset(5);
    console.log(`✅ Dataset built: ${result.count} entries at ${result.path}`);
    
    // 5. Try to start fine-tuning
    console.log('\n=== STARTING FINE-TUNE ===\n');
    try {
      const ftResult = await ollamaFineTuneService.startFineTune({ minCorrections: 5 });
      console.log(`✅ Fine-tune started: job ${ftResult.jobId}, ${ftResult.datasetCount} entries`);
    } catch (err) {
      console.log(`⚠️ Fine-tune start failed: ${err.message}`);
      console.log('   (This is expected if Python/transformers not installed on VPS)');
    }
    
    // 6. Check status
    const status = ollamaFineTuneService.getStatus();
    console.log(`\nFine-tune status: ${JSON.stringify(status, null, 2)}`);
  } catch (err) {
    console.log(`⚠️ Dataset build failed: ${err.message}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
