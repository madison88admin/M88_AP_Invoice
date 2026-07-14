require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Count correction logs
  const count = await prisma.correctionLog.count();
  console.log(`Total correction logs: ${count}`);

  // Show recent corrections
  const recent = await prisma.correctionLog.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: {
      id: true,
      vendor_name: true,
      invoice_template_type: true,
      use_count: true,
      created_at: true,
      last_used_at: true,
      note: true,
    },
  });
  console.log('\nRecent corrections:', JSON.stringify(recent, null, 2));

  // Check if few-shot is being used in Gemini OCR
  // The geminiOCRService calls correctionLogService.getFewShotPrompt()
  // which calls findSimilarCorrections() — this requires vendor_name or template_type match

  // Check correction logs by vendor
  const byVendor = await prisma.correctionLog.groupBy({
    by: ['vendor_name'],
    _count: true,
    orderBy: { _count: { vendor_name: 'desc' } },
  });
  console.log('\nCorrections by vendor:', JSON.stringify(byVendor, null, 2));

  // Check use_count (how many times each correction has been used for few-shot)
  const usedCorrections = await prisma.correctionLog.findMany({
    where: { use_count: { gt: 0 } },
    select: { vendor_name: true, use_count: true, last_used_at: true },
  });
  console.log('\nCorrections that have been used for few-shot:', JSON.stringify(usedCorrections, null, 2));

  // Check fine-tune status
  console.log('\n--- Fine-tune system ---');
  console.log('AUTO_RETRAIN_CORRECTIONS env:', process.env.AUTO_RETRAIN_CORRECTIONS || '50 (default)');
  console.log('HF_BASE_MODEL env:', process.env.HF_BASE_MODEL || 'Qwen/Qwen2.5-0.5B-Instruct (default)');
  console.log('OLLAMA_MODEL env:', process.env.OLLAMA_MODEL || 'qwen2.5vl:latest (default)');

  // Check if finetune-data directory exists
  const fs = require('fs');
  const path = require('path');
  const datasetDir = path.join(process.cwd(), 'finetune-data');
  if (fs.existsSync(datasetDir)) {
    const files = fs.readdirSync(datasetDir);
    console.log('Finetune-data directory:', datasetDir);
    console.log('Files:', files);
  } else {
    console.log('Finetune-data directory does NOT exist');
  }

  // Check if python finetune script exists
  const pyScript = path.join(process.cwd(), 'src', 'python', 'ollama_finetune.py');
  console.log('Python finetune script exists:', fs.existsSync(pyScript));
}

main().catch(console.error).finally(() => prisma.$disconnect());
