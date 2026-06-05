import { PrismaClient, InvoiceType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting vendor seed...');

  const vendors = [
    {
      name: 'Avery Dennison Paxar (China) Ltd',
      name_aliases: ['Paxar (China) Limited', 'PAXAR CHINA'],
      expected_template: InvoiceType.INV,
      bank_name: 'Bank of China',
      bank_address: 'Hong Kong',
      account_usd: '1234567890123456',
      account_hkd: '9876543210987654',
      account_eur: null,
      swift_code: 'BKCHHKHH',
      bank_code: '001',
      currency: 'USD',
    },
    {
      name: 'Avery Dennison Hong Kong B.V.',
      name_aliases: ['Avery Dennison HK', 'ADV HK'],
      expected_template: InvoiceType.INV,
      bank_name: 'HSBC Hong Kong',
      bank_address: 'Hong Kong',
      account_usd: '2345678901234567',
      account_hkd: '8765432109876543',
      account_eur: null,
      swift_code: 'HSBCHKHH',
      bank_code: '004',
      currency: 'USD',
    },
    {
      name: 'Avery Dennison (PT. Paxar Indonesia)',
      name_aliases: ['PT Paxar Indonesia', 'PT. Paxar Indonesia'],
      expected_template: InvoiceType.INV,
      bank_name: 'Bank Central Asia',
      bank_address: 'Jakarta, Indonesia',
      account_usd: '3456789012345678',
      account_hkd: null,
      account_eur: null,
      swift_code: 'CENAIDJA',
      bank_code: '014',
      currency: 'USD',
    },
    {
      name: 'UPW Limited',
      name_aliases: ['UPW Ltd', 'UPW HK'],
      expected_template: InvoiceType.INV,
      bank_name: 'Standard Chartered Bank',
      bank_address: 'Hong Kong',
      account_usd: '4567890123456789',
      account_hkd: '7654321098765432',
      account_eur: null,
      swift_code: 'SCBLHKHH',
      bank_code: '003',
      currency: 'USD',
    },
    {
      name: 'Amass International Limited',
      name_aliases: ['Amass International Ltd', 'AMASS INTL'],
      expected_template: InvoiceType.INV,
      bank_name: 'Hang Seng Bank',
      bank_address: 'Hong Kong',
      account_usd: '5678901234567890',
      account_hkd: '6543210987654321',
      account_eur: null,
      swift_code: 'HASEHKHH',
      bank_code: '024',
      currency: 'USD',
    },
    {
      name: 'Punarbhavaa Sustainable Products',
      name_aliases: ['Punarbhavaa', 'PSP', 'PSPPL'],
      expected_template: InvoiceType.INV,
      bank_name: 'ICICI Bank',
      bank_address: 'Mumbai, India',
      account_usd: '6789012345678901',
      account_hkd: null,
      account_eur: null,
      swift_code: 'ICICINBB',
      bank_code: null,
      currency: 'USD',
    },
  ];

  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: { name: vendor.name },
      update: {},
      create: vendor,
    });
    console.log(`Seeded vendor: ${vendor.name}`);
  }

  console.log('Vendor seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding vendors:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
