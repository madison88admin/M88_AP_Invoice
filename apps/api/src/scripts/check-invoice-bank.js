const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const invoice = await prisma.invoice.findFirst({
    where: { invoice_number: 'INVP0258309' },
    select: { id: true, ocr_raw_data: true, bank_name: true, swift_code: true, account_number: true }
  });

  if (!invoice) {
    console.log('Invoice not found');
    return;
  }

  console.log('=== DB Bank Fields ===');
  console.log('bank_name:', invoice.bank_name);
  console.log('swift_code:', invoice.swift_code);
  console.log('account_number:', invoice.account_number);

  const raw = invoice.ocr_raw_data;
  console.log('\n=== OCR Raw Data Keys ===');
  console.log(Object.keys(raw || {}));

  // Check if bank info is in the raw text
  const rawStr = JSON.stringify(raw || {});
  console.log('\n=== Searching for bank keywords in raw data ===');
  const keywords = ['bank', 'swift', 'account', 'SWIFT', 'Bank', 'Account', 'HSBC', 'HSBCHK', 'beneficiary'];
  for (const kw of keywords) {
    const idx = rawStr.indexOf(kw);
    if (idx >= 0) {
      console.log(`Found "${kw}" at index ${idx}: ...${rawStr.substring(Math.max(0, idx - 30), idx + 80)}...`);
    }
  }

  // Print bank_swift and bank_account from raw data
  console.log('\n=== bank_swift in raw_data ===');
  console.log('bank_swift:', raw?.bank_swift);
  console.log('bank_account:', raw?.bank_account);
  console.log('bank_name:', raw?.bank_name);
  console.log('bank_info:', JSON.stringify(raw?.bank_info));

  // Print full raw data (truncated)
  console.log('\n=== Full raw data (first 2000 chars) ===');
  console.log(rawStr.substring(0, 2000));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
